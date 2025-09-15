# Demo Tenant Runbook

## Overview

The VoiceAgent SaaS Platform includes a comprehensive demo tenant system that allows potential customers to experience the platform without requiring full registration or payment setup. This runbook provides complete operational procedures for managing demo tenants, troubleshooting issues, and performing rollback operations.

## Table of Contents

1. [Demo Tenant Architecture](#demo-tenant-architecture)
2. [Setup and Configuration](#setup-and-configuration)
3. [Demo Flow Process](#demo-flow-process)
4. [Twilio Integration and Verification](#twilio-integration-and-verification)
5. [Monitoring and Observability](#monitoring-and-observability)
6. [Troubleshooting Guide](#troubleshooting-guide)
7. [Rollback Procedures](#rollback-procedures)
8. [Security Considerations](#security-considerations)
9. [Maintenance and Cleanup](#maintenance-and-cleanup)
10. [Emergency Procedures](#emergency-procedures)

---

## Demo Tenant Architecture

### System Components

**Demo Tenant Service** (`server/demo-tenant-service.ts`)
- Handles demo tenant creation and management
- Manages Twilio phone number provisioning
- Coordinates with billing and subscription systems
- Provides automated cleanup capabilities

**Phone Security Utils** (`server/phone-security-utils.ts`)
- Secure phone number validation and normalization
- E.164 format validation with regional support
- Cross-tenant security validation
- Supported regions: US, CA, GB, DE, FR, AT, CH, NL, BE, IE, AU, NZ, SE, NO, DK, FI

**Background Jobs System** (Managed by BackgroundJobManager)
- `cleanup-verification-codes`: Runs hourly to remove expired verification codes
- `cleanup-stale-demo-tenants`: Runs daily at 2 AM to remove expired demo tenants
- `cleanup-orphaned-phone-mappings`: Runs daily at 3 AM to clean up orphaned mappings
- System health monitoring and alerts

### Database Schema

**Demo Verification Codes Table** (`demo_verification_codes`)
```sql
CREATE TABLE demo_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  code VARCHAR(6) NOT NULL,
  phone_number VARCHAR(50) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  is_used BOOLEAN NOT NULL DEFAULT FALSE,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Key Database Entities**
- **Tenants**: Demo tenants with `status: 'trial'` and automatic cleanup after 72 hours
- **Phone Mappings**: Demo phone number assignments from predefined pool (`+1555DEMO001` through `+1555DEMO005`)
- **Usage Events**: Call tracking for demo usage analytics
- **Subscription Plans**: Demo-specific pricing tiers with usage limits

---

## Setup and Configuration

### Prerequisites

**Required Configuration**
```bash
# Database Configuration
DATABASE_URL=postgresql://connection_string

# Twilio Configuration (via keyLoader - stored in database)
# Use the admin panel or API to set these keys:
# - TWILIO_ACCOUNT_SID 
# - TWILIO_AUTH_TOKEN
# - TWILIO_PHONE_NUMBER (optional fallback)

# Demo-specific Configuration (hardcoded in service)
DEMO_TENANT_LIFETIME_HOURS=72  # Default: 72 hours
DEMO_MAX_DAILY_CALLS=50        # Default: 50 calls/day
DEMO_PHONE_REGION=AT           # Default: Austria
```

**Twilio Setup Requirements**
1. **Demo Phone Numbers**: System uses predefined demo pool (`+1555DEMO001` through `+1555DEMO005`)
2. **SMS Service**: Enabled for verification code delivery (optional - graceful fallback if not configured)
3. **Voice Service**: Configured for demo call handling
4. **Webhook Configuration**: Endpoints for call status and media streams
5. **Key Management**: Store Twilio credentials via keyLoader in database

### System Initialization

**1. Database Schema Deployment**
```bash
# Apply schema changes
npm run db:push

# Verify demo verification codes table exists
psql $DATABASE_URL -c "\d demo_verification_codes"
```

**2. Demo Service Verification**
```bash
# Test demo tenant creation
curl -X POST http://localhost:5000/api/demo/create-tenant \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Test Company",
    "contactEmail": "test@example.com",
    "contactPhone": "+4367712345678",
    "firstName": "John",
    "lastName": "Doe",
    "industry": "Technology",
    "useCase": "Customer Support"
  }'

# Verify system health and background jobs
curl http://localhost:5000/api/health/detailed \
  -H "Authorization: Bearer {admin_token}"
```

**3. Twilio Integration Test**
```bash
# Test phone verification
curl -X POST http://localhost:5000/api/demo/verify-phone \
  -H "Content-Type: application/json" \
  -d '{"tenantId": "demo-tenant-id", "code": "123456"}'
```

---

## Demo Flow Process

### Step 1: Demo Tenant Request

**Endpoint**: `POST /api/demo/create-tenant`

**Process Flow**:
1. **Input Validation**: Company name, email, phone, industry, and use case validation
2. **Phone Number Validation**: E.164 format validation for supported regions (US, CA, EU, AU, etc.)
3. **Rate Limiting Check**: Per-IP throttling via `demoTenantRateLimit`
4. **Demo Tenant Creation**: Creates tenant with `status: 'trial'`
5. **Verification Code Generation**: 6-digit secure random code
6. **SMS Delivery**: Twilio SMS with verification code (optional - graceful fallback)
7. **Verification Record Creation**: Stored in database with 10-minute expiration

**Success Response**:
```json
{
  "success": true,
  "tenantId": "uuid-demo-tenant-id",
  "botId": "uuid-demo-bot-id",
  "phoneNumber": "+4367712345678"
}
```

**Note**: Verification code is sent via SMS but never returned in API response for security.

**Error Handling**:
- **Invalid Phone Format**: 400 with validation details
- **Rate Limit Exceeded**: 429 with retry-after header
- **SMS Delivery Failure**: 500 with Twilio error details
- **Duplicate Demo**: 409 with existing demo information

### Step 2: Phone Verification

**Endpoint**: `POST /api/demo/verify-phone`

**Process Flow**:
1. **Verification Lookup**: Find active verification record
2. **Code Validation**: Constant-time comparison against stored code
3. **Expiration Check**: Verify code hasn't expired (10-minute window)
4. **Attempt Tracking**: Increment and check attempt count (max 3)
5. **One-Time Use**: Mark verification as used on success

**Success Response**:
```json
{
  "success": true,
  "message": "Phone number verified successfully",
  "nextStep": "Demo tenant creation initiated"
}
```

### Step 3: Demo Tenant Creation

**Automatic Process** (triggered by successful verification):

1. **Tenant Provisioning**:
   ```typescript
   const demoTenant = {
     name: companyName,
     status: 'trial',
     stripeCustomerId: null // No Stripe for demo
   }
   ```

2. **Subscription Setup**:
   - Demo-specific subscription plan (free tier)
   - Usage limits: 50 calls/day, 2 hours total talk time
   - Automatic expiration after 72 hours

3. **Bot Configuration**:
   ```typescript
   const demoBot = {
     name: 'Demo Voice Assistant',
     systemPrompt: 'Demo assistant for VoiceAgent platform',
     locale: 'de-AT',
     tenantId: demoTenant.id
   }
   ```

4. **Phone Number Assignment** (after verification):
   - Allocate demo number from predefined pool (`+1555DEMO001` - `+1555DEMO005`)
   - Round-robin allocation based on tenant ID hash
   - Create active phone mapping to demo bot
   - Configure for demo call handling

5. **User Account Creation**:
   ```typescript
   const demoUser = {
     email: contactEmail,
     password: hashedTempPassword,
     firstName: firstName || 'Demo',
     lastName: lastName || 'User',
     role: 'customer_admin',
     tenantId: demoTenant.id,
     isActive: true
   }
   ```

### Step 4: Demo Access Delivery

**Response with Demo Credentials**:
```json
{
  "success": true,
  "demoTenant": {
    "id": "demo-12345",
    "name": "Demo Customer 1234567890",
    "phoneNumber": "+43677123456789",
    "expiresAt": "2025-09-18T10:30:00Z"
  },
  "access": {
    "loginUrl": "https://platform.voiceagent.com/login",
    "email": "demo-xyz@voiceagent.demo",
    "temporaryPassword": "Demo#Pass123!",
    "mustChangePassword": true
  },
  "demoInstructions": {
    "callPhoneNumber": "+43677123456789",
    "expectedResponse": "Demo voice assistant will answer",
    "dashboardAccess": "Use provided credentials to access admin panel",
    "expirationNotice": "Demo expires in 72 hours"
  }
}
```

---

## Twilio Integration and Verification

### Phone Number Management

**Demo Phone Number Pool** (Predefined)
- **Format**: US demo numbers `+1555DEMO001` through `+1555DEMO005`
- **Type**: Demo placeholders for testing (not real Twilio numbers)
- **Pool Size**: 5 predefined demo numbers
- **Allocation**: Round-robin based on tenant ID hash

**Phone Number Lifecycle**:
1. **Pool Definition**: Hardcoded in `demo-tenant-service.ts`
2. **Assignment**: Allocate via hash-based round-robin selection
3. **Mapping**: Create phone mapping to demo bot in database
4. **Release**: Remove mapping after demo expiration
5. **Cleanup**: Automated background job removes stale assignments

### SMS Verification Setup

**Twilio SMS Configuration** (via keyLoader):
```javascript
// Credentials loaded from database via keyLoader
const accountSid = await keyLoader.getApiKey('twilio', 'TWILIO_ACCOUNT_SID');
const authToken = await keyLoader.getApiKey('twilio', 'TWILIO_AUTH_TOKEN');

if (accountSid && authToken) {
  const twilioClient = Twilio(accountSid, authToken);
  
  const sendVerificationSMS = async (phoneNumber, code, companyName) => {
    const message = `Your ${companyName} VoiceAgent demo verification code is: ${code}. This code expires in 10 minutes.`;
    
    return await twilioClient.messages.create({
      body: message,
      to: phoneNumber,
      from: process.env.TWILIO_PHONE_NUMBER || '+1234567890' // Demo fallback
    });
  };
} else {
  console.log('[DemoSetup] Twilio not configured - skipping SMS verification');
}
```

**SMS Template (German)**:
```
Ihr VoiceAgent Verifizierungscode: {CODE}
Gültig für 10 Minuten.
Nicht weitergeben.

VoiceAgent Demo
```

**Error Handling**:
- **Invalid Number**: Twilio validation error handling
- **SMS Delivery Failure**: Retry logic with exponential backoff
- **Rate Limiting**: Respect Twilio API limits and implement queuing

### Voice Call Routing

**Incoming Call Webhook** (`/telephony/incoming`)
```xml
<Response>
  <Say voice="alice" language="de-AT">
    Willkommen bei VoiceAgent Demo. 
    Ihr Anruf wird mit unserem Sprach-Bot verbunden.
  </Say>
  <Pause length="1"/>
  <Connect>
    <Stream url="wss://voiceagent.com/voice/stream"/>
  </Connect>
</Response>
```

**Call Status Tracking** (`/telephony/status`)
- Duration tracking for billing calculations
- Call quality metrics collection
- Error monitoring and alerting

**Security Validation** (using keyLoader):
```typescript
const validateTwilioSignature = async (url, body, signature) => {
  const authToken = await keyLoader.getApiKey('twilio', 'TWILIO_AUTH_TOKEN');
  if (!authToken) {
    throw new Error('Twilio auth token not configured');
  }
  return twilio.validateRequest(authToken, signature, url, body);
};
```

---

## Monitoring and Observability

### Key Metrics

**Demo Tenant Metrics**:
- Active demo tenants count
- Demo conversion rate (demo → paid)
- Average demo duration
- Demo phone number utilization
- Verification success/failure rates

**System Health Indicators**:
- SMS delivery success rate
- Phone number pool availability
- Twilio webhook response times
- Demo cleanup job execution status

### Logging and Alerting

**Critical Events to Monitor**:
```typescript
// High-priority alerts
[DEMO ALERT] SMS delivery failure rate > 5%
[DEMO ALERT] Phone number pool below 10 available
[DEMO ALERT] Demo creation failure rate > 10%
[DEMO ALERT] Twilio webhook errors > 1%

// Operational monitoring
[DEMO INFO] Demo tenant created: {tenantId}
[DEMO INFO] Phone verification successful: {phoneNumber}
[DEMO INFO] Demo cleanup completed: {deletedCount} expired demos
```

**Monitoring Dashboard Queries**:
```sql
-- Active demo tenants
SELECT COUNT(*) FROM tenants WHERE status = 'demo' AND demo_expires_at > NOW();

-- Demo conversion rate (last 30 days)
SELECT 
  COUNT(CASE WHEN status = 'demo' THEN 1 END) as demos,
  COUNT(CASE WHEN status = 'active' AND created_at > demo_expires_at THEN 1 END) as conversions
FROM tenants 
WHERE created_at > NOW() - INTERVAL '30 days';

-- Phone verification success rate
SELECT 
  COUNT(CASE WHEN is_used = true THEN 1 END) * 100.0 / COUNT(*) as success_rate
FROM demo_verification_codes 
WHERE created_at > NOW() - INTERVAL '24 hours';
```

### Performance Monitoring

**Response Time SLAs**:
- Demo setup request: < 2 seconds
- SMS verification delivery: < 30 seconds  
- Demo tenant creation: < 5 seconds
- Twilio webhook response: < 1 second

**Resource Utilization**:
- Database connection pool usage
- Twilio API rate limit consumption
- Background job queue depth
- Memory usage for verification codes storage

---

## Troubleshooting Guide

### Common Issues and Solutions

#### 1. SMS Delivery Failures

**Symptoms**:
- Users report not receiving verification codes
- High SMS failure rate in logs
- Twilio error responses

**Diagnosis**:
```bash
# Check Twilio account status
curl -X GET https://api.twilio.com/2010-04-01/Accounts/{AccountSid}.json \
  -u {AccountSid}:{AuthToken}

# Verify phone number format
echo "+4367712345678" | grep -E "^\+43[0-9]{10,13}$"

# Check SMS delivery logs
grep "SMS_DELIVERY_ERROR" /var/log/voiceagent/app.log
```

**Solutions**:
1. **Account Issues**: Verify Twilio account balance and SMS service status
2. **Phone Format**: Ensure E.164 format compliance for Austrian numbers
3. **Rate Limiting**: Check Twilio API rate limits and implement backoff
4. **Number Validation**: Use Twilio Lookup API for phone validation

#### 2. Phone Number Pool Exhaustion

**Symptoms**:
- Demo setup fails with "No phone numbers available"
- High phone pool utilization alerts
- New demos cannot be created

**Diagnosis**:
```sql
-- Check available phone numbers
SELECT COUNT(*) FROM twilio_phone_pool WHERE status = 'available';

-- Check stuck allocations
SELECT phone_number, allocated_at, tenant_id 
FROM phone_mappings 
WHERE is_active = true 
AND created_at < NOW() - INTERVAL '3 days';
```

**Solutions**:
1. **Purchase More Numbers**: Acquire additional Austrian numbers from Twilio
2. **Cleanup Stale Allocations**: Run manual cleanup for expired demos
3. **Increase Pool Size**: Adjust minimum pool size configuration
4. **Implement Waitlist**: Queue demo requests when pool is exhausted

#### 3. Demo Tenant Creation Failures

**Symptoms**:
- Verification succeeds but demo creation fails
- Users stuck at "Creating demo tenant" step
- Incomplete demo tenant records

**Diagnosis**:
```bash
# Check demo service logs
grep "\[DemoSetup\]" /var/log/voiceagent/app.log

# Verify demo tenants (status = 'trial')
psql $DATABASE_URL -c "SELECT id, name, status, created_at FROM tenants WHERE status = 'trial' ORDER BY created_at DESC LIMIT 5;"

# Check subscription plan availability
psql $DATABASE_URL -c "SELECT * FROM subscription_plans WHERE name LIKE '%demo%';"
```

**Solutions**:
1. **Database Issues**: Check foreign key constraints and schema integrity
2. **Subscription Setup**: Ensure demo subscription plans exist and are active
3. **Resource Limits**: Verify system resources for tenant creation
4. **Rollback Handling**: Implement proper cleanup for failed creations

#### 4. Twilio Webhook Failures

**Symptoms**:
- Incoming calls not routed correctly
- Call status updates missing
- Webhook timeout errors

**Diagnosis**:
```bash
# Check webhook configuration
curl -X GET https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/IncomingPhoneNumbers.json \
  -u {AccountSid}:{AuthToken}

# Verify webhook signature validation
grep "WEBHOOK_VALIDATION_FAILED" /var/log/voiceagent/app.log

# Test webhook endpoint
curl -X POST http://localhost:5000/telephony/incoming \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "CallSid=test&From=%2B4367712345678&To=%2B43677987654321"
```

**Solutions**:
1. **URL Configuration**: Verify webhook URLs in Twilio console
2. **Signature Validation**: Check auth token configuration and signature logic
3. **Response Format**: Ensure TwiML responses are properly formatted
4. **Timeout Issues**: Optimize webhook response time and add caching

### Performance Issues

#### High Response Times

**Investigation Steps**:
1. **Database Performance**: Check slow query logs and index usage
2. **External API Latency**: Monitor Twilio API response times
3. **Resource Contention**: Analyze CPU, memory, and connection usage
4. **Background Job Impact**: Verify cleanup jobs don't block demo creation

**Optimization Strategies**:
- Database query optimization and indexing
- Connection pooling configuration
- Caching for phone number pool status
- Asynchronous processing for non-critical operations

#### Memory Leaks

**Monitoring**:
```bash
# Memory usage tracking
ps aux | grep node | grep voiceagent

# Heap dump analysis
node --inspect=0.0.0.0:9229 server/index.js
```

**Common Causes**:
- Unclosed database connections
- Verification code accumulation without cleanup
- Event listener memory leaks
- Large object retention in verification cache

---

## Rollback Procedures

### Emergency Rollback Scenarios

#### 1. Complete Demo System Shutdown

**When to Use**:
- Critical security vulnerability discovered
- System-wide failures affecting demos
- Data corruption in demo tenant system

**Procedure**:
```bash
# 1. Disable demo endpoints immediately
curl -X POST http://localhost:5000/api/admin/maintenance \
  -H "Authorization: Bearer {admin_token}" \
  -d '{"mode": "demo_disabled", "reason": "Emergency maintenance"}'

# 2. Stop background cleanup jobs
pkill -f "background-jobs"

# 3. Archive existing demo data
pg_dump -t tenants -t demo_verification_codes $DATABASE_URL > demo_backup_$(date +%Y%m%d_%H%M).sql

# 4. Disable Twilio webhooks temporarily
# (Manual action in Twilio console)
```

**Recovery Steps**:
1. **Fix underlying issue** based on incident analysis
2. **Validate fix** in staging environment with full demo flow
3. **Re-enable services** gradually with monitoring
4. **Notify users** of service restoration

#### 2. Phone Number Pool Recovery

**When to Use**:
- Incorrect phone number assignments
- Pool corruption or data inconsistency
- Mass demo cancellation needed

**Procedure**:
```sql
-- 1. Backup current phone mappings
CREATE TABLE phone_mappings_backup AS SELECT * FROM phone_mappings;

-- 2. Release all demo phone numbers
UPDATE phone_number_mappings 
SET is_active = false 
WHERE tenant_id IN (SELECT id FROM tenants WHERE status = 'trial');

-- 3. Release demo phone numbers (predefined pool)
-- Note: Demo numbers (+1555DEMO001-005) are reusable, just remove mappings

-- 4. Verify pool status
SELECT status, COUNT(*) FROM twilio_phone_pool GROUP BY status;
```

#### 3. Demo Tenant Data Cleanup

**When to Use**:
- Bulk removal of corrupted demo tenants
- Privacy compliance requirements
- System performance issues

**Safe Cleanup Procedure**:
```sql
-- 1. Identify demo tenants for cleanup
SELECT id, name, created_at, demo_expires_at 
FROM tenants 
WHERE status = 'trial' 
AND created_at < NOW() - INTERVAL '3 days'; -- Demo lifetime: 72 hours

-- 2. Backup before deletion
CREATE TABLE demo_cleanup_backup AS 
SELECT t.*, dm.phone_number 
FROM tenants t 
LEFT JOIN phone_number_mappings dm ON t.id = dm.tenant_id 
WHERE t.status = 'trial' AND t.created_at < NOW() - INTERVAL '3 days';

-- 3. Clean related data (in order to respect foreign keys)
DELETE FROM usage_events WHERE tenant_id IN (...);
DELETE FROM phone_mappings WHERE tenant_id IN (...);
DELETE FROM users WHERE tenant_id IN (...);
DELETE FROM bots WHERE tenant_id IN (...);
DELETE FROM subscriptions WHERE tenant_id IN (...);
DELETE FROM tenants WHERE id IN (...);

-- 4. Verify cleanup
SELECT COUNT(*) FROM tenants WHERE status = 'trial' AND created_at > NOW() - INTERVAL '3 days';
```

### Data Recovery Procedures

#### Verification Code Recovery

**Scenario**: Verification codes lost or corrupted

```sql
-- Check verification code status
SELECT 
  phone_number,
  verification_code,
  created_at,
  expires_at,
  is_used,
  attempts
FROM demo_verification_codes 
WHERE phone_number = '+4367712345678'
ORDER BY created_at DESC;

-- Reset verification for specific phone number
UPDATE demo_verification_codes 
SET is_used = false, attempts = 0 
WHERE phone_number = '+4367712345678' 
AND created_at = (
  SELECT MAX(created_at) 
  FROM demo_verification_codes 
  WHERE phone_number = '+4367712345678'
);
```

#### Demo Tenant Recovery

**Scenario**: Accidentally deleted demo tenant needs restoration

```sql
-- Restore from backup (if available)
INSERT INTO tenants SELECT * FROM demo_cleanup_backup WHERE id = 'target_demo_id';

-- Recreate associated records
INSERT INTO users (email, password, tenant_id, role) 
VALUES ('demo-recovered@voiceagent.demo', 'temp_hash', 'target_demo_id', 'customer_admin');

-- Reassign phone number
UPDATE phone_mappings 
SET tenant_id = 'target_demo_id', is_active = true 
WHERE phone_number = '+4367712345678';
```

---

## Security Considerations

### Demo Tenant Isolation

**Tenant Isolation Enforcement**:
- All database queries include tenant ID filtering
- API endpoints validate tenant context
- Phone mappings are tenant-scoped
- Usage events are isolated per tenant

**Security Controls**:
```typescript
// Tenant context middleware
const requireTenantContext = (req, res, next) => {
  if (!req.user?.tenantId) {
    return res.status(401).json({ error: 'Tenant context required' });
  }
  req.tenantId = req.user.tenantId;
  next();
};

// Demo tenant specific validation
const validateDemoAccess = async (req, res, next) => {
  const tenant = await storage.getTenant(req.tenantId);
  if (tenant.status === 'trial' && tenant.created_at < new Date(Date.now() - 72 * 60 * 60 * 1000)) {
    return res.status(403).json({ error: 'Demo tenant has expired' });
  }
  next();
};
```

### Verification Code Security

**Secure Code Generation**:
```typescript
const generateVerificationCode = () => {
  const code = crypto.randomInt(100000, 999999).toString();
  return code;
};
```

**Constant-Time Validation**:
```typescript
const validateCode = (provided, stored) => {
  return crypto.timingSafeEqual(
    Buffer.from(provided, 'utf8'),
    Buffer.from(stored, 'utf8')
  );
};
```

**Rate Limiting Protection**:
- Per-IP limits: 3 requests per hour
- Per-phone limits: 3 requests per hour  
- Per-verification limits: 3 attempts maximum
- Exponential backoff for repeated failures

### Data Protection

**Sensitive Data Handling**:
- Verification codes are never logged in plaintext
- Phone numbers are stored in E.164 format only
- Demo credentials use secure random generation
- Automatic expiration prevents data accumulation

**Audit Trail**:
```typescript
const auditDemoAction = (action, tenantId, phoneNumber, userId) => {
  console.log(`[DEMO AUDIT] ${action} - Tenant: ${tenantId}, Phone: ${maskPhone(phoneNumber)}, User: ${userId}, IP: ${req.ip}`);
};
```

---

## Maintenance and Cleanup

### Automated Cleanup Jobs

#### Background Job Configuration

**Cleanup Schedule**:
```typescript
const cleanupJobs = [
  {
    name: 'cleanup-verification-codes',
    schedule: '0 * * * *', // Every hour
    description: 'Remove expired verification codes'
  },
  {
    name: 'cleanup-stale-demo-tenants', 
    schedule: '0 2 * * *', // Daily at 2 AM
    description: 'Remove expired demo tenants'
  },
  {
    name: 'cleanup-orphaned-phone-mappings',
    schedule: '0 3 * * *', // Daily at 3 AM  
    description: 'Remove orphaned phone mappings'
  }
];
```

#### Verification Code Cleanup

**Process**:
1. **Identify Expired Codes**: Find codes past expiration time
2. **Validate Deletion Safety**: Ensure no active references
3. **Remove Records**: Delete from database
4. **Log Results**: Record cleanup statistics

**Implementation**:
```sql
DELETE FROM demo_verification_codes 
WHERE expires_at < NOW() 
OR (created_at < NOW() - INTERVAL '24 hours' AND is_used = true);
```

#### Demo Tenant Cleanup

**Cleanup Criteria**:
- Demo expiration time has passed
- No recent activity (7+ days)
- No active phone calls
- No pending billing items

**Cleanup Process**:
```typescript
const cleanupExpiredDemos = async () => {
  const expiredTenants = await storage.getExpiredDemoTenants();
  
  for (const tenant of expiredTenants) {
    // 1. Release phone numbers
    await releasePhoneNumbers(tenant.id);
    
    // 2. Archive usage data
    await archiveUsageEvents(tenant.id);
    
    // 3. Remove tenant and related data
    await removeDemoTenant(tenant.id);
    
    console.log(`[CLEANUP] Removed expired demo tenant: ${tenant.id}`);
  }
};
```

### Manual Maintenance Procedures

#### Weekly Maintenance Tasks

```bash
#!/bin/bash
# Weekly demo system maintenance

# 1. Check phone number pool health
psql $DATABASE_URL -c "
  SELECT 
    status,
    COUNT(*) as count,
    COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() as percentage
  FROM twilio_phone_pool 
  GROUP BY status;
"

# 2. Analyze demo conversion metrics
psql $DATABASE_URL -c "
  SELECT 
    DATE_TRUNC('week', created_at) as week,
    COUNT(CASE WHEN status = 'demo' THEN 1 END) as demos_created,
    COUNT(CASE WHEN status = 'active' AND previous_status = 'demo' THEN 1 END) as conversions
  FROM tenants 
  WHERE created_at > NOW() - INTERVAL '8 weeks'
  GROUP BY week
  ORDER BY week;
"

# 3. Clean up old log files
find /var/log/voiceagent -name "*.log" -mtime +30 -delete

# 4. Verify Twilio webhook configuration
curl -X GET "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/IncomingPhoneNumbers.json" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" | jq '.incoming_phone_numbers[] | {phone_number, voice_url, status_callback_url}'
```

#### Monthly Maintenance Tasks

```bash
#!/bin/bash
# Monthly comprehensive maintenance

# 1. Archive old demo data
pg_dump -t demo_verification_codes $DATABASE_URL > archives/demo_verification_$(date +%Y%m).sql

# 2. Optimize database performance
psql $DATABASE_URL -c "
  VACUUM ANALYZE demo_verification_codes;
  VACUUM ANALYZE tenants;
  VACUUM ANALYZE phone_mappings;
"

# 3. Update phone number pool
# (Manual review and purchase of additional numbers if needed)

# 4. Security audit
grep -i "demo.*security\|demo.*error" /var/log/voiceagent/*.log | tail -100

# 5. Performance analysis
psql $DATABASE_URL -c "
  SELECT 
    schemaname,
    tablename,
    n_tup_ins,
    n_tup_upd,
    n_tup_del,
    last_autoanalyze
  FROM pg_stat_user_tables 
  WHERE tablename LIKE '%demo%';
"
```

---

## Emergency Procedures

### Incident Response

#### High-Priority Incidents

**P1 - Demo System Complete Failure**
```bash
# Immediate Response (< 5 minutes)
1. Page on-call engineer
2. Disable demo endpoints
3. Activate maintenance mode
4. Check system status dashboard

# Investigation (< 15 minutes)  
1. Check application logs for errors
2. Verify database connectivity
3. Test Twilio API accessibility
4. Confirm external service status

# Resolution (< 30 minutes)
1. Implement fix or rollback
2. Validate service restoration
3. Monitor for stability
4. Update incident status
```

**P2 - High SMS Delivery Failure Rate**
```bash
# Response (< 15 minutes)
1. Check Twilio account status
2. Verify SMS service health
3. Implement fallback verification method
4. Alert users of potential delays

# Mitigation
1. Switch to voice verification if available
2. Increase SMS retry attempts
3. Contact Twilio support if needed
4. Monitor resolution progress
```

#### Recovery Checklists

**Database Corruption Recovery**:
- [ ] Stop all demo-related services
- [ ] Assess extent of data corruption
- [ ] Restore from latest known good backup
- [ ] Replay transactions if possible
- [ ] Validate data integrity
- [ ] Resume services incrementally
- [ ] Monitor for continued issues

**Twilio Service Outage**:
- [ ] Confirm outage with Twilio status page
- [ ] Activate SMS bypass mode (manual verification)
- [ ] Notify users of alternative verification
- [ ] Queue demo requests for later processing
- [ ] Resume normal operation when service restored
- [ ] Process queued requests

### Disaster Recovery

#### Backup and Restore Procedures

**Daily Backups**:
```bash
#!/bin/bash
# Automated daily backup

# Database backup
pg_dump $DATABASE_URL > backups/voiceagent_$(date +%Y%m%d).sql

# Configuration backup
tar -czf backups/config_$(date +%Y%m%d).tar.gz /etc/voiceagent/

# Phone number pool backup
psql $DATABASE_URL -c "COPY twilio_phone_pool TO STDOUT" > backups/phone_pool_$(date +%Y%m%d).csv

# Cleanup old backups (keep 30 days)
find backups/ -name "*.sql" -mtime +30 -delete
```

**Recovery Testing**:
```bash
#!/bin/bash
# Monthly disaster recovery test

# 1. Create test environment
docker-compose -f docker-compose.test.yml up -d

# 2. Restore from backup
psql $TEST_DATABASE_URL < backups/voiceagent_$(date -d "1 day ago" +%Y%m%d).sql

# 3. Test demo flow
curl -X POST http://test-api:5000/api/demo/setup \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+4367712345678"}'

# 4. Validate system functionality
npm run test:integration

# 5. Document results
echo "DR test $(date): $?" >> dr_test_results.log
```

#### Business Continuity

**Service Level Objectives**:
- Demo system availability: 99.5% (excluding planned maintenance)
- SMS delivery time: < 30 seconds (95th percentile)  
- Demo tenant creation: < 5 seconds (95th percentile)
- Recovery Time Objective (RTO): 4 hours
- Recovery Point Objective (RPO): 1 hour

**Escalation Procedures**:
1. **On-call Engineer** (0-15 minutes): Initial response and assessment
2. **Team Lead** (15-30 minutes): Coordination and resource allocation  
3. **Engineering Manager** (30-60 minutes): Cross-team coordination
4. **VP Engineering** (>60 minutes): Executive decision making

---

## Appendices

### A. Configuration Reference

**Environment Variables**:
```bash
# Required Configuration
TWILIO_ACCOUNT_SID=AC1234567890abcdef1234567890abcdef
TWILIO_AUTH_TOKEN=your_auth_token_here
DATABASE_URL=postgresql://user:pass@host:5432/database

# Optional Demo Configuration
DEMO_TENANT_LIFETIME_HOURS=72
DEMO_MAX_DAILY_CALLS=50
DEMO_PHONE_REGION=AT
DEMO_SMS_TEMPLATE="Ihr VoiceAgent Code: {CODE}"
DEMO_RATE_LIMIT_PER_IP=3
DEMO_RATE_LIMIT_WINDOW_HOURS=1

# Twilio Webhook Configuration  
TWILIO_WEBHOOK_BASE_URL=https://api.voiceagent.com
TWILIO_VOICE_WEBHOOK_PATH=/telephony/incoming
TWILIO_STATUS_WEBHOOK_PATH=/telephony/status
```

### B. API Reference

**Demo Setup Endpoint**:
```
POST /api/demo/setup
Content-Type: application/json

{
  "phoneNumber": "+4367712345678"
}

Response:
{
  "success": true,
  "message": "Verification code sent",
  "expiresIn": 600,
  "phoneNumber": "+4367712345678"
}
```

**Phone Verification Endpoint**:
```
POST /api/demo/verify-phone  
Content-Type: application/json

{
  "phoneNumber": "+4367712345678",
  "verificationCode": "123456"
}

Response:
{
  "success": true,
  "demoTenant": { ... },
  "access": { ... },
  "demoInstructions": { ... }
}
```

### C. Database Schema

**Demo Verification Codes**:
```sql
CREATE TABLE demo_verification_codes (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR,
  phone_number VARCHAR NOT NULL,
  verification_code VARCHAR NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  is_used BOOLEAN NOT NULL DEFAULT FALSE,
  
  INDEX idx_phone_created (phone_number, created_at),
  INDEX idx_expires_at (expires_at),
  INDEX idx_tenant_phone (tenant_id, phone_number)
);
```

**Twilio Phone Pool**:
```sql
CREATE TABLE twilio_phone_pool (
  id SERIAL PRIMARY KEY,
  phone_number VARCHAR UNIQUE NOT NULL,
  status VARCHAR NOT NULL CHECK (status IN ('available', 'allocated', 'maintenance')),
  allocated_at TIMESTAMP,
  tenant_id VARCHAR,
  capabilities JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  INDEX idx_status (status),
  INDEX idx_tenant_id (tenant_id)
);
```

### D. Monitoring Queries

**Demo System Health**:
```sql
-- Active demo count
SELECT COUNT(*) as active_demos 
FROM tenants 
WHERE status = 'demo' AND demo_expires_at > NOW();

-- Verification success rate (last 24h)
SELECT 
  COUNT(CASE WHEN is_used = true THEN 1 END) * 100.0 / COUNT(*) as success_rate
FROM demo_verification_codes 
WHERE created_at > NOW() - INTERVAL '24 hours';

-- Phone pool utilization
SELECT 
  status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
FROM twilio_phone_pool 
GROUP BY status;

-- Average demo creation time (derived from logs)
-- This would require log analysis tools
```

### E. Troubleshooting Commands

**Common Diagnostic Commands**:
```bash
# Check demo tenant status
psql $DATABASE_URL -c "SELECT id, name, status, demo_expires_at FROM tenants WHERE status = 'demo' ORDER BY created_at DESC LIMIT 10;"

# Verify phone number pool
psql $DATABASE_URL -c "SELECT status, COUNT(*) FROM twilio_phone_pool GROUP BY status;"

# Check recent verification attempts
psql $DATABASE_URL -c "SELECT phone_number, verification_code, created_at, is_used, attempts FROM demo_verification_codes WHERE created_at > NOW() - INTERVAL '1 hour' ORDER BY created_at DESC;"

# Test Twilio connectivity
curl -X GET "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID.json" -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN"

# Check application health
curl http://localhost:5000/health/detailed

# Monitor background jobs
curl http://localhost:5000/api/admin/background-jobs/status
```

---

## Contact Information

**On-Call Engineer**: +43 XXX XXX XXXX
**Team Lead**: engineering-lead@voiceagent.com  
**Twilio Support**: https://support.twilio.com
**Emergency Escalation**: emergency@voiceagent.com

**Runbook Version**: 1.0  
**Last Updated**: September 15, 2025  
**Next Review**: October 15, 2025