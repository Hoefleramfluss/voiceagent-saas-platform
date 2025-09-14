// API Response Types for React Query
import type { Tenant, Bot, UsageEvent, SupportTicket, User } from "./schema";

// JSON-serialized versions of database types (Date -> string, null preserved)
export type SerializedBot = Omit<Bot, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

export type SerializedTenant = Omit<Tenant, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

export type SerializedUser = Omit<User, 'createdAt' | 'updatedAt' | 'lastLoginAt'> & {
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export type SerializedSupportTicket = Omit<SupportTicket, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

export type SerializedUsageEvent = Omit<UsageEvent, 'timestamp'> & {
  timestamp: string;
};

// Health API Response
export interface HealthResponse {
  status: "healthy" | "unhealthy";
  timestamp: string;
  services: {
    database: string;
    redis: string;
  };
}

// Tenants API Response
export interface TenantsResponse extends Array<SerializedTenant> {}

// Bots API Response
export interface BotsResponse extends Array<SerializedBot> {}

// Usage Summary Response
export interface UsageSummaryResponse {
  call?: {
    count: number;
    quantity: number;
  };
  minute?: {
    count: number;
    quantity: number;
  };
  stt_req?: {
    count: number;
    quantity: number;
  };
  tts_char?: {
    count: number;
    quantity: number;
  };
  gpt_tokens?: {
    count: number;
    quantity: number;
  };
}

// Usage Events Response
export interface UsageEventsResponse extends Array<SerializedUsageEvent> {}

// Support Tickets API Response
export interface SupportTicketsResponse extends Array<SerializedSupportTicket> {}

// Billing/Invoice Response
export interface BillingOverviewResponse {
  totalRevenue: number;
  pendingAmount: number;
  paidInvoices: number;
  failedPayments: number;
  invoices: BillingInvoice[];
}

export interface BillingInvoice {
  id: string;
  amount: number;
  currency: string;
  status: 'paid' | 'pending' | 'failed';
  createdAt: string;
  dueDate: string;
  paidAt?: string;
  periodStart: string;
  periodEnd: string;
  stripeUrl: string;
}

// API Error Response
export interface ApiError {
  message: string;
  errors?: any;
}

// Common API response patterns
export type ApiResponse<T> = T | ApiError;

// Utility type for mutation responses
export interface MutationResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// Additional Billing API Types
export interface CurrentUsageResponse {
  usage: Record<string, number>;
  costs: Record<string, number>;
  totalCost: number;
}

export interface PaymentIntentResponse {
  clientSecret: string;
  amount: number;
  currency: string;
}

export interface PricingTier {
  kind: string;
  name: string;
  ratePerUnit: number;
}

export interface InvoiceResponse {
  id: string;
  tenantId: string;
  totalAmount: string;
  status: 'paid' | 'pending' | 'failed' | 'cancelled';
  createdAt: string;
  periodStart: string;
  periodEnd: string;
  stripeInvoiceId?: string;
  metadata?: any;
}

export interface GenerateInvoiceResponse {
  success: boolean;
  invoice?: {
    id: string;
    totalAmount: number;
  };
  error?: string;
}

export interface AdminBillingOverviewResponse {
  totalRevenue: number;
  pendingAmount: number;
  paidInvoices: number;
  failedPayments: number;
  invoices: BillingInvoice[];
}

// Query key types for type-safe React Query usage
export type QueryKeys = 
  | ["/api/health"]
  | ["/api/tenants"]
  | ["/api/bots"]
  | ["/api/bots", string] // with tenantId
  | ["/api/usage/summary", string] // with time period
  | ["/api/usage/events"] // usage events
  | ["/api/support/tickets"]
  | ["/api/billing/overview", string, string] // with timeRange and tenantId
  | ["/api/billing/current-usage"]
  | ["/api/billing/invoices"]
  | ["/api/billing/pricing"]
  | ["/api/admin/billing/overview", string, string]; // admin billing with params