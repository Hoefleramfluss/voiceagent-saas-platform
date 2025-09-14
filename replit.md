# Overview

This is a multi-tenant VoiceAgent SaaS platform that provides automated voice bot services to customers. The application features separate admin and customer portals, with comprehensive billing, support, and bot management capabilities. The system is designed to automatically provision VoiceBots using Twilio integration and handle usage-based billing through Stripe.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript using Vite for development and build tooling
- **Styling**: Tailwind CSS with shadcn/ui component library for consistent design
- **State Management**: TanStack Query (React Query) for server state management and caching
- **Routing**: Wouter for lightweight client-side routing
- **Authentication**: Context-based auth provider with role-based access control
- **Multi-tenant UI**: Separate admin and customer portals with role-based navigation

## Backend Architecture
- **Framework**: Express.js with TypeScript for RESTful API services
- **Database**: PostgreSQL with Drizzle ORM for type-safe database operations
- **Authentication**: Passport.js with local strategy, session-based auth with HTTP-only cookies
- **Authorization**: Role-based access control (platform_admin, customer_admin, customer_user, support)
- **Multi-tenancy**: Tenant isolation middleware and tenant-scoped data access
- **API Structure**: RESTful endpoints organized by feature domains (auth, tenants, bots, usage, billing, support)

## Data Storage
- **Primary Database**: PostgreSQL with Drizzle ORM and migrations via Alembic-style tooling
- **Schema Design**: Multi-tenant architecture with tenant isolation
- **Key Entities**: Users, Tenants, Bots, Usage Events, Invoices, Support Tickets, Provisioning Jobs, API Keys
- **Session Storage**: PostgreSQL-backed session store using connect-pg-simple

## Authentication & Authorization
- **Strategy**: Passport.js local strategy with bcrypt password hashing
- **Session Management**: Express session middleware with PostgreSQL session store
- **Role-Based Access**: Four distinct roles with hierarchical permissions
- **Security**: Secure password hashing with scrypt, timing-safe password comparison
- **API Protection**: Route-level authentication and role-based middleware guards

## External Dependencies

### Payment Processing
- **Stripe Integration**: Usage-based billing with webhook support for payment events
- **Invoice Management**: Automated invoice generation based on usage metrics
- **Customer Portal**: Stripe customer portal integration for self-service billing

### Voice/Telephony Services
- **Twilio**: Phone number provisioning and voice call handling
- **Speech-to-Text**: Google Cloud Speech API integration (placeholder for de-AT locale)
- **Text-to-Speech**: ElevenLabs API integration for voice synthesis
- **Call Management**: Webhook-based call routing and media stream processing

### Infrastructure & Deployment
- **Database**: Neon PostgreSQL serverless database
- **Development**: Vite development server with HMR and error overlay
- **Build System**: ESBuild for server bundling, Vite for client bundling
- **Deployment Ready**: Heroku-optimized with proper build scripts and environment configuration

### Development Tools
- **Type Safety**: Full TypeScript coverage across frontend and backend
- **Schema Validation**: Zod schemas for runtime type validation
- **Database Migrations**: Drizzle Kit for schema management and migrations
- **Code Quality**: ESLint and TypeScript compiler checks

### API Key Management
- **Encryption**: Basic Base64 encoding for API key storage (development-ready)
- **Service Integration**: Support for multiple external service API keys (Stripe, OpenAI, Twilio, Google, ElevenLabs, Heroku)
- **Security**: API key masking for display purposes and secure storage patterns

# Operational Procedures

## Deployment & Production Readiness

### Pre-Deployment Checklist
- [ ] All required environment variables configured (see Required Environment Variables below)
- [ ] Database schema is up-to-date (`npm run db:push`)
- [ ] Static assets have been built (`npm run build`)
- [ ] External service integrations tested (Stripe, Twilio, SendGrid)
- [ ] Security headers and rate limiting verified
- [ ] Health check endpoints responding correctly

### Startup Process
The application follows a structured startup sequence with comprehensive logging:

1. **Security Configuration**: Production security middleware with environment-aware headers
2. **Static File Setup**: Automated asset verification with fallback mechanisms
3. **Database Connection**: PostgreSQL connectivity verification
4. **Route Registration**: API endpoint initialization
5. **Smoke Tests**: Deployment verification (production only)
6. **Server Startup**: HTTP server binding and health check activation

### Expected Startup Logs
```
[SECURITY] Production security middleware enabled for production environment
[STARTUP] Starting VoiceAgent SaaS Platform in production mode
[STARTUP] Process ID: 12345
[STARTUP] Node version: v20.19.3
[STARTUP] Routes registered successfully
[STARTUP] Setting up static file serving for production
[STARTUP] ✅ Created symlink: /server/public → /dist/public
[STARTUP] ✅ Static file serving configured
[SMOKE TESTS] 🔍 Running deployment verification...
[SMOKE TESTS] ✅ Static Assets: Static files accessible
[SMOKE TESTS] ✅ Environment Variables: All critical environment variables present
[SMOKE TESTS] ✅ External Services: All services configured
[SMOKE TESTS] ✅ Database: Database URL configured
[SMOKE TESTS] ✅ Critical Routes: Application configured for production
[SMOKE TESTS] Overall Status: ✅ PASS
[STARTUP] ✅ All smoke tests passed - system ready for deployment
[STARTUP] ✅ VoiceAgent SaaS Platform successfully started!
[STARTUP] 🚀 Server listening on http://0.0.0.0:5000
```

## Required Environment Variables

### Core Application
- `NODE_ENV`: Environment (development/staging/production)
- `DATABASE_URL`: PostgreSQL connection string
- `PORT`: Server port (defaults to 5000)
- `HOST`: Server host (defaults to 0.0.0.0)

### External Services
- `STRIPE_SECRET_KEY`: Stripe payment processing
- `STRIPE_PUBLISHABLE_KEY`: Stripe client-side integration
- `VITE_STRIPE_PUBLISHABLE_KEY`: Frontend Stripe integration
- `SENDGRID_API_KEY`: Email service integration
- `TWILIO_ACCOUNT_SID`: Voice service integration
- `TWILIO_AUTH_TOKEN`: Twilio authentication

### Security & Monitoring
- `FRONTEND_URL`: Trusted origin for CORS (production)
- `ADMIN_ALLOWED_IPS`: IP whitelist for admin endpoints (optional)
- `HEALTH_CHECK_ALLOWED_IPS`: IP whitelist for detailed health checks (optional)
- `INTERNAL_REQUEST_TOKEN`: Token for internal health check requests (optional)

## Troubleshooting Guide

### Static File Issues
**Problem**: `❌ Static files not found` or 404 errors on frontend assets

**Causes & Solutions**:
1. **Build not run**: Execute `npm run build` to generate static assets
2. **Symlink creation failed**: Check file system permissions
   - Fallback: Manual copy from `dist/public` to `server/public`
3. **Directory permissions**: Ensure read/write access to server directory

**Verification**:
```bash
ls -la server/public/          # Check if files exist
ls -la dist/public/           # Check build output
curl localhost:5000/         # Test static file serving
```

### Database Connection Issues
**Problem**: Database connection failures or query errors

**Causes & Solutions**:
1. **Missing DATABASE_URL**: Add PostgreSQL connection string to environment
2. **Schema mismatch**: Run `npm run db:push --force` to sync schema
3. **Connection limits**: Check database provider connection limits

**Verification**:
```bash
curl localhost:5000/health/detailed  # Check database status
```

### Environment Variable Issues
**Problem**: Service integration failures or missing configuration

**Causes & Solutions**:
1. **Missing API keys**: Verify all required environment variables are set
2. **Invalid key format**: Check API key format and permissions
3. **Service configuration**: Verify external service settings

**Verification**: 
- Smoke tests will identify missing environment variables during startup
- Check service status in detailed health check endpoint

### Rate Limiting Issues
**Problem**: Excessive 429 "Too Many Requests" responses

**Causes & Solutions**:
1. **Legitimate traffic spikes**: Scale application or adjust rate limits
2. **DDoS or abuse**: Review IP patterns and consider IP blocking
3. **Development testing**: Set `NODE_ENV=development` for relaxed limits

**Rate Limit Configuration**:
- Global: 1000/15min (production), 2000/15min (development)
- Auth endpoints: 5/15min (production), 20/15min (development)
- Admin operations: 50/10min (production), 100/10min (development)
- Billing operations: 20/15min (production), 50/15min (development)
- Webhooks: 100/5min (production), 200/5min (development)

### Health Check Endpoints
**Basic Health Check**: `GET /health`
- Public endpoint for load balancers and monitoring
- Returns basic application status and uptime

**Detailed Health Check**: `GET /health/detailed`
- Restricted endpoint with IP whitelisting and token authentication
- Returns memory usage, service status, and system metrics
- Access control via `HEALTH_CHECK_ALLOWED_IPS` and `X-Internal-Request` header

### Security Configuration
The application includes comprehensive production security:

**Security Headers**:
- HSTS with preload (production only)
- Content Security Policy (CSP) with voice feature support
- Cross-Origin policies (COEP/COOP/CORP) with Stripe compatibility
- Permissions Policy allowing microphone/speaker access

**CORS Configuration**:
- Environment-specific trusted origins
- Credential support for authenticated requests
- Preflight request handling

**Audit Logging**:
- Sensitive admin operations logged with user/tenant context
- IP address and user agent tracking
- Timestamp and endpoint logging for security analysis

### Emergency Procedures

**Service Unavailable**:
1. Check application logs for startup errors
2. Verify database connectivity
3. Confirm static file availability
4. Validate environment variable configuration

**Performance Issues**:
1. Monitor memory usage via `/health/detailed`
2. Check database query performance
3. Review rate limiting effectiveness
4. Analyze request patterns

**Security Incidents**:
1. Review audit logs for suspicious activity
2. Check rate limiting effectiveness
3. Verify IP whitelist configuration
4. Monitor authentication failure patterns

### Monitoring & Observability
**Key Metrics to Monitor**:
- Response times for API endpoints
- Rate limit hit rates
- Database connection pool usage
- Memory consumption and garbage collection
- External service response times

**Log Analysis**:
- Search for `[ERROR]` entries for critical issues
- Monitor `[SECURITY AUDIT]` logs for suspicious activity
- Track startup sequence completion
- Review smoke test results in production deployments