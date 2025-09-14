import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupProductionSecurity, setupHealthCheck, getSecurityConfig } from "./production-security";

const app = express();

// Trust proxy for proper IP handling behind load balancers
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', true);
}

// Set up production security middleware early
const securityConfig = getSecurityConfig();
setupProductionSecurity(app, securityConfig);

// Set up health check endpoints
setupHealthCheck(app);

// Special raw body parsing for Stripe webhooks BEFORE other middleware
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// Regular JSON and URL-encoded body parsing for other routes with size limits
const bodyLimit = process.env.NODE_ENV === 'production' ? '1mb' : '10mb';
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: false, limit: bodyLimit }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    console.log(`[STARTUP] Starting VoiceAgent SaaS Platform in ${process.env.NODE_ENV || 'development'} mode`);
    console.log(`[STARTUP] Process ID: ${process.pid}`);
    console.log(`[STARTUP] Node version: ${process.version}`);
    
    const server = await registerRoutes(app);
    console.log(`[STARTUP] Routes registered successfully`);

    app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      
      // Log error details for debugging without crashing the server
      console.error(`[ERROR] ${status}: ${message}`);
      console.error(`[ERROR] Request: ${req.method} ${req.path}`);
      if (process.env.NODE_ENV === 'development') {
        console.error(`[ERROR] Stack:`, err.stack);
      }
      
      // Send error response without crashing the server
      if (!res.headersSent) {
        res.status(status).json({ message });
      }
    });

    // Setup Vite in development or serve static files in production
    if (app.get("env") === "development") {
      console.log(`[STARTUP] Setting up Vite development server`);
      await setupVite(app, server);
      console.log(`[STARTUP] Vite development server configured`);
    } else {
      console.log(`[STARTUP] Setting up static file serving for production`);
      try {
        serveStatic(app);
        console.log(`[STARTUP] Static file serving configured`);
      } catch (staticError) {
        console.error(`[STARTUP] CRITICAL: Static file serving failed:`, staticError);
        throw staticError;
      }
    }

    // Configure server to listen on correct host/port for deployment
    const port = parseInt(process.env.PORT || '5000', 10);
    const host = process.env.HOST || "0.0.0.0";
    
    console.log(`[STARTUP] Attempting to listen on ${host}:${port}`);
    
    server.listen({
      port,
      host,
      reusePort: true,
    }, () => {
      console.log(`[STARTUP] ✅ VoiceAgent SaaS Platform successfully started!`);
      console.log(`[STARTUP] 🚀 Server listening on http://${host}:${port}`);
      console.log(`[STARTUP] Environment: ${process.env.NODE_ENV || 'development'}`);
      log(`serving on port ${port}`);
    });
    
    // Handle server errors
    server.on('error', (error: any) => {
      console.error(`[STARTUP] ❌ Server error:`, error);
      if (error.code === 'EADDRINUSE') {
        console.error(`[STARTUP] Port ${port} is already in use!`);
      } else if (error.code === 'EACCES') {
        console.error(`[STARTUP] Permission denied to bind to port ${port}`);
      }
      process.exit(1);
    });

  } catch (startupError) {
    console.error(`[STARTUP] ❌ Critical startup error:`, startupError);
    console.error(`[STARTUP] Stack trace:`, startupError instanceof Error ? startupError.stack : 'No stack trace available');
    
    // Log environment info for debugging
    console.error(`[DEBUG] NODE_ENV: ${process.env.NODE_ENV}`);
    console.error(`[DEBUG] PORT: ${process.env.PORT}`);
    console.error(`[DEBUG] HOST: ${process.env.HOST}`);
    console.error(`[DEBUG] Working directory: ${process.cwd()}`);
    
    process.exit(1);
  }
})();

// Handle unhandled promise rejections and uncaught exceptions
process.on('unhandledRejection', (reason, promise) => {
  console.error('[PROCESS] Unhandled Promise Rejection:', reason);
  console.error('[PROCESS] Promise:', promise);
  // Don't exit in production - log and continue
  if (process.env.NODE_ENV === 'development') {
    console.error('[PROCESS] Exiting due to unhandled rejection in development');
    process.exit(1);
  }
});

process.on('uncaughtException', (error) => {
  console.error('[PROCESS] Uncaught Exception:', error);
  console.error('[PROCESS] Stack:', error.stack);
  // Exit gracefully on uncaught exceptions
  console.error('[PROCESS] Exiting due to uncaught exception');
  process.exit(1);
});
