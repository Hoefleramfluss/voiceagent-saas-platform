import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

if (!process.env.REPLIT_DOMAINS) {
  throw new Error("Environment variable REPLIT_DOMAINS not provided");
}

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(
  claims: any,
) {
  const email = claims["email"];
  
  // Check if this is the first user in the system
  const userCount = await storage.getUserCount();
  
  // Determine the role based on email - ONLY hoefler@amfluss.info is Global_admin
  let role: 'platform_admin' | 'customer_user' = 'customer_user';
  if (email === 'hoefler@amfluss.info') {
    role = 'platform_admin';
    console.log(`[AUTH] Assigning platform_admin role to ${email} (Global_admin)`);
  }
  
  await storage.upsertUser({
    email: email,
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
    role: role
  });
}

const domains = process.env.REPLIT_DOMAINS?.split(",") || ["localhost:5000"];

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user: any = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  console.log("[AUTH] Configuring domains:", domains);
  for (const domain of domains) {
    const strategy = new Strategy(
      {
        name: `replitauth:${domain}`,
        config,
        scope: "openid email profile offline_access",
        callbackURL: `https://${domain}/api/callback`,
      },
      verify,
    );
    passport.use(strategy);
  }

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    const domain = domains[0]; // Use first domain as fallback
    console.log('[AUTH] Login attempt for domain:', domain);
    passport.authenticate(`replitauth:${domain}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });
  console.log('[AUTH] Registered /api/login endpoint');

  app.get("/api/callback", (req, res, next) => {
    const domain = domains[0]; // Use first domain as fallback
    passport.authenticate(`replitauth:${domain}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    // Fetch the full user from database to get role and other properties
    try {
      const userEmail = user.claims?.email;
      console.log('[AUTH] Fetching user from database for email:', userEmail);
      
      if (userEmail) {
        const dbUser = await storage.getUserByEmail(userEmail);
        console.log('[AUTH] Database user found:', dbUser ? { id: dbUser.id, email: dbUser.email, role: dbUser.role } : 'null');
        
        if (dbUser) {
          // Attach database user info to req.user for downstream middleware
          (req as any).user = {
            ...user,
            id: dbUser.id,
            role: dbUser.role,
            tenantId: dbUser.tenantId,
            email: dbUser.email,
            isActive: dbUser.isActive
          };
          console.log('[AUTH] Successfully attached DB user to req.user with role:', dbUser.role);
        } else {
          console.error('[AUTH] Database user not found for email:', userEmail);
          return res.status(401).json({ message: "User not found in database" });
        }
      } else {
        console.error('[AUTH] No email in user claims');
        return res.status(401).json({ message: "Invalid user claims" });
      }
    } catch (error) {
      console.error('[AUTH] Error fetching user from database:', error);
      return res.status(500).json({ message: "Database error during authentication" });
    }
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    
    // After refreshing token, also fetch user from database
    const userEmail = tokenResponse.claims()?.email;
    console.log('[AUTH] After token refresh, fetching user for email:', userEmail);
    
    if (userEmail && typeof userEmail === 'string') {
      const dbUser = await storage.getUserByEmail(userEmail);
      console.log('[AUTH] After refresh - Database user found:', dbUser ? { id: dbUser.id, email: dbUser.email, role: dbUser.role } : 'null');
      
      if (dbUser) {
        (req as any).user = {
          ...user,
          id: dbUser.id,
          role: dbUser.role,
          tenantId: dbUser.tenantId,
          email: dbUser.email,
          isActive: dbUser.isActive
        };
        console.log('[AUTH] After refresh - Successfully attached DB user to req.user with role:', dbUser.role);
      } else {
        console.error('[AUTH] After refresh - Database user not found for email:', userEmail);
        res.status(401).json({ message: "User not found in database after token refresh" });
        return;
      }
    } else {
      console.error('[AUTH] After refresh - No email in refreshed token claims');
      res.status(401).json({ message: "Invalid user claims after token refresh" });
      return;
    }
    
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};