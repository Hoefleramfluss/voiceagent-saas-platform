#!/usr/bin/env tsx
/**
 * Bootstrap script to create the initial platform_admin user
 * Usage: tsx scripts/create-admin.ts
 */

import { hashPassword } from '../server/auth';
import { DatabaseStorage } from '../server/storage';

async function createPlatformAdmin() {
  try {
    console.log('🚀 Creating platform_admin user...');
    
    const storage = new DatabaseStorage();
    
    // Check if user already exists
    const existingUser = await storage.getUserByEmail('boss@boss.at');
    if (existingUser) {
      console.log('❌ User boss@boss.at already exists');
      console.log(`   Current role: ${existingUser.role}`);
      
      if (existingUser.role !== 'platform_admin') {
        console.log('⚠️  User exists but not as platform_admin. Manual update needed.');
      }
      process.exit(1);
    }
    
    // Hash the specified password
    const hashedPassword = await hashPassword('152abcdeFghj');
    
    // Create platform_admin user (no tenant required for platform admins)
    const adminUser = await storage.createUser({
      email: 'boss@boss.at',
      password: hashedPassword,
      role: 'platform_admin',
      firstName: 'Platform',
      lastName: 'Administrator',
      tenantId: null, // Platform admins don't belong to a specific tenant
      isActive: true
    });
    
    console.log('✅ Platform admin user created successfully!');
    console.log(`   Email: ${adminUser.email}`);
    console.log(`   Role: ${adminUser.role}`);
    console.log(`   ID: ${adminUser.id}`);
    console.log('');
    console.log('🔑 Login credentials:');
    console.log('   Email: boss@boss.at');
    console.log('   Password: 152abcdeFghj');
    console.log('');
    console.log('🌐 You can now login at: /auth');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Failed to create platform admin:', error);
    process.exit(1);
  }
}

// Run the script
createPlatformAdmin();