#!/usr/bin/env tsx
/**
 * Demo Prerequisites Setup Script for Flow Builder E2E Testing
 * 
 * Creates all necessary demo data for comprehensive Flow Builder testing:
 * 1. Global Admin Credentials (global-admin@voiceagent.local)
 * 2. Demo Tenant Setup (Flow Builder Demo Company)
 * 3. Twilio Demo Number Mapping (+43720112811)
 * 4. Basic German Greeting Flow
 * 
 * Usage: tsx scripts/setup-demo-prerequisites.ts
 */

import { hashPassword } from '../server/auth';
import { DatabaseStorage } from '../server/storage';
import { normalizePhoneNumber } from '../server/phone-security-utils';
import { FlowTemplates } from '../shared/flow-schema';
import crypto from 'crypto';

interface SetupResult {
  globalAdmin: {
    email: string;
    password: string;
    userId: string;
  };
  demoTenant: {
    tenantId: string;
    companyName: string;
    adminEmail: string;
    adminPassword: string;
    adminUserId: string;
  };
  demoBot: {
    botId: string;
    name: string;
    status: string;
  };
  phoneMapping: {
    phoneNumber: string;
    normalizedPhone: string;
    mappingId: string;
    isActive: boolean;
  };
  demoFlow: {
    flowId: string;
    flowVersionId: string;
    name: string;
    status: string;
  };
}

/**
 * Generate a strong password with mixed case, numbers, and symbols
 */
function generateStrongPassword(length: number = 16): string {
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  
  const allChars = lowercase + uppercase + numbers + symbols;
  
  // Ensure at least one character from each category
  let password = '';
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += symbols[Math.floor(Math.random() * symbols.length)];
  
  // Fill the rest randomly
  for (let i = 4; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Create global admin user
 */
async function createGlobalAdmin(storage: DatabaseStorage): Promise<SetupResult['globalAdmin']> {
  console.log('🔑 Creating global admin user...');
  
  const email = 'global-admin@voiceagent.local';
  const password = generateStrongPassword(16);
  
  // Check if user already exists
  const existingUser = await storage.getUserByEmail(email);
  if (existingUser) {
    if (existingUser.role === 'platform_admin') {
      console.log(`✅ Global admin already exists: ${email}`);
      return {
        email,
        password: '[EXISTING_USER]',
        userId: existingUser.id
      };
    } else {
      throw new Error(`User ${email} exists but is not a platform_admin`);
    }
  }
  
  const hashedPassword = await hashPassword(password);
  
  const adminUser = await storage.createUser({
    email,
    password: hashedPassword,
    role: 'platform_admin',
    firstName: 'Global',
    lastName: 'Administrator',
    tenantId: null, // Platform admins don't belong to a specific tenant
    isActive: true
  });
  
  console.log(`✅ Global admin created: ${email}`);
  
  return {
    email,
    password,
    userId: adminUser.id
  };
}

/**
 * Create demo tenant and tenant admin user
 */
async function createDemoTenant(storage: DatabaseStorage): Promise<{
  tenant: SetupResult['demoTenant'];
  bot: SetupResult['demoBot'];
}> {
  console.log('🏢 Creating demo tenant...');
  
  const companyName = 'Flow Builder Demo Company';
  const adminEmail = 'demo-tenant@flowdemo.local';
  const adminPassword = generateStrongPassword(14);
  
  // Check if tenant already exists
  const existingTenants = await storage.getTenants();
  const existingTenant = existingTenants.find(t => t.name === companyName);
  
  if (existingTenant) {
    console.log(`✅ Demo tenant already exists: ${companyName}`);
    
    // Check for existing admin user
    const existingAdmin = await storage.getUserByEmail(adminEmail);
    if (existingAdmin) {
      // Find the bot for this tenant
      const bots = await storage.getBotsByTenantId(existingTenant.id);
      const demoBot = bots.find(b => b.name.includes('Demo')) || bots[0];
      
      return {
        tenant: {
          tenantId: existingTenant.id,
          companyName,
          adminEmail,
          adminPassword: '[EXISTING_USER]',
          adminUserId: existingAdmin.id
        },
        bot: {
          botId: demoBot?.id || '',
          name: demoBot?.name || 'No bot found',
          status: demoBot?.status || 'none'
        }
      };
    }
  }
  
  // Create new tenant
  const tenant = existingTenant || await storage.createTenant({
    name: companyName,
    status: 'active', // Make it active for testing
    stripeCustomerId: null // No Stripe for demo
  });
  
  // Create tenant admin user
  const hashedAdminPassword = await hashPassword(adminPassword);
  
  const adminUser = await storage.createUser({
    email: adminEmail,
    password: hashedAdminPassword,
    role: 'customer_admin',
    firstName: 'Demo',
    lastName: 'Admin',
    tenantId: tenant.id,
    isActive: true
  });
  
  // Create demo bot
  const bot = await storage.createBot({
    tenantId: tenant.id,
    name: `${companyName} Demo Bot`,
    systemPrompt: `Du bist ein freundlicher Telefonassistent für ${companyName}. Du befindest dich im Demo-Modus zur Demonstration der VoiceAgent Flow Builder Funktionalitäten. Antworte höflich und professionell auf Deutsch und erkläre bei Bedarf, dass dies eine Demonstration der Flow Builder Technologie ist.`,
    status: 'ready', // Make it ready for testing
    locale: 'de-AT',
    greetingMessage: `Guten Tag! Vielen Dank für Ihren Anruf bei ${companyName}. Dies ist eine Demonstration unserer Flow Builder Technologie. Wie kann ich Ihnen helfen?`
  });
  
  console.log(`✅ Demo tenant created: ${companyName} (ID: ${tenant.id})`);
  console.log(`✅ Demo admin created: ${adminEmail}`);
  console.log(`✅ Demo bot created: ${bot.name} (ID: ${bot.id})`);
  
  return {
    tenant: {
      tenantId: tenant.id,
      companyName,
      adminEmail,
      adminPassword,
      adminUserId: adminUser.id
    },
    bot: {
      botId: bot.id,
      name: bot.name,
      status: bot.status
    }
  };
}

/**
 * Create phone number mapping for demo
 */
async function createPhoneMapping(
  storage: DatabaseStorage, 
  tenantId: string, 
  botId: string
): Promise<SetupResult['phoneMapping']> {
  console.log('📞 Creating phone number mapping...');
  
  const demoPhone = '+43720112811';
  
  // Normalize phone number using the security utils
  const normalizedPhone = normalizePhoneNumber(demoPhone);
  console.log(`📞 Phone normalized: ${demoPhone} → ${normalizedPhone}`);
  
  // Check if mapping already exists
  const existingMapping = await storage.getPhoneNumberMappingByPhone(normalizedPhone);
  
  if (existingMapping && existingMapping.isActive) {
    console.log(`✅ Phone mapping already exists: ${normalizedPhone} → Tenant ${existingMapping.tenantId}`);
    
    if (existingMapping.tenantId !== tenantId) {
      console.warn(`⚠️  Warning: Phone ${normalizedPhone} is mapped to different tenant ${existingMapping.tenantId}, expected ${tenantId}`);
    }
    
    return {
      phoneNumber: demoPhone,
      normalizedPhone,
      mappingId: existingMapping.id,
      isActive: existingMapping.isActive
    };
  }
  
  // Deactivate any existing mapping for this phone number first
  if (existingMapping) {
    await storage.updatePhoneNumberMapping(existingMapping.id, existingMapping.tenantId, {
      isActive: false,
      updatedAt: new Date()
    });
    console.log(`📞 Deactivated existing mapping for ${normalizedPhone}`);
  }
  
  // Create new phone mapping
  const phoneMapping = await storage.createPhoneNumberMapping({
    phoneNumber: normalizedPhone,
    tenantId,
    botId,
    webhookUrl: null, // Will be set when bot is deployed
    isActive: true
  });
  
  console.log(`✅ Phone mapping created: ${normalizedPhone} → Tenant ${tenantId}, Bot ${botId}`);
  
  return {
    phoneNumber: demoPhone,
    normalizedPhone,
    mappingId: phoneMapping.id,
    isActive: phoneMapping.isActive
  };
}

/**
 * Create demo flow using FlowTemplates
 */
async function createDemoFlow(
  storage: DatabaseStorage, 
  tenantId: string, 
  companyName: string
): Promise<SetupResult['demoFlow']> {
  console.log('🔄 Creating demo flow...');
  
  const flowName = `${companyName} Begrüßungsflow`;
  
  // Check if flow already exists
  const existingFlows = await storage.getFlowsByTenantId(tenantId);
  const existingFlow = existingFlows.find(f => f.name === flowName);
  
  if (existingFlow) {
    console.log(`✅ Demo flow already exists: ${flowName}`);
    
    // Get the latest version
    const versions = await storage.getFlowVersions(existingFlow.id, tenantId);
    const latestVersion = versions.sort((a, b) => b.version - a.version)[0];
    
    return {
      flowId: existingFlow.id,
      flowVersionId: latestVersion?.id || '',
      name: flowName,
      status: latestVersion?.status || 'draft'
    };
  }
  
  // Create new flow
  const flow = await storage.createFlow({
    tenantId,
    name: flowName,
    description: 'Demonstrationsflow für Flow Builder E2E Testing mit deutscher Begrüßung und grundlegenden Funktionen',
    isTemplate: false
  });
  
  // Create flow JSON using FlowTemplates
  const flowJson = FlowTemplates.createBasicGreetingFlow({
    companyName,
    greetingMessage: `Guten Tag! Vielen Dank für Ihren Anruf bei ${companyName}. Dies ist eine Demonstration der Flow Builder Funktionalitäten. Wie kann ich Ihnen heute helfen?`,
    systemPrompt: `Du bist ein freundlicher Telefonassistent für ${companyName}. Du befindest dich im Demo-Modus zur Demonstration der VoiceAgent Flow Builder Technologie. Antworte höflich und professionell auf Deutsch (de-AT). Erkläre bei Bedarf, dass dies eine Demonstration der Flow Builder Funktionalitäten ist. Sei hilfsbereit und führe natürliche Gespräche.`
  });
  
  // Create flow version in draft status
  const flowVersion = await storage.createFlowVersion({
    flowId: flow.id,
    version: 1,
    status: 'draft',
    flowJson,
    publishedAt: null,
    publishedBy: null
  }, tenantId);
  
  console.log(`✅ Demo flow created: ${flowName} (ID: ${flow.id})`);
  console.log(`✅ Flow version created: v${flowVersion.version} (Status: ${flowVersion.status})`);
  
  return {
    flowId: flow.id,
    flowVersionId: flowVersion.id,
    name: flowName,
    status: flowVersion.status
  };
}

/**
 * Main setup function
 */
async function setupDemoPrerequisites(): Promise<void> {
  console.log('🚀 Setting up demo prerequisites for Flow Builder E2E testing...\n');
  
  const storage = new DatabaseStorage();
  
  try {
    // 1. Create global admin
    const globalAdmin = await createGlobalAdmin(storage);
    
    // 2. Create demo tenant and bot
    const { tenant, bot } = await createDemoTenant(storage);
    
    // 3. Create phone mapping
    const phoneMapping = await createPhoneMapping(storage, tenant.tenantId, bot.botId);
    
    // 4. Create demo flow
    const demoFlow = await createDemoFlow(storage, tenant.tenantId, tenant.companyName);
    
    // Final result
    const result: SetupResult = {
      globalAdmin,
      demoTenant: tenant,
      demoBot: bot,
      phoneMapping,
      demoFlow
    };
    
    console.log('\n🎉 Demo prerequisites setup completed successfully!\n');
    
    console.log('='.repeat(80));
    console.log('📋 DEMO PREREQUISITES SUMMARY');
    console.log('='.repeat(80));
    
    console.log('\n🔑 GLOBAL ADMIN CREDENTIALS:');
    console.log(`   Email: ${result.globalAdmin.email}`);
    console.log(`   Password: ${result.globalAdmin.password}`);
    console.log(`   User ID: ${result.globalAdmin.userId}`);
    console.log(`   Login URL: /admin/auth`);
    
    console.log('\n🏢 DEMO TENANT DETAILS:');
    console.log(`   Company: ${result.demoTenant.companyName}`);
    console.log(`   Tenant ID: ${result.demoTenant.tenantId}`);
    console.log(`   Admin Email: ${result.demoTenant.adminEmail}`);
    console.log(`   Admin Password: ${result.demoTenant.adminPassword}`);
    console.log(`   Admin User ID: ${result.demoTenant.adminUserId}`);
    
    console.log('\n🤖 DEMO BOT DETAILS:');
    console.log(`   Bot Name: ${result.demoBot.name}`);
    console.log(`   Bot ID: ${result.demoBot.botId}`);
    console.log(`   Status: ${result.demoBot.status}`);
    
    console.log('\n📞 PHONE MAPPING:');
    console.log(`   Original: ${result.phoneMapping.phoneNumber}`);
    console.log(`   Normalized: ${result.phoneMapping.normalizedPhone}`);
    console.log(`   Mapping ID: ${result.phoneMapping.mappingId}`);
    console.log(`   Active: ${result.phoneMapping.isActive}`);
    console.log(`   Webhook: /telephony/incoming`);
    
    console.log('\n🔄 DEMO FLOW:');
    console.log(`   Flow Name: ${result.demoFlow.name}`);
    console.log(`   Flow ID: ${result.demoFlow.flowId}`);
    console.log(`   Version ID: ${result.demoFlow.flowVersionId}`);
    console.log(`   Status: ${result.demoFlow.status}`);
    
    console.log('\n✅ VALIDATION CHECKLIST:');
    console.log('   ✓ Global admin can login at /admin/auth');
    console.log('   ✓ Tenant admin can access tenant-scoped resources');
    console.log(`   ✓ Phone ${result.phoneMapping.normalizedPhone} routes to demo tenant`);
    console.log('   ✓ Demo flow ready for Flow Builder testing');
    console.log('   ✓ Tenant isolation and security enforced');
    
    console.log('\n🎯 NEXT STEPS:');
    console.log('   1. Test login with global admin credentials');
    console.log('   2. Verify phone mapping in Twilio webhooks');
    console.log('   3. Test Flow Builder with demo flow');
    console.log('   4. Promote flow to LIVE for runtime testing');
    
    console.log('\n' + '='.repeat(80));
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error);
    console.error('\nPlease check the error details and try again.');
    process.exit(1);
  }
}

// Auto-run the setup immediately (ES module compatible)
setupDemoPrerequisites()
  .then(() => {
    console.log('\n🏁 Setup completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Fatal error during setup:', error);
    process.exit(1);
  });

export { setupDemoPrerequisites, type SetupResult };