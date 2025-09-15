import { storage } from './storage';
import { encrypt, decrypt, generateSecureNonce, generateOAuthState, validateOAuthState } from './tenant-secrets';
import type { Request, Response } from 'express';

/**
 * ConnectorService OAuth Integration
 * Handles OAuth flows for CRM and Calendar connectors with secure token management
 */

export interface OAuthProvider {
  name: string;
  type: 'crm' | 'calendar';
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  redirectUri: string;
}

export interface OAuthConfig {
  google_calendar: OAuthProvider;
  salesforce: OAuthProvider;
  hubspot: OAuthProvider;
  pipedrive: OAuthProvider;
}

// OAuth configuration for supported providers
export const OAUTH_PROVIDERS: OAuthConfig = {
  google_calendar: {
    name: 'Google Calendar',
    type: 'calendar',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: '', // Set from environment
    clientSecret: '', // Set from environment
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ],
    redirectUri: '' // Set dynamically
  },
  salesforce: {
    name: 'Salesforce',
    type: 'crm',
    authUrl: 'https://login.salesforce.com/services/oauth2/authorize',
    tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
    clientId: '', // Set from environment
    clientSecret: '', // Set from environment
    scopes: ['api', 'refresh_token'],
    redirectUri: '' // Set dynamically
  },
  hubspot: {
    name: 'HubSpot',
    type: 'crm',
    authUrl: 'https://app.hubspot.com/oauth/authorize',
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    clientId: '', // Set from environment
    clientSecret: '', // Set from environment
    scopes: ['contacts', 'content', 'oauth'],
    redirectUri: '' // Set dynamically
  },
  pipedrive: {
    name: 'Pipedrive',
    type: 'crm',
    authUrl: 'https://oauth.pipedrive.com/oauth/authorize',
    tokenUrl: 'https://oauth.pipedrive.com/oauth/token',
    clientId: '', // Set from environment
    clientSecret: '', // Set from environment
    scopes: ['deals:read', 'contacts:read', 'deals:write', 'contacts:write'],
    redirectUri: '' // Set dynamically
  }
};

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
  tokenType?: string;
}

export interface ConnectorConfig {
  id: string;
  tenantId: string;
  connectorType: keyof OAuthConfig;
  isActive: boolean;
  config: any;
  createdAt: Date;
  updatedAt: Date;
}

class ConnectorOAuthService {
  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    // Initialize OAuth providers with environment variables
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5000';
    
    // Google Calendar
    OAUTH_PROVIDERS.google_calendar.clientId = process.env.GOOGLE_CLIENT_ID || '';
    OAUTH_PROVIDERS.google_calendar.clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    OAUTH_PROVIDERS.google_calendar.redirectUri = `${baseUrl}/api/connectors/oauth/callback/google_calendar`;
    
    // Salesforce
    OAUTH_PROVIDERS.salesforce.clientId = process.env.SALESFORCE_CLIENT_ID || '';
    OAUTH_PROVIDERS.salesforce.clientSecret = process.env.SALESFORCE_CLIENT_SECRET || '';
    OAUTH_PROVIDERS.salesforce.redirectUri = `${baseUrl}/api/connectors/oauth/callback/salesforce`;
    
    // HubSpot
    OAUTH_PROVIDERS.hubspot.clientId = process.env.HUBSPOT_CLIENT_ID || '';
    OAUTH_PROVIDERS.hubspot.clientSecret = process.env.HUBSPOT_CLIENT_SECRET || '';
    OAUTH_PROVIDERS.hubspot.redirectUri = `${baseUrl}/api/connectors/oauth/callback/hubspot`;
    
    // Pipedrive
    OAUTH_PROVIDERS.pipedrive.clientId = process.env.PIPEDRIVE_CLIENT_ID || '';
    OAUTH_PROVIDERS.pipedrive.clientSecret = process.env.PIPEDRIVE_CLIENT_SECRET || '';
    OAUTH_PROVIDERS.pipedrive.redirectUri = `${baseUrl}/api/connectors/oauth/callback/pipedrive`;
  }

  /**
   * Generate OAuth authorization URL for a provider with secure state
   */
  generateAuthUrl(
    provider: keyof OAuthConfig, 
    tenantId: string, 
    customState?: string
  ): { authUrl: string; nonce: string } {
    const config = OAUTH_PROVIDERS[provider];
    if (!config) {
      throw new Error(`Unsupported OAuth provider: ${provider}`);
    }

    // Generate cryptographically secure nonce for CSRF protection
    const nonce = generateSecureNonce();
    
    // Create HMAC-signed state parameter
    const secureState = generateOAuthState(tenantId, provider, nonce);
    
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(' '),
      state: secureState,
      access_type: 'offline', // Request refresh token
      prompt: 'consent' // Force consent screen for refresh token
    });

    return {
      authUrl: `${config.authUrl}?${params.toString()}`,
      nonce
    };
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(
    provider: keyof OAuthConfig,
    code: string
  ): Promise<OAuthTokens> {
    const config = OAUTH_PROVIDERS[provider];
    if (!config) {
      throw new Error(`Unsupported OAuth provider: ${provider}`);
    }

    const tokenData = {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri
    };

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: new URLSearchParams(tokenData)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OAuth token exchange failed: ${error}`);
    }

    const tokens = await response.json();
    
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : undefined,
      scope: tokens.scope,
      tokenType: tokens.token_type || 'Bearer'
    };
  }

  /**
   * Refresh OAuth tokens
   */
  async refreshTokens(
    provider: keyof OAuthConfig,
    refreshToken: string
  ): Promise<OAuthTokens> {
    const config = OAUTH_PROVIDERS[provider];
    if (!config) {
      throw new Error(`Unsupported OAuth provider: ${provider}`);
    }

    const tokenData = {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    };

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: new URLSearchParams(tokenData)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OAuth token refresh failed: ${error}`);
    }

    const tokens = await response.json();
    
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || refreshToken, // Keep old refresh token if not provided
      expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : undefined,
      scope: tokens.scope,
      tokenType: tokens.token_type || 'Bearer'
    };
  }

  /**
   * Store connector configuration with encrypted tokens
   */
  async storeConnectorConfig(
    tenantId: string,
    provider: keyof OAuthConfig,
    tokens: OAuthTokens,
    additionalConfig: any = {}
  ): Promise<ConnectorConfig> {
    // Encrypt sensitive token data with tenant-scoped encryption
    const encryptedConfig = {
      ...additionalConfig,
      accessToken: await encrypt(tokens.accessToken, tenantId),
      refreshToken: tokens.refreshToken ? await encrypt(tokens.refreshToken, tenantId) : undefined,
      expiresAt: tokens.expiresAt?.toISOString(),
      scope: tokens.scope,
      tokenType: tokens.tokenType
    };

    // Store in database
    const config = await storage.createConnectorConfig({
      tenantId,
      connectorType: provider,
      isActive: true,
      config: encryptedConfig
    });

    return config;
  }

  /**
   * Get decrypted connector configuration
   */
  async getConnectorConfig(
    tenantId: string,
    provider: keyof OAuthConfig
  ): Promise<ConnectorConfig | null> {
    const configs = await storage.getConnectorConfigsByTenantId(tenantId);
    const config = configs.find(c => c.connectorType === provider && c.isActive);
    
    if (!config) {
      return null;
    }

    // Decrypt sensitive data with tenant-scoped decryption
    const decryptedConfig = { ...config };
    if (config.config.accessToken) {
      decryptedConfig.config.accessToken = await decrypt(config.config.accessToken, tenantId);
    }
    if (config.config.refreshToken) {
      decryptedConfig.config.refreshToken = await decrypt(config.config.refreshToken, tenantId);
    }

    return decryptedConfig;
  }

  /**
   * Check if tokens need refresh and refresh them if necessary
   */
  async ensureValidTokens(
    tenantId: string,
    provider: keyof OAuthConfig
  ): Promise<ConnectorConfig | null> {
    const config = await this.getConnectorConfig(tenantId, provider);
    if (!config) {
      return null;
    }

    // Check if token is expired or expires soon (within 5 minutes)
    const expiresAt = config.config.expiresAt ? new Date(config.config.expiresAt) : null;
    const needsRefresh = expiresAt && expiresAt.getTime() < Date.now() + 5 * 60 * 1000;

    if (needsRefresh && config.config.refreshToken) {
      try {
        console.log(`[OAUTH] Refreshing tokens for ${provider} (tenant: ${tenantId})`);
        
        const newTokens = await this.refreshTokens(provider, config.config.refreshToken);
        
        // Update configuration with new tokens
        const updatedConfig = await this.storeConnectorConfig(
          tenantId,
          provider,
          newTokens,
          { ...config.config, accessToken: undefined, refreshToken: undefined }
        );

        // Deactivate old config
        try {
          await storage.updateConnectorConfig?.(config.id, { isActive: false });
        } catch (error) {
          console.warn(`[OAUTH] Could not update connector config:`, error);
          // Continue - this is not critical for the OAuth flow
        }
        
        console.log(`[OAUTH] ✅ Tokens refreshed for ${provider} (tenant: ${tenantId})`);
        return updatedConfig;
        
      } catch (error) {
        console.error(`[OAUTH] Failed to refresh tokens for ${provider} (tenant: ${tenantId}):`, error);
        // Deactivate invalid configuration
        await storage.updateConnectorConfig(config.id, { isActive: false });
        return null;
      }
    }

    return config;
  }

  /**
   * Test connector connection
   */
  async testConnection(
    tenantId: string,
    provider: keyof OAuthConfig
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const config = await this.ensureValidTokens(tenantId, provider);
      if (!config) {
        return { success: false, error: 'No valid configuration found' };
      }

      // Create adapter and test connection
      const { adapterFactory } = await import('./connector-implementations');
      
      if (OAUTH_PROVIDERS[provider].type === 'calendar') {
        const adapter = adapterFactory.createCalendarAdapter(provider, config.config);
        return await adapter.testConnection();
      } else {
        const adapter = adapterFactory.createCRMAdapter(provider, config.config);
        return await adapter.testConnection();
      }
      
    } catch (error) {
      console.error(`[OAUTH] Connection test failed for ${provider} (tenant: ${tenantId}):`, error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Disconnect and remove connector configuration
   */
  async disconnectConnector(
    tenantId: string,
    provider: keyof OAuthConfig
  ): Promise<void> {
    const configs = await storage.getConnectorConfigsByTenantId(tenantId);
    const activeConfigs = configs.filter(c => c.connectorType === provider && c.isActive);
    
    // Deactivate all configurations for this provider
    for (const config of activeConfigs) {
      await storage.updateConnectorConfig(config.id, { isActive: false });
    }
    
    console.log(`[OAUTH] Disconnected ${provider} for tenant: ${tenantId}`);
  }

  /**
   * List available OAuth providers
   */
  getAvailableProviders(): Array<{
    name: string;
    type: 'crm' | 'calendar';
    provider: keyof OAuthConfig;
    configured: boolean;
  }> {
    return Object.entries(OAUTH_PROVIDERS).map(([key, config]) => ({
      name: config.name,
      type: config.type,
      provider: key as keyof OAuthConfig,
      configured: !!(config.clientId && config.clientSecret)
    }));
  }

  /**
   * Get connector status for tenant
   */
  async getConnectorStatus(tenantId: string): Promise<Array<{
    provider: keyof OAuthConfig;
    name: string;
    type: 'crm' | 'calendar';
    connected: boolean;
    lastTested?: Date;
    error?: string;
  }>> {
    const configs = await storage.getConnectorConfigsByTenantId(tenantId);
    const activeConfigs = configs.filter(c => c.isActive);
    
    const status = [];
    
    for (const [provider, providerConfig] of Object.entries(OAUTH_PROVIDERS)) {
      const config = activeConfigs.find(c => c.connectorType === provider);
      const isConnected = !!config;
      
      let testResult;
      if (isConnected) {
        testResult = await this.testConnection(tenantId, provider as keyof OAuthConfig);
      }
      
      status.push({
        provider: provider as keyof OAuthConfig,
        name: providerConfig.name,
        type: providerConfig.type,
        connected: isConnected && (testResult?.success ?? false),
        lastTested: isConnected ? new Date() : undefined,
        error: testResult?.error
      });
    }
    
    return status;
  }
}

export const connectorOAuthService = new ConnectorOAuthService();

// In-memory nonce storage for OAuth state validation
// In production, this should use Redis or database storage
const oauthNonces = new Map<string, { tenantId: string; provider: string; timestamp: number }>();

// Clean up expired nonces every hour
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [nonce, data] of oauthNonces.entries()) {
    if (data.timestamp < oneHourAgo) {
      oauthNonces.delete(nonce);
    }
  }
}, 60 * 60 * 1000);

/**
 * OAuth Route Handlers
 * Express route handlers for OAuth flows
 */

/**
 * Initiate OAuth flow for a provider
 * GET /api/connectors/oauth/authorize/:provider
 */
export async function initiateOAuth(req: Request, res: Response): Promise<any> {
  try {
    const { provider } = req.params;
    const tenantId = req.user?.tenantId;
    
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant context required' });
    }
    
    if (!OAUTH_PROVIDERS[provider as keyof OAuthConfig]) {
      return res.status(400).json({ error: 'Unsupported OAuth provider' });
    }
    
    const authResult = connectorOAuthService.generateAuthUrl(
      provider as keyof OAuthConfig,
      tenantId
    );
    
    // Store nonce for validation during callback
    oauthNonces.set(authResult.nonce, {
      tenantId,
      provider: provider as string,
      timestamp: Date.now()
    });
    
    console.log(`[OAUTH] Initiating OAuth for ${provider} (tenant: ${tenantId}), user: ${req.user?.email}, nonce: ${authResult.nonce.slice(0, 8)}...`);
    
    return res.json({
      authUrl: authResult.authUrl,
      provider,
      nonce: authResult.nonce, // Return nonce for client-side reference
      message: 'Redirect user to authUrl to complete OAuth flow'
    });
    
  } catch (error) {
    console.error('[OAUTH] Failed to initiate OAuth:', error);
    return res.status(500).json({ 
      error: 'OAuth initiation failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Handle OAuth callback
 * GET /api/connectors/oauth/callback/:provider
 */
export async function handleOAuthCallback(req: Request, res: Response): Promise<any> {
  try {
    const { provider } = req.params;
    const { code, state, error } = req.query;
    
    if (error) {
      console.error(`[OAUTH] OAuth error for ${provider}:`, error);
      return res.redirect(`/admin/connectors?error=${encodeURIComponent(error as string)}`);
    }
    
    if (!code) {
      return res.redirect('/admin/connectors?error=missing_authorization_code');
    }
    
    // Validate OAuth state for CSRF protection
    const stateValidation = validateOAuthState(state as string);
    
    if (!stateValidation.valid) {
      console.error(`[OAUTH] Invalid state parameter for ${provider}:`, stateValidation);
      return res.redirect('/admin/connectors?error=invalid_or_expired_state');
    }
    
    const { tenantId, nonce, provider: stateProvider } = stateValidation;
    
    // Verify provider matches
    if (stateProvider !== provider) {
      console.error(`[OAUTH] Provider mismatch: expected ${provider}, got ${stateProvider}`);
      return res.redirect('/admin/connectors?error=provider_mismatch');
    }
    
    // Verify nonce exists in our storage (prevents replay attacks)
    const storedNonce = oauthNonces.get(nonce);
    if (!storedNonce || storedNonce.tenantId !== tenantId || storedNonce.provider !== provider) {
      console.error(`[OAUTH] Nonce validation failed for ${provider} (tenant: ${tenantId})`);
      return res.redirect('/admin/connectors?error=nonce_validation_failed');
    }
    
    // Remove nonce to prevent reuse (one-time use)
    oauthNonces.delete(nonce);
    
    console.log(`[OAUTH] Processing callback for ${provider} (tenant: ${tenantId}) - state validated successfully`);
    
    // Exchange code for tokens
    const tokens = await connectorOAuthService.exchangeCodeForTokens(
      provider as keyof OAuthConfig,
      code as string
    );
    
    // Store configuration
    await connectorOAuthService.storeConnectorConfig(
      tenantId,
      provider as keyof OAuthConfig,
      tokens
    );
    
    console.log(`[OAUTH] ✅ Successfully connected ${provider} for tenant: ${tenantId}`);
    
    return res.redirect('/admin/connectors?success=true&provider=' + provider);
    
  } catch (error) {
    console.error(`[OAUTH] Callback failed for ${provider}:`, error);
    return res.redirect(`/admin/connectors?error=oauth_callback_failed`);
  }
}

/**
 * Get connector configurations for tenant
 * GET /api/connectors/config
 */
export async function getConnectorConfigs(req: Request, res: Response): Promise<any> {
  try {
    const tenantId = req.user?.tenantId;
    
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant context required' });
    }
    
    const status = await connectorOAuthService.getConnectorStatus(tenantId);
    
    return res.json({
      success: true,
      connectors: status,
      availableProviders: connectorOAuthService.getAvailableProviders()
    });
    
  } catch (error) {
    console.error('[OAUTH] Failed to get connector configs:', error);
    return res.status(500).json({ 
      error: 'Failed to get connector configurations',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Test connector connection
 * POST /api/connectors/test/:provider
 */
export async function testConnectorConnection(req: Request, res: Response): Promise<any> {
  try {
    const { provider } = req.params;
    const tenantId = req.user?.tenantId;
    
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant context required' });
    }
    
    if (!OAUTH_PROVIDERS[provider as keyof OAuthConfig]) {
      return res.status(400).json({ error: 'Unsupported provider' });
    }
    
    const result = await connectorOAuthService.testConnection(
      tenantId,
      provider as keyof OAuthConfig
    );
    
    console.log(`[OAUTH] Connection test for ${provider} (tenant: ${tenantId}): ${result.success ? 'SUCCESS' : 'FAILED'}`);
    
    return res.json({
      success: result.success,
      provider,
      error: result.error,
      timestamp: new Date()
    });
    
  } catch (error) {
    console.error(`[OAUTH] Connection test failed for ${provider}:`, error);
    return res.status(500).json({ 
      error: 'Connection test failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Disconnect connector
 * DELETE /api/connectors/:provider
 */
export async function disconnectConnector(req: Request, res: Response): Promise<any> {
  try {
    const { provider } = req.params;
    const tenantId = req.user?.tenantId;
    
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant context required' });
    }
    
    if (!OAUTH_PROVIDERS[provider as keyof OAuthConfig]) {
      return res.status(400).json({ error: 'Unsupported provider' });
    }
    
    await connectorOAuthService.disconnectConnector(
      tenantId,
      provider as keyof OAuthConfig
    );
    
    console.log(`[OAUTH] Disconnected ${provider} for tenant: ${tenantId}, user: ${req.user?.email}`);
    
    return res.json({
      success: true,
      provider,
      message: 'Connector disconnected successfully'
    });
    
  } catch (error) {
    console.error(`[OAUTH] Failed to disconnect ${provider}:`, error);
    return res.status(500).json({ 
      error: 'Failed to disconnect connector',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}