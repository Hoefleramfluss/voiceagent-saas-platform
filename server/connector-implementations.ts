/**
 * Connector Implementation Factory and Basic Adapters
 * Provides concrete implementations for CRM and Calendar integrations
 */

import {
  BaseConnectorConfig,
  Contact,
  Lead,
  Deal,
  CalendarEvent,
  CRMAdapter,
  CalendarAdapter,
  AdapterFactory,
  ConnectorError,
  ConnectorAuthError,
  ConnectorRateLimitError,
  ConnectorNotFoundError
} from './connector-adapters';

// Google Calendar configuration interface
interface GoogleCalendarConfig extends BaseConnectorConfig {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  calendarId?: string;
}

// HubSpot configuration interface
interface HubSpotConfig extends BaseConnectorConfig {
  apiKey: string;
  portalId?: string;
}

// Salesforce configuration interface
interface SalesforceConfig extends BaseConnectorConfig {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  instanceUrl: string;
}

// Google Calendar adapter implementation
export class GoogleCalendarAdapter implements CalendarAdapter {
  type: 'calendar' = 'calendar';
  provider = 'google_calendar';
  tenantId: string;
  
  constructor(private config: GoogleCalendarConfig) {
    if (!config.tenantId) {
      throw new Error('GoogleCalendarAdapter requires tenantId for security');
    }
    this.tenantId = config.tenantId;
  }
  
  async isConnected(): Promise<boolean> {
    try {
      const result = await this.testConnection();
      return result.success;
    } catch {
      return false;
    }
  }
  
  validateTenantContext(requestTenantId: string): boolean {
    return this.tenantId === requestTenantId;
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      // SECURITY: Validate tenant context is properly set
      if (!this.tenantId) {
        return { success: false, error: 'No tenant context - security violation' };
      }
      
      // Basic test - attempt to fetch calendar info
      // This would make an actual API call in production
      if (!this.config.accessToken) {
        return { success: false, error: 'Missing access token' };
      }
      
      // Mock successful connection for development
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
  
  async disconnect(): Promise<void> {
    // Revoke tokens if needed
    // Implementation would call Google's token revocation endpoint
  }
  
  async getEvents(startDate: Date, endDate: Date): Promise<CalendarEvent[]> {
    try {
      // SECURITY: Validate tenant context before API operations
      if (!this.tenantId) {
        throw new ConnectorError('No tenant context - access denied', 'SECURITY_ERROR', this.provider);
      }
      
      // Mock implementation - would make actual Google Calendar API call
      return [
        {
          id: 'mock-event-1',
          title: 'Team Meeting',
          description: 'Weekly team sync',
          startTime: new Date(startDate.getTime() + 2 * 60 * 60 * 1000), // +2 hours
          endTime: new Date(startDate.getTime() + 3 * 60 * 60 * 1000), // +3 hours
          attendees: ['team@company.com'],
          location: 'Conference Room A',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
    } catch (error) {
      throw new ConnectorError('Failed to fetch events', 'FETCH_ERROR', this.provider, error as Error);
    }
  }
  
  async getEvent(id: string): Promise<CalendarEvent | null> {
    try {
      // Mock implementation
      if (id === 'mock-event-1') {
        return {
          id: 'mock-event-1',
          title: 'Team Meeting',
          description: 'Weekly team sync',
          startTime: new Date(),
          endTime: new Date(Date.now() + 60 * 60 * 1000),
          attendees: ['team@company.com']
        };
      }
      return null;
    } catch (error) {
      throw new ConnectorError('Failed to fetch event', 'FETCH_ERROR', this.provider, error as Error);
    }
  }
  
  async createEvent(event: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>): Promise<CalendarEvent> {
    try {
      // Mock implementation
      const newEvent: CalendarEvent = {
        id: `event-${Date.now()}`,
        ...event,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      return newEvent;
    } catch (error) {
      throw new ConnectorError('Failed to create event', 'CREATE_ERROR', this.provider, error as Error);
    }
  }
  
  async updateEvent(id: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent> {
    try {
      // Mock implementation
      const existingEvent = await this.getEvent(id);
      if (!existingEvent) {
        throw new ConnectorNotFoundError(this.provider, id);
      }
      
      return {
        ...existingEvent,
        ...updates,
        updatedAt: new Date()
      };
    } catch (error) {
      throw new ConnectorError('Failed to update event', 'UPDATE_ERROR', this.provider, error as Error);
    }
  }
  
  async deleteEvent(id: string): Promise<void> {
    try {
      // Mock implementation - would call Google Calendar API
      const event = await this.getEvent(id);
      if (!event) {
        throw new ConnectorNotFoundError(this.provider, id);
      }
    } catch (error) {
      throw new ConnectorError('Failed to delete event', 'DELETE_ERROR', this.provider, error as Error);
    }
  }
  
  async getAvailableTimeSlots(date: Date, duration: number): Promise<{ start: Date; end: Date }[]> {
    try {
      // Mock implementation - would analyze existing events and find free slots
      const slots = [];
      const startOfDay = new Date(date);
      startOfDay.setHours(9, 0, 0, 0); // 9 AM
      
      for (let hour = 9; hour < 17; hour++) {
        const start = new Date(startOfDay);
        start.setHours(hour);
        const end = new Date(start.getTime() + duration * 60 * 1000);
        
        if (end.getHours() <= 17) {
          slots.push({ start, end });
        }
      }
      
      return slots;
    } catch (error) {
      throw new ConnectorError('Failed to get available slots', 'AVAILABILITY_ERROR', this.provider, error as Error);
    }
  }
  
  async checkAvailability(startTime: Date, endTime: Date): Promise<boolean> {
    try {
      // Mock implementation - would check for conflicts
      const events = await this.getEvents(startTime, endTime);
      return events.length === 0;
    } catch (error) {
      throw new ConnectorError('Failed to check availability', 'AVAILABILITY_ERROR', this.provider, error as Error);
    }
  }
}

// HubSpot CRM adapter implementation
export class HubSpotAdapter implements CRMAdapter {
  type: 'crm' = 'crm';
  provider = 'hubspot';
  
  constructor(private config: HubSpotConfig) {}
  
  async isConnected(): Promise<boolean> {
    try {
      const result = await this.testConnection();
      return result.success;
    } catch {
      return false;
    }
  }
  
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.config.apiKey) {
        return { success: false, error: 'Missing API key' };
      }
      
      // Mock successful connection
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
  
  async disconnect(): Promise<void> {
    // Clear cached tokens if needed
  }
  
  async getContacts(limit = 100, offset = 0): Promise<Contact[]> {
    try {
      // Mock implementation
      return [
        {
          id: 'contact-1',
          email: 'john.doe@example.com',
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1234567890',
          company: 'Example Corp',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
    } catch (error) {
      throw new ConnectorError('Failed to fetch contacts', 'FETCH_ERROR', this.provider, error as Error);
    }
  }
  
  async getContact(id: string): Promise<Contact | null> {
    try {
      // Mock implementation
      if (id === 'contact-1') {
        return {
          id: 'contact-1',
          email: 'john.doe@example.com',
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1234567890',
          company: 'Example Corp'
        };
      }
      return null;
    } catch (error) {
      throw new ConnectorError('Failed to fetch contact', 'FETCH_ERROR', this.provider, error as Error);
    }
  }
  
  async createContact(contact: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contact> {
    try {
      // Mock implementation
      const newContact: Contact = {
        id: `contact-${Date.now()}`,
        ...contact,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      return newContact;
    } catch (error) {
      throw new ConnectorError('Failed to create contact', 'CREATE_ERROR', this.provider, error as Error);
    }
  }
  
  async updateContact(id: string, updates: Partial<Contact>): Promise<Contact> {
    try {
      const existingContact = await this.getContact(id);
      if (!existingContact) {
        throw new ConnectorNotFoundError(this.provider, id);
      }
      
      return {
        ...existingContact,
        ...updates,
        updatedAt: new Date()
      };
    } catch (error) {
      throw new ConnectorError('Failed to update contact', 'UPDATE_ERROR', this.provider, error as Error);
    }
  }
  
  async deleteContact(id: string): Promise<void> {
    try {
      const contact = await this.getContact(id);
      if (!contact) {
        throw new ConnectorNotFoundError(this.provider, id);
      }
    } catch (error) {
      throw new ConnectorError('Failed to delete contact', 'DELETE_ERROR', this.provider, error as Error);
    }
  }
  
  async getLeads(limit = 100, offset = 0): Promise<Lead[]> {
    try {
      // Mock implementation
      return [
        {
          id: 'lead-1',
          email: 'prospect@company.com',
          firstName: 'Jane',
          lastName: 'Smith',
          company: 'Prospect Corp',
          status: 'new',
          source: 'website',
          value: 5000,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
    } catch (error) {
      throw new ConnectorError('Failed to fetch leads', 'FETCH_ERROR', this.provider, error as Error);
    }
  }
  
  async getLead(id: string): Promise<Lead | null> {
    try {
      // Mock implementation
      if (id === 'lead-1') {
        return {
          id: 'lead-1',
          email: 'prospect@company.com',
          firstName: 'Jane',
          lastName: 'Smith',
          company: 'Prospect Corp',
          status: 'new',
          source: 'website',
          value: 5000
        };
      }
      return null;
    } catch (error) {
      throw new ConnectorError('Failed to fetch lead', 'FETCH_ERROR', this.provider, error as Error);
    }
  }
  
  async createLead(lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>): Promise<Lead> {
    try {
      // Mock implementation
      const newLead: Lead = {
        id: `lead-${Date.now()}`,
        ...lead,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      return newLead;
    } catch (error) {
      throw new ConnectorError('Failed to create lead', 'CREATE_ERROR', this.provider, error as Error);
    }
  }
  
  async updateLead(id: string, updates: Partial<Lead>): Promise<Lead> {
    try {
      const existingLead = await this.getLead(id);
      if (!existingLead) {
        throw new ConnectorNotFoundError(this.provider, id);
      }
      
      return {
        ...existingLead,
        ...updates,
        updatedAt: new Date()
      };
    } catch (error) {
      throw new ConnectorError('Failed to update lead', 'UPDATE_ERROR', this.provider, error as Error);
    }
  }
}

// Adapter factory implementation
export class ConnectorAdapterFactory implements AdapterFactory {
  createCRMAdapter(provider: string, config: BaseConnectorConfig): CRMAdapter {
    switch (provider) {
      case 'hubspot':
        return new HubSpotAdapter(config as HubSpotConfig);
      case 'salesforce':
        // Would implement SalesforceAdapter
        throw new ConnectorError('Salesforce adapter not yet implemented', 'NOT_IMPLEMENTED', provider);
      case 'pipedrive':
        // Would implement PipedriveAdapter
        throw new ConnectorError('Pipedrive adapter not yet implemented', 'NOT_IMPLEMENTED', provider);
      default:
        throw new ConnectorError(`Unsupported CRM provider: ${provider}`, 'UNSUPPORTED_PROVIDER', provider);
    }
  }
  
  createCalendarAdapter(provider: string, config: BaseConnectorConfig): CalendarAdapter {
    switch (provider) {
      case 'google_calendar':
        return new GoogleCalendarAdapter(config as GoogleCalendarConfig);
      case 'microsoft_graph':
        // Would implement MicrosoftGraphAdapter
        throw new ConnectorError('Microsoft Graph adapter not yet implemented', 'NOT_IMPLEMENTED', provider);
      default:
        throw new ConnectorError(`Unsupported calendar provider: ${provider}`, 'UNSUPPORTED_PROVIDER', provider);
    }
  }
}

// Export singleton factory instance
export const adapterFactory = new ConnectorAdapterFactory();