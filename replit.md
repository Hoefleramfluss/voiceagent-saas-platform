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