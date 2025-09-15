import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser, insertUserSchema } from "@shared/schema";
import { z } from "zod";
import { loginRateLimit } from "./security-controls";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  try {
    // Check if stored password is in expected scrypt format (hex.salt)
    if (!stored || !stored.includes('.')) {
      console.error('[Auth] Invalid password format - expected scrypt hex.salt format');
      return false;
    }

    const [hashed, salt] = stored.split(".");
    
    // Validate that we have both parts
    if (!hashed || !salt) {
      console.error('[Auth] Malformed password hash - missing hash or salt');
      return false;
    }

    // Validate hex format
    if (!/^[a-fA-F0-9]+$/.test(hashed) || !/^[a-fA-F0-9]+$/.test(salt)) {
      console.error('[Auth] Invalid hex format in password hash');
      return false;
    }

    const hashedBuf = Buffer.from(hashed, "hex");
    const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
    
    // Ensure buffers are same length before comparison
    if (hashedBuf.length !== suppliedBuf.length) {
      console.error('[Auth] Buffer length mismatch in password comparison');
      return false;
    }
    
    return timingSafeEqual(hashedBuf, suppliedBuf);
  } catch (error) {
    console.error('[Auth] Password comparison error:', error);
    return false;
  }
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

const registerSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  password: z.string().min(6),
  confirmPassword: z.string().min(6)
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"]
});

export function setupAuth(app: Express) {
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    store: storage.sessionStore,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax', // CSRF Protection: Prevent cross-site request forgery
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(
      { usernameField: 'email' },
      async (email, password, done) => {
        try {
          const user = await storage.getUserByEmail(email);
          if (!user || !user.isActive) {
            return done(null, false);
          }
          
          const isValid = await comparePasswords(password, user.password);
          if (!isValid) {
            return done(null, false);
          }
          
          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  // ❌ DISABLED: Public self-registration is WRONG for multi-tenant SaaS
  // Users should only be created by admins via /api/admin/users endpoint
  // This endpoint allowed anyone to self-register which violates the business model
  /*
  app.post("/api/register", async (req, res, next) => {
    // ... (endpoint disabled for security - use admin user creation instead)
  });
  */
  
  // TODO: Redirect to proper customer signup flow or show "Contact Sales" message
  app.post("/api/register", (req, res) => {
    res.status(403).json({ 
      message: "Public registration is disabled. Please contact your administrator to create an account.",
      error: "REGISTRATION_DISABLED",
      contactInfo: "Contact sales or your admin for account setup."
    });
  });

  app.post("/api/login", loginRateLimit, (req, res, next) => {
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        message: "Validation failed", 
        errors: validation.error.flatten() 
      });
    }

    passport.authenticate("local", (err: any, user: SelectUser | false) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: "Invalid credentials" });

      req.login(user, (err) => {
        if (err) return next(err);
        
        // SECURITY: Regenerate session to prevent session fixation attacks
        req.session.regenerate((regenerateErr) => {
          if (regenerateErr) {
            console.error('[Security] Session regeneration failed on login:', regenerateErr);
            return next(regenerateErr);
          }
          
          // Re-authenticate after session regeneration
          req.login(user, (loginErr) => {
            if (loginErr) return next(loginErr);
            
            // SECURITY: Explicitly save session to ensure cookie is flushed
            req.session.save((saveErr) => {
              if (saveErr) {
                console.error('[Security] Session save failed after login:', saveErr);
                return next(saveErr);
              }
              
              // SECURITY: Never return password hash or sensitive data
              const safeUser = {
                id: user.id,
                email: user.email,
                role: user.role,
                tenantId: user.tenantId,
                firstName: user.firstName,
                lastName: user.lastName,
                isActive: user.isActive,
                lastLoginAt: user.lastLoginAt,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt
              };
              res.json(safeUser);
            });
          });
        });
      });
    })(req, res, next);
  });

  // Add route alias for /api/auth/login to match common expectations
  app.post("/api/auth/login", loginRateLimit, (req, res, next) => {
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        message: "Validation failed", 
        errors: validation.error.flatten() 
      });
    }

    passport.authenticate("local", (err: any, user: SelectUser | false) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: "Invalid credentials" });

      req.login(user, (err) => {
        if (err) return next(err);
        
        // SECURITY: Regenerate session to prevent session fixation attacks
        req.session.regenerate((regenerateErr) => {
          if (regenerateErr) {
            console.error('[Security] Session regeneration failed on login:', regenerateErr);
            return next(regenerateErr);
          }
          
          // Re-authenticate after session regeneration
          req.login(user, (loginErr) => {
            if (loginErr) return next(loginErr);
            
            // SECURITY: Explicitly save session to ensure cookie is flushed
            req.session.save((saveErr) => {
              if (saveErr) {
                console.error('[Security] Session save failed after login:', saveErr);
                return next(saveErr);
              }
              
              // SECURITY: Never return password hash or sensitive data
              const safeUser = {
                id: user.id,
                email: user.email,
                role: user.role,
                tenantId: user.tenantId,
                firstName: user.firstName,
                lastName: user.lastName,
                isActive: user.isActive,
                lastLoginAt: user.lastLoginAt,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt
              };
              res.json(safeUser);
            });
          });
        });
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    // SECURITY: Never return password hash or sensitive data
    const user = req.user as SelectUser;
    const safeUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      firstName: user.firstName,
      lastName: user.lastName,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
    res.json(safeUser);
  });
}

// Middleware to check authentication
export function requireAuth(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Authentication required" });
  }
  next();
}

// Middleware to check role
export function requireRole(roles: string[]) {
  return (req: any, res: any, next: any) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Authentication required" });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    
    next();
  };
}

// Middleware to ensure tenant access
export function requireTenantAccess(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Authentication required" });
  }

  const user = req.user;
  const tenantId = req.params.tenantId || req.body.tenantId;

  // Platform admins can access all tenants
  if (user.role === 'platform_admin') {
    return next();
  }

  // Other users can only access their own tenant
  if (!user.tenantId || user.tenantId !== tenantId) {
    return res.status(403).json({ message: "Access denied to this tenant" });
  }

  next();
}
