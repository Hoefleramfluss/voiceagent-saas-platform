import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupProductionSecurity, setupHealthCheck, getSecurityConfig } from "./production-security";
import { automatedInvoiceService } from "./automated-invoice-service";
import { errorHandlingMiddleware, getSystemHealth } from "./error-handling";
import { getResilienceHealth } from "./retry-utils";

const app = express();

// Trust proxy for proper IP handling behind load balancers and URL reconstruction
app.set('trust proxy', 1);

// Set up production security middleware early
const securityConfig = getSecurityConfig();
setupProductionSecurity(app, securityConfig);

// Set up health check endpoints
setupHealthCheck(app);

// Special raw body parsing for Stripe webhooks BEFORE other middleware
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// Special raw body parsing for Twilio webhooks BEFORE other middleware
app.use('/telephony', express.urlencoded({ 
  extended: false, 
  verify: (req, _res, buf) => { 
    (req as any).rawBody = buf.toString('utf8'); 
  } 
}));

// Regular JSON and URL-encoded body parsing for other routes with size limits
const NODE_ENV = process.env.NODE_ENV || 'production';
const bodyLimit = NODE_ENV === 'production' ? '1mb' : '10mb';
console.log(`[STARTUP] Environment: ${NODE_ENV}`);
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

    // Use centralized error handling middleware
    app.use(errorHandlingMiddleware);

    // Setup Vite in development or serve static files in production
    if (app.get("env") === "development") {
      console.log(`[STARTUP] Setting up Vite development server`);
      await setupVite(app, server);
      console.log(`[STARTUP] Vite development server configured`);
    } else {
      console.log(`[STARTUP] Setting up static file serving for production`);
      try {
        // Ensure static files are accessible for production deployment
        const fs = await import('fs');
        const path = await import('path');
        
        const serverPublicPath = path.resolve(import.meta.dirname, 'public');
        const distPublicPath = path.resolve(import.meta.dirname, '..', 'dist', 'public');
        
        // Create symlink or copy static files if server/public doesn't exist or is empty
        if (!fs.existsSync(serverPublicPath) || fs.readdirSync(serverPublicPath).length === 0) {
          console.log(`[STARTUP] Static files missing at ${serverPublicPath}`);
          
          if (fs.existsSync(distPublicPath)) {
            try {
              // Try to create symlink first (preferred for space efficiency)
              if (fs.existsSync(serverPublicPath)) {
                fs.rmSync(serverPublicPath, { recursive: true, force: true });
              }
              fs.symlinkSync(distPublicPath, serverPublicPath, 'dir');
              console.log(`[STARTUP] ✅ Created symlink: ${serverPublicPath} → ${distPublicPath}`);
            } catch (symlinkError) {
              // Fallback to copying files if symlink fails
              console.warn(`[STARTUP] Symlink failed, copying files instead:`, symlinkError);
              fs.cpSync(distPublicPath, serverPublicPath, { recursive: true });
              console.log(`[STARTUP] ✅ Copied static files to ${serverPublicPath}`);
            }
          } else {
            console.error(`[STARTUP] ❌ Static files not found at ${distPublicPath}`);
            console.error(`[STARTUP] Run 'npm run build' to generate static files`);
            throw new Error(`Static files not found. Run 'npm run build' first.`);
          }
        } else {
          console.log(`[STARTUP] Static files already available at ${serverPublicPath}`);
        }
        
        serveStatic(app);
        console.log(`[STARTUP] ✅ Static file serving configured`);
      } catch (staticError) {
        console.error(`[STARTUP] ❌ CRITICAL: Static file serving failed:`, staticError);
        throw staticError;
      }
    }

    // Run deployment smoke tests to verify system readiness
    if (process.env.NODE_ENV === 'production' || process.env.RUN_SMOKE_TESTS === 'true') {
      try {
        console.log(`[STARTUP] Running deployment smoke tests...`);
        const { runDeploymentSmokeTests } = await import('./smoke-tests');
        await runDeploymentSmokeTests();
        console.log(`[STARTUP] ✅ All smoke tests passed - system ready for deployment`);
      } catch (smokeTestError) {
        console.error(`[STARTUP] ❌ Smoke tests failed:`, smokeTestError);
        if (process.env.NODE_ENV === 'production') {
          throw new Error(`Deployment smoke tests failed: ${smokeTestError}`);
        } else {
          console.warn(`[STARTUP] ⚠️ Continuing in development despite smoke test failures`);
        }
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
      
      // Start automated invoice generation scheduler
      automatedInvoiceService.startScheduler();
      console.log(`[STARTUP] 📅 Automated invoice scheduler initialized`);
      
      // Initialize enterprise background jobs (async)
      (async () => {
        try {
          const { initializeBackgroundJobs } = await import('./background-jobs');
          initializeBackgroundJobs();
          console.log(`[STARTUP] 📋 Enterprise background jobs initialized`);
        } catch (bgJobError) {
          console.error(`[STARTUP] ⚠️ Background jobs initialization failed:`, bgJobError);
          // Don't exit - continue without background jobs in case of error
        }
      })();
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
