import { Request, Response } from 'express';

// =============================================================================
// Naforo – Shared TypeScript Types & Enums
// =============================================================================

// ---------------------------------------------------------------------------
// Role enum
// ---------------------------------------------------------------------------
export enum UserRole {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  MANAGER = 'manager',
  ACCOUNTANT = 'accountant',
  OWNER = 'owner',
  TENANT = 'tenant',
  TECHNICIAN = 'technician',
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------
export enum PropertyType {
  BUILDING = 'building',
  RESIDENCE = 'residence',
  VILLA = 'villa',
  APARTMENT = 'apartment',
  SHOP = 'shop',
  OFFICE = 'office',
  PARKING = 'parking',
}

export enum PropertyStatus {
  AVAILABLE = 'available',
  OCCUPIED = 'occupied',
  MAINTENANCE = 'maintenance',
  RESERVED = 'reserved',
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------
export enum ContractStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  EXPIRED = 'expired',
  TERMINATED = 'terminated',
  SUSPENDED = 'suspended',
}

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------
export enum PaymentMethod {
  ORANGE_MONEY = 'orange_money',
  MTN_MONEY = 'mtn_money',
  MOOV_MONEY = 'moov_money',
  WAVE = 'wave',
  BANK_TRANSFER = 'bank_transfer',
  CASH = 'cash',
  CARD = 'card',
}

export enum PaymentStatus {
  PENDING = 'pending',
  VALIDATED = 'validated',
  REJECTED = 'rejected',
  COMPLEMENT_REQUESTED = 'complement_requested',
}

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------
export enum InvoiceStatus {
  PENDING = 'pending',
  PARTIAL = 'partial',
  PAID = 'paid',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
}

// ---------------------------------------------------------------------------
// Incident
// ---------------------------------------------------------------------------
export enum IncidentType {
  LEAK = 'leak',
  BREAKDOWN = 'breakdown',
  AC = 'ac',
  ELECTRICITY = 'electricity',
  PLUMBING = 'plumbing',
  SECURITY = 'security',
  OTHER = 'other',
}

export enum IncidentStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

export enum IncidentPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

// ---------------------------------------------------------------------------
// Notification
// ---------------------------------------------------------------------------
export enum NotificationType {
  // Payment events
  PAYMENT_DECLARED = 'payment_declared',
  PAYMENT_VALIDATED = 'payment_validated',
  PAYMENT_REJECTED = 'payment_rejected',
  PAYMENT_COMPLEMENT_REQUESTED = 'payment_complement_requested',

  // Invoice events
  INVOICE_GENERATED = 'invoice_generated',
  INVOICE_OVERDUE = 'invoice_overdue',

  // Contract events
  CONTRACT_CREATED = 'contract_created',
  CONTRACT_EXPIRING = 'contract_expiring',
  CONTRACT_EXPIRED = 'contract_expired',
  CONTRACT_TERMINATED = 'contract_terminated',

  // Reminder events
  REMINDER_BEFORE_DUE = 'reminder_before_due',
  REMINDER_AFTER_DUE = 'reminder_after_due',

  // Receipt events
  RECEIPT_GENERATED = 'receipt_generated',

  // Incident events
  INCIDENT_CREATED = 'incident_created',
  INCIDENT_ASSIGNED = 'incident_assigned',
  INCIDENT_RESOLVED = 'incident_resolved',

  // System events
  WELCOME = 'welcome',
  PASSWORD_RESET = 'password_reset',
  EMAIL_VERIFIED = 'email_verified',
  ACCOUNT_SUSPENDED = 'account_suspended',
}

// ---------------------------------------------------------------------------
// JWT / Auth
// ---------------------------------------------------------------------------
export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  organizationId: string | null;
  iat?: number;
  exp?: number;
}

export interface AuthUser {
  userId: string;
  email: string;
  role: UserRole;
  organizationId: string | null;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------
export interface PaginationQuery {
  page: number;
  limit: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

// ---------------------------------------------------------------------------
// API Response
// ---------------------------------------------------------------------------
export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  meta?: PaginationMeta;
  errors?: Record<string, string[]>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Express Request augmentation (multi-tenant + auth)
// ---------------------------------------------------------------------------
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      organizationId?: string;
    }
  }
}

// ---------------------------------------------------------------------------
// Database row types
// ---------------------------------------------------------------------------
export interface OrganizationRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string;
  logo_url: string | null;
  plan: string;
  is_active: boolean;
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface UserRow {
  id: string;
  organization_id: string | null;
  email: string;
  phone: string | null;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  avatar_url: string | null;
  is_active: boolean;
  is_email_verified: boolean;
  last_login_at: Date | null;
  refresh_token_hash: string | null;
  fcm_token: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PropertyRow {
  id: string;
  organization_id: string;
  parent_id: string | null;
  name: string;
  type: PropertyType;
  address: string;
  city: string;
  country: string;
  floor: number | null;
  area_sqm: number | null;
  rooms: number | null;
  bathrooms: number | null;
  description: string | null;
  status: PropertyStatus;
  rent_amount: number | null;
  charges_amount: number;
  deposit_amount: number;
  photos: string[];
  amenities: string[];
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ContractRow {
  id: string;
  contract_number: string;
  organization_id: string;
  property_id: string;
  tenant_profile_id: string;
  owner_id: string | null;
  start_date: Date;
  end_date: Date | null;
  rent_amount: number;
  charges_amount: number;
  deposit_amount: number;
  caution_amount: number;
  payment_day: number;
  status: ContractStatus;
  payment_reminder_enabled: boolean;
  notes: string | null;
  document_url: string | null;
  signed_at: Date | null;
  terminated_at: Date | null;
  termination_reason: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  organization_id: string;
  contract_id: string;
  tenant_profile_id: string;
  property_id: string;
  period_month: number;
  period_year: number;
  due_date: Date;
  rent_amount: number;
  charges_amount: number;
  penalty_amount: number;
  total_amount: number;
  status: InvoiceStatus;
  pdf_url: string | null;
  sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface PaymentRow {
  id: string;
  payment_reference: string;
  organization_id: string;
  invoice_id: string | null;
  contract_id: string;
  tenant_profile_id: string;
  declared_by: string | null;
  validated_by: string | null;
  amount: number;
  payment_method: PaymentMethod;
  transaction_number: string | null;
  payment_date: Date;
  proof_url: string | null;
  comment: string | null;
  status: PaymentStatus;
  rejection_reason: string | null;
  complement_message: string | null;
  validated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ReceiptRow {
  id: string;
  receipt_number: string;
  organization_id: string;
  payment_id: string;
  contract_id: string;
  tenant_profile_id: string;
  property_id: string;
  period_month: number;
  period_year: number;
  amount: number;
  qr_code_data: string;
  pdf_url: string | null;
  digital_signature: string;
  issued_at: Date;
  created_at: Date;
}

export interface NotificationRow {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  type: NotificationType;
  title: string;
  message: string;
  data: Record<string, unknown>;
  channels: string[];
  is_read: boolean;
  sent_email: boolean;
  sent_sms: boolean;
  sent_push: boolean;
  sent_at: Date | null;
  created_at: Date;
}

export interface IncidentRow {
  id: string;
  incident_number: string;
  organization_id: string;
  property_id: string;
  tenant_profile_id: string;
  assigned_to: string | null;
  type: IncidentType;
  title: string;
  description: string | null;
  photos: string[];
  status: IncidentStatus;
  priority: IncidentPriority;
  resolution_notes: string | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AuditLogRow {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

