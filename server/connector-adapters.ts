/**
 * Connector Adapter Interfaces for CRM and Calendar Integrations
 * Provides unified interfaces for external service integrations
 */

// Base configuration interface for all connectors
export interface BaseConnectorConfig {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  baseUrl?: string;
  [key: string]: any;
}

// Common contact/lead structure
export interface Contact {
  id: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  customFields?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

// Calendar event structure
export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  attendees?: string[];
  location?: string;
  recurring?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

// CRM-specific interfaces
export interface Lead extends Contact {
  status: 'new' | 'qualified' | 'contacted' | 'converted' | 'lost';
  source?: string;
  value?: number;
  assignedTo?: string;
}

export interface Deal {
  id: string;
  title: string;
  value: number;
  stage: string;
  probability?: number;
  contactId?: string;
  expectedCloseDate?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

// Base adapter interface
export interface BaseConnectorAdapter {
  type: 'crm' | 'calendar';
  provider: string;
  isConnected(): Promise<boolean>;
  testConnection(): Promise<{ success: boolean; error?: string }>;
  disconnect(): Promise<void>;
}

// CRM adapter interface
export interface CRMAdapter extends BaseConnectorAdapter {
  type: 'crm';
  
  // Contact management
  getContacts(limit?: number, offset?: number): Promise<Contact[]>;
  getContact(id: string): Promise<Contact | null>;
  createContact(contact: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contact>;
  updateContact(id: string, updates: Partial<Contact>): Promise<Contact>;
  deleteContact(id: string): Promise<void>;
  
  // Lead management
  getLeads(limit?: number, offset?: number): Promise<Lead[]>;
  getLead(id: string): Promise<Lead | null>;
  createLead(lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>): Promise<Lead>;
  updateLead(id: string, updates: Partial<Lead>): Promise<Lead>;
  
  // Deal management (optional - not all CRMs support deals)
  getDeals?(limit?: number, offset?: number): Promise<Deal[]>;
  getDeal?(id: string): Promise<Deal | null>;
  createDeal?(deal: Omit<Deal, 'id' | 'createdAt' | 'updatedAt'>): Promise<Deal>;
  updateDeal?(id: string, updates: Partial<Deal>): Promise<Deal>;
}

// Calendar adapter interface
export interface CalendarAdapter extends BaseConnectorAdapter {
  type: 'calendar';
  
  // Event management
  getEvents(startDate: Date, endDate: Date): Promise<CalendarEvent[]>;
  getEvent(id: string): Promise<CalendarEvent | null>;
  createEvent(event: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>): Promise<CalendarEvent>;
  updateEvent(id: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent>;
  deleteEvent(id: string): Promise<void>;
  
  // Calendar-specific features
  getAvailableTimeSlots(date: Date, duration: number): Promise<{ start: Date; end: Date }[]>;
  checkAvailability(startTime: Date, endTime: Date): Promise<boolean>;
}

// Adapter factory interface
export interface AdapterFactory {
  createCRMAdapter(provider: string, config: BaseConnectorConfig): CRMAdapter;
  createCalendarAdapter(provider: string, config: BaseConnectorConfig): CalendarAdapter;
}

// Error types for connector operations
export class ConnectorError extends Error {
  constructor(
    message: string,
    public code: string,
    public provider: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export class ConnectorAuthError extends ConnectorError {
  constructor(provider: string, originalError?: Error) {
    super(`Authentication failed for ${provider}`, 'AUTH_ERROR', provider, originalError);
  }
}

export class ConnectorRateLimitError extends ConnectorError {
  constructor(provider: string, retryAfter?: number) {
    super(`Rate limit exceeded for ${provider}`, 'RATE_LIMIT', provider);
    this.retryAfter = retryAfter;
  }
  
  retryAfter?: number;
}

export class ConnectorNotFoundError extends ConnectorError {
  constructor(provider: string, resourceId: string) {
    super(`Resource ${resourceId} not found in ${provider}`, 'NOT_FOUND', provider);
  }
}