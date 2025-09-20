import { getRetellKey } from "./key-loader";
/**
 * Retell AI API Integration Service
 * Provides direct integration with Retell AI for agent management
 */

import type { ApiKey } from '@shared/schema';

export interface RetellAgent {
  agent_id: string;
  agent_name: string;
  voice_id: string;
  language: string;
  response_engine: {
    type: string;
    llm_websocket_url?: string;
  };
  llm_websocket_url?: string;
  voice_temperature?: number;
  voice_speed?: number;
  voice_model?: string;
  boosted_keywords?: string[];
  enable_backchannel?: boolean;
  ambient_sound?: string;
  webhook_url?: string;
  agent_type?: string;
  last_modification_timestamp?: number;
}

export interface RetellCreateAgentRequest {
  agent_name: string;
  voice_id: string;
  language?: string;
  response_engine: {
    type: string;
    llm_websocket_url?: string;
  };
  llm_websocket_url?: string;
  voice_temperature?: number;
  voice_speed?: number;
  boosted_keywords?: string[];
  enable_backchannel?: boolean;
  ambient_sound?: string;
  webhook_url?: string;
}

export class RetellAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public retellResponse?: any
  ) {
    super(message);
    this.name = 'RetellAPIError';
  }
}

export class RetellAPIService {
  private baseUrl = 'https://api.retellai.com';
  
  private async getApiKey(): Promise<string> {
    const secretKey = await getRetellKey();
    if (!secretKey) {
      throw new RetellAPIError('Retell API secret key not configured');
    }
    return secretKey;
  }

  private async makeRequest<T>(
    endpoint: string,
    options: {
      method?: string;
      body?: any;
      headers?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const apiKey = await this.getApiKey();
    
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers
    };

    const fetchOptions: RequestInit = {
      method: options.method || 'GET',
      headers,
    };

    if (options.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    console.log(`[Retell API] ${options.method || 'GET'} ${endpoint}`);

    try {
      const response = await fetch(url, fetchOptions);
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText };
        }
        
        console.error(`[Retell API] Error ${response.status}:`, errorData);
        throw new RetellAPIError(
          errorData.message || `HTTP ${response.status}`,
          response.status,
          errorData
        );
      }

      const data = await response.json();
      console.log(`[Retell API] Success:`, data);
      return data;
    } catch (error) {
      if (error instanceof RetellAPIError) {
        throw error;
      }
      console.error('[Retell API] Request failed:', error);
      throw new RetellAPIError(
        `Failed to connect to Retell API: ${(error as Error).message}`
      );
    }
  }

  /**
   * Get a specific agent by ID
   */
  async getAgent(agentId: string): Promise<RetellAgent> {
    return this.makeRequest<RetellAgent>(`/get-agent/${agentId}`);
  }

  /**
   * List all agents
   */
  async listAgents(): Promise<RetellAgent[]> {
    const key = await getRetellKey();
    if (!key) {
      throw new RetellAPIError('Retell API key not configured');
    }

    const resp = await fetch('https://api.retellai.com/v1/agents', {
      headers: { Authorization: `Bearer ${key}` }
    } as any);

    if (!resp.ok) {
      throw new RetellAPIError(`Retell list agents failed: ${resp.status}`, resp.status);
    }

    const payload = await resp.json();
    if (Array.isArray(payload)) {
      return payload as RetellAgent[];
    }
    if (Array.isArray(payload?.data)) {
      return payload.data;
    }
    if (Array.isArray(payload?.agents)) {
      return payload.agents;
    }
    return [];
  }

  /**
   * Create a new agent
   */
  async createAgent(agentData: RetellCreateAgentRequest): Promise<RetellAgent> {
    return this.makeRequest<RetellAgent>('/create-agent', {
      method: 'POST',
      body: agentData
    });
  }

  /**
   * Update an existing agent
   */
  async updateAgent(agentId: string, updates: Partial<RetellCreateAgentRequest>): Promise<RetellAgent> {
    return this.makeRequest<RetellAgent>(`/update-agent/${agentId}`, {
      method: 'PATCH',
      body: updates
    });
  }

  /**
   * Delete an agent
   */
  async deleteAgent(agentId: string): Promise<void> {
    await this.makeRequest(`/delete-agent/${agentId}`, {
      method: 'DELETE'
    });
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.listAgents();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof RetellAPIError ? error.message : 'Unknown error'
      };
    }
  }
}

export const retellAPI = new RetellAPIService();

export const retellApi = Object.assign({}, retellAPI, {
  async listAgents() {
    const key = await getRetellKey();
    if (!key) {
      throw new Error('RETELL_API_KEY missing');
    }
    const resp = await fetch('https://api.retellai.com/v1/agents', {
      headers: { Authorization: `Bearer ${key}` }
    } as any);
    if (!resp.ok) {
      throw new Error(`Retell list agents failed: ${resp.status}`);
    }
    return resp.json();
  }
});