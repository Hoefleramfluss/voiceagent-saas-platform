import { z } from 'zod';

/**
 * Feature Flag System for VoiceAgent SaaS Platform
 * 
 * Provides controlled feature rollouts, A/B testing, and graceful handling
 * of incomplete functionality across the application.
 */

export type FeatureFlagKey = 
  // Connector integrations
  | 'connectors.salesforce'
  | 'connectors.pipedrive' 
  | 'connectors.microsoft_graph'
  | 'connectors.hubspot'
  | 'connectors.google_calendar'
  
  // Flow builder features
  | 'flow_builder.advanced_nodes'
  | 'flow_builder.ai_optimization'
  | 'flow_builder.template_marketplace'
  
  // Voice processing features
  | 'voice.eleven_labs_tts'
  | 'voice.google_stt'
  | 'voice.real_time_transcription'
  | 'voice.sentiment_analysis'
  
  // Admin features
  | 'admin.user_impersonation'
  | 'admin.system_metrics'
  | 'admin.bulk_operations'
  
  // Billing features
  | 'billing.usage_analytics'
  | 'billing.custom_plans'
  | 'billing.invoice_automation'
  
  // Security features
  | 'security.sso_integration'
  | 'security.audit_export'
  | 'security.ip_whitelisting'
  
  // Experimental features
  | 'experimental.ai_assistant'
  | 'experimental.multi_language'
  | 'experimental.advanced_analytics';

export type FeatureFlagValue = boolean | string | number | object;

export interface FeatureFlag {
  key: FeatureFlagKey;
  enabled: boolean;
  value?: FeatureFlagValue;
  description: string;
  environments?: ('development' | 'staging' | 'production')[];
  tenantIds?: string[]; // Tenant-specific flags
  userRoles?: ('platform_admin' | 'customer_admin' | 'customer_user' | 'support')[];
  rolloutPercentage?: number; // For gradual rollouts (0-100)
  expiry?: Date; // Temporary flags
}

// Default feature flag configuration
export const DEFAULT_FEATURE_FLAGS: Record<FeatureFlagKey, FeatureFlag> = {
  // Connector integrations - some implemented, some not
  'connectors.salesforce': {
    key: 'connectors.salesforce',
    enabled: false, // Not implemented yet
    description: 'Enable Salesforce CRM integration',
    environments: ['development']
  },
  'connectors.pipedrive': {
    key: 'connectors.pipedrive', 
    enabled: false, // Not implemented yet
    description: 'Enable Pipedrive CRM integration',
    environments: ['development']
  },
  'connectors.microsoft_graph': {
    key: 'connectors.microsoft_graph',
    enabled: false, // Not implemented yet
    description: 'Enable Microsoft Graph (Outlook) integration',
    environments: ['development']
  },
  'connectors.hubspot': {
    key: 'connectors.hubspot',
    enabled: true, // Implemented
    description: 'Enable HubSpot CRM integration'
  },
  'connectors.google_calendar': {
    key: 'connectors.google_calendar', 
    enabled: true, // Implemented
    description: 'Enable Google Calendar integration'
  },
  
  // Flow builder features
  'flow_builder.advanced_nodes': {
    key: 'flow_builder.advanced_nodes',
    enabled: true,
    description: 'Enable advanced flow builder nodes (API calls, conditions, etc.)'
  },
  'flow_builder.ai_optimization': {
    key: 'flow_builder.ai_optimization',
    enabled: false,
    description: 'AI-powered flow optimization suggestions',
    environments: ['development', 'staging']
  },
  'flow_builder.template_marketplace': {
    key: 'flow_builder.template_marketplace',
    enabled: false,
    description: 'Flow template marketplace and sharing',
    rolloutPercentage: 25
  },
  
  // Voice processing features
  'voice.eleven_labs_tts': {
    key: 'voice.eleven_labs_tts',
    enabled: true,
    description: 'ElevenLabs text-to-speech integration'
  },
  'voice.google_stt': {
    key: 'voice.google_stt',
    enabled: true,
    description: 'Google Cloud Speech-to-Text (de-AT locale)'
  },
  'voice.real_time_transcription': {
    key: 'voice.real_time_transcription',
    enabled: false,
    description: 'Real-time call transcription',
    environments: ['development']
  },
  'voice.sentiment_analysis': {
    key: 'voice.sentiment_analysis',
    enabled: false,
    description: 'Real-time sentiment analysis during calls',
    environments: ['development']
  },
  
  // Admin features
  'admin.user_impersonation': {
    key: 'admin.user_impersonation',
    enabled: false,
    description: 'Allow platform admins to impersonate users',
    userRoles: ['platform_admin'],
    environments: ['development', 'staging']
  },
  'admin.system_metrics': {
    key: 'admin.system_metrics',
    enabled: true,
    description: 'System health and performance metrics',
    userRoles: ['platform_admin']
  },
  'admin.bulk_operations': {
    key: 'admin.bulk_operations',
    enabled: true,
    description: 'Bulk user and tenant operations',
    userRoles: ['platform_admin']
  },
  
  // Billing features
  'billing.usage_analytics': {
    key: 'billing.usage_analytics',
    enabled: true,
    description: 'Detailed usage analytics and reporting'
  },
  'billing.custom_plans': {
    key: 'billing.custom_plans',
    enabled: false,
    description: 'Custom pricing plans for enterprise customers',
    userRoles: ['platform_admin']
  },
  'billing.invoice_automation': {
    key: 'billing.invoice_automation',
    enabled: true,
    description: 'Automated invoice generation and processing'
  },
  
  // Security features
  'security.sso_integration': {
    key: 'security.sso_integration',
    enabled: false,
    description: 'Single Sign-On (SSO) integration',
    environments: ['staging', 'production']
  },
  'security.audit_export': {
    key: 'security.audit_export',
    enabled: true,
    description: 'Export audit logs for compliance',
    userRoles: ['platform_admin']
  },
  'security.ip_whitelisting': {
    key: 'security.ip_whitelisting',
    enabled: true,
    description: 'IP address whitelisting for admin access',
    userRoles: ['platform_admin']
  },
  
  // Experimental features
  'experimental.ai_assistant': {
    key: 'experimental.ai_assistant',
    enabled: false,
    description: 'AI assistant for flow building and optimization',
    environments: ['development'],
    rolloutPercentage: 10
  },
  'experimental.multi_language': {
    key: 'experimental.multi_language',
    enabled: false,
    description: 'Multi-language support beyond German',
    environments: ['development']
  },
  'experimental.advanced_analytics': {
    key: 'experimental.advanced_analytics',
    enabled: false,
    description: 'Advanced analytics and business intelligence',
    rolloutPercentage: 5
  }
};

// Validation schema for feature flags
export const featureFlagSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
  value: z.any().optional(),
  description: z.string(),
  environments: z.array(z.enum(['development', 'staging', 'production'])).optional(),
  tenantIds: z.array(z.string()).optional(),
  userRoles: z.array(z.enum(['platform_admin', 'customer_admin', 'customer_user', 'support'])).optional(),
  rolloutPercentage: z.number().min(0).max(100).optional(),
  expiry: z.date().optional()
});

export type FeatureFlagInput = z.infer<typeof featureFlagSchema>;

/**
 * Context for feature flag evaluation
 */
export interface FeatureFlagContext {
  environment: 'development' | 'staging' | 'production';
  tenantId?: string;
  userId?: string;
  userRole?: 'platform_admin' | 'customer_admin' | 'customer_user' | 'support';
  sessionId?: string;
}

/**
 * Feature flag evaluation result
 */
export interface FeatureFlagResult {
  enabled: boolean;
  value?: FeatureFlagValue;
  reason: string;
}