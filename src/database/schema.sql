-- =============================================================================
-- BAILFLOW - Complete Database Schema
-- PostgreSQL 15+
-- =============================================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- Organizations (Multi-tenant root)
-- =============================================================================
CREATE TABLE IF NOT EXISTS organizations (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255)  NOT NULL,
  email         VARCHAR(255)  UNIQUE,
  phone         VARCHAR(50),
  address       TEXT,
  city          VARCHAR(100),
  country       VARCHAR(10)   DEFAULT 'CI',
  logo_url      TEXT,
  plan          VARCHAR(50)   DEFAULT 'starter',
  is_active     BOOLEAN       DEFAULT true,
  settings      JSONB         DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ   DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   DEFAULT NOW()
);

-- =============================================================================
-- Users
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID          REFERENCES organizations(id) ON DELETE SET NULL,
  email               VARCHAR(255)  UNIQUE NOT NULL,
  phone               VARCHAR(50),
  password_hash       VARCHAR(255)  NOT NULL,
  first_name          VARCHAR(100)  NOT NULL,
  last_name           VARCHAR(100)  NOT NULL,
  role                VARCHAR(50)   NOT NULL CHECK (role IN ('super_admin','admin','manager','accountant','owner','tenant','technician')),
  avatar_url          TEXT,
  is_active           BOOLEAN       DEFAULT true,
  is_email_verified   BOOLEAN       DEFAULT false,
  last_login_at       TIMESTAMPTZ,
  refresh_token_hash  VARCHAR(255),
  fcm_token           TEXT,
  created_at          TIMESTAMPTZ   DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   DEFAULT NOW()
);

-- =============================================================================
-- Properties (Biens immobiliers)
-- =============================================================================
CREATE TABLE IF NOT EXISTS properties (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID            NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id       UUID            REFERENCES properties(id) ON DELETE SET NULL,
  name            VARCHAR(255)    NOT NULL,
  type            VARCHAR(50)     NOT NULL CHECK (type IN ('building','residence','villa','apartment','shop','office','parking')),
  address         TEXT            NOT NULL,
  city            VARCHAR(100)    DEFAULT 'Abidjan',
  country         VARCHAR(10)     DEFAULT 'CI',
  floor           INTEGER,
  area_sqm        DECIMAL(10,2),
  rooms           INTEGER,
  bathrooms       INTEGER,
  description     TEXT,
  status          VARCHAR(50)     DEFAULT 'available' CHECK (status IN ('available','occupied','maintenance','reserved')),
  rent_amount     DECIMAL(15,2),
  charges_amount  DECIMAL(15,2)   DEFAULT 0,
  deposit_amount  DECIMAL(15,2)   DEFAULT 0,
  photos          JSONB           DEFAULT '[]'::jsonb,
  amenities       JSONB           DEFAULT '[]'::jsonb,
  created_by      UUID            REFERENCES users(id),
  created_at      TIMESTAMPTZ     DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     DEFAULT NOW()
);

-- =============================================================================
-- Tenant Profiles
-- =============================================================================
CREATE TABLE IF NOT EXISTS tenant_profiles (
  id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID            UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  organization_id         UUID            NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_name              VARCHAR(100)    NOT NULL,
  last_name               VARCHAR(100)    NOT NULL,
  email                   VARCHAR(255),
  phone                   VARCHAR(50)     NOT NULL,
  national_id             VARCHAR(100),
  profession              VARCHAR(255),
  employer                VARCHAR(255),
  monthly_income          DECIMAL(15,2),
  emergency_contact_name  VARCHAR(255),
  emergency_contact_phone VARCHAR(50),
  reliability_score       INTEGER         DEFAULT 100 CHECK (reliability_score >= 0 AND reliability_score <= 100),
  avatar_url              TEXT,
  notes                   TEXT,
  is_active               BOOLEAN         DEFAULT true,
  created_at              TIMESTAMPTZ     DEFAULT NOW(),
  updated_at              TIMESTAMPTZ     DEFAULT NOW()
);

-- =============================================================================
-- Contracts (Baux)
-- =============================================================================
CREATE TABLE IF NOT EXISTS contracts (
  id                        UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number           VARCHAR(100)    UNIQUE NOT NULL,
  organization_id           UUID            NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id               UUID            NOT NULL REFERENCES properties(id),
  tenant_profile_id         UUID            NOT NULL REFERENCES tenant_profiles(id),
  owner_id                  UUID            REFERENCES users(id),
  start_date                DATE            NOT NULL,
  end_date                  DATE,
  rent_amount               DECIMAL(15,2)   NOT NULL,
  charges_amount            DECIMAL(15,2)   DEFAULT 0,
  deposit_amount            DECIMAL(15,2)   DEFAULT 0,
  caution_amount            DECIMAL(15,2)   DEFAULT 0,
  payment_day               INTEGER         DEFAULT 5 CHECK (payment_day >= 1 AND payment_day <= 31),
  status                    VARCHAR(50)     DEFAULT 'active' CHECK (status IN ('draft','active','expired','terminated','suspended')),
  payment_reminder_enabled  BOOLEAN         DEFAULT true,
  notes                     TEXT,
  document_url              TEXT,
  signed_at                 TIMESTAMPTZ,
  terminated_at             TIMESTAMPTZ,
  termination_reason        TEXT,
  created_by                UUID            REFERENCES users(id),
  created_at                TIMESTAMPTZ     DEFAULT NOW(),
  updated_at                TIMESTAMPTZ     DEFAULT NOW()
);

-- =============================================================================
-- Invoices (Factures)
-- =============================================================================
CREATE TABLE IF NOT EXISTS invoices (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number    VARCHAR(100)    UNIQUE NOT NULL,
  organization_id   UUID            NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id       UUID            NOT NULL REFERENCES contracts(id),
  tenant_profile_id UUID            NOT NULL REFERENCES tenant_profiles(id),
  property_id       UUID            NOT NULL REFERENCES properties(id),
  period_month      INTEGER         NOT NULL CHECK (period_month >= 1 AND period_month <= 12),
  period_year       INTEGER         NOT NULL,
  due_date          DATE            NOT NULL,
  rent_amount       DECIMAL(15,2)   NOT NULL,
  charges_amount    DECIMAL(15,2)   DEFAULT 0,
  penalty_amount    DECIMAL(15,2)   DEFAULT 0,
  total_amount      DECIMAL(15,2)   NOT NULL,
  status            VARCHAR(50)     DEFAULT 'pending' CHECK (status IN ('pending','partial','paid','overdue','cancelled')),
  pdf_url           TEXT,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ     DEFAULT NOW(),
  updated_at        TIMESTAMPTZ     DEFAULT NOW()
);

-- =============================================================================
-- Payments (Paiements)
-- =============================================================================
CREATE TABLE IF NOT EXISTS payments (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_reference   VARCHAR(100)    UNIQUE NOT NULL,
  organization_id     UUID            NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id          UUID            REFERENCES invoices(id),
  contract_id         UUID            NOT NULL REFERENCES contracts(id),
  tenant_profile_id   UUID            NOT NULL REFERENCES tenant_profiles(id),
  declared_by         UUID            REFERENCES users(id),
  validated_by        UUID            REFERENCES users(id),
  amount              DECIMAL(15,2)   NOT NULL,
  payment_method      VARCHAR(50)     NOT NULL CHECK (payment_method IN ('orange_money','mtn_money','moov_money','wave','bank_transfer','cash','card')),
  transaction_number  VARCHAR(255),
  payment_date        DATE            NOT NULL,
  proof_url           TEXT,
  comment             TEXT,
  status              VARCHAR(50)     DEFAULT 'pending' CHECK (status IN ('pending','validated','rejected','complement_requested')),
  rejection_reason    TEXT,
  complement_message  TEXT,
  validated_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ     DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     DEFAULT NOW()
);

-- =============================================================================
-- Receipts (Quittances)
-- =============================================================================
CREATE TABLE IF NOT EXISTS receipts (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number    VARCHAR(100)    UNIQUE NOT NULL,
  organization_id   UUID            NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_id        UUID            NOT NULL REFERENCES payments(id),
  contract_id       UUID            NOT NULL REFERENCES contracts(id),
  tenant_profile_id UUID            NOT NULL REFERENCES tenant_profiles(id),
  property_id       UUID            NOT NULL REFERENCES properties(id),
  period_month      INTEGER         NOT NULL,
  period_year       INTEGER         NOT NULL,
  amount            DECIMAL(15,2)   NOT NULL,
  qr_code_data      TEXT            NOT NULL,
  pdf_url           TEXT,
  digital_signature VARCHAR(255)    NOT NULL,
  issued_at         TIMESTAMPTZ     DEFAULT NOW(),
  created_at        TIMESTAMPTZ     DEFAULT NOW()
);

-- =============================================================================
-- Notifications
-- =============================================================================
CREATE TABLE IF NOT EXISTS notifications (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID          REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID          REFERENCES users(id) ON DELETE CASCADE,
  type            VARCHAR(100)  NOT NULL,
  title           VARCHAR(255)  NOT NULL,
  message         TEXT          NOT NULL,
  data            JSONB         DEFAULT '{}'::jsonb,
  channels        JSONB         DEFAULT '[]'::jsonb,
  is_read         BOOLEAN       DEFAULT false,
  sent_email      BOOLEAN       DEFAULT false,
  sent_sms        BOOLEAN       DEFAULT false,
  sent_push       BOOLEAN       DEFAULT false,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   DEFAULT NOW()
);

-- =============================================================================
-- Incidents
-- =============================================================================
CREATE TABLE IF NOT EXISTS incidents (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_number   VARCHAR(100)  UNIQUE NOT NULL,
  organization_id   UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id       UUID          NOT NULL REFERENCES properties(id),
  tenant_profile_id UUID          NOT NULL REFERENCES tenant_profiles(id),
  assigned_to       UUID          REFERENCES users(id),
  type              VARCHAR(100)  NOT NULL CHECK (type IN ('leak','breakdown','ac','electricity','plumbing','security','other')),
  title             VARCHAR(255)  NOT NULL,
  description       TEXT,
  photos            JSONB         DEFAULT '[]'::jsonb,
  status            VARCHAR(50)   DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  priority          VARCHAR(50)   DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  resolution_notes  TEXT,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   DEFAULT NOW()
);

-- =============================================================================
-- Documents
-- =============================================================================
CREATE TABLE IF NOT EXISTS documents (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type     VARCHAR(100)  NOT NULL,
  entity_id       UUID          NOT NULL,
  name            VARCHAR(255)  NOT NULL,
  type            VARCHAR(100)  NOT NULL,
  file_url        TEXT          NOT NULL,
  file_size       INTEGER,
  mime_type       VARCHAR(100),
  uploaded_by     UUID          REFERENCES users(id),
  created_at      TIMESTAMPTZ   DEFAULT NOW()
);

-- =============================================================================
-- Audit Logs
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID          REFERENCES organizations(id) ON DELETE SET NULL,
  user_id         UUID          REFERENCES users(id) ON DELETE SET NULL,
  action          VARCHAR(255)  NOT NULL,
  entity_type     VARCHAR(100),
  entity_id       UUID,
  old_data        JSONB,
  new_data        JSONB,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ   DEFAULT NOW()
);

-- =============================================================================
-- Notification Preferences
-- =============================================================================
CREATE TABLE IF NOT EXISTS notification_preferences (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_enabled         BOOLEAN     DEFAULT true,
  sms_enabled           BOOLEAN     DEFAULT false,
  push_enabled          BOOLEAN     DEFAULT true,
  reminder_enabled      BOOLEAN     DEFAULT true,
  reminder_days_before  INTEGER[]   DEFAULT ARRAY[15,7,3,1],
  reminder_days_after   INTEGER[]   DEFAULT ARRAY[3,7,15],
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- OTP Tokens
-- =============================================================================
CREATE TABLE IF NOT EXISTS otp_tokens (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID          REFERENCES users(id) ON DELETE CASCADE,
  token       VARCHAR(10)   NOT NULL,
  type        VARCHAR(50)   NOT NULL CHECK (type IN ('email_verification','password_reset','2fa')),
  expires_at  TIMESTAMPTZ   NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ   DEFAULT NOW()
);

-- =============================================================================
-- Indexes
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_users_org             ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_users_email           ON users(email);
CREATE INDEX IF NOT EXISTS idx_properties_org        ON properties(organization_id);
CREATE INDEX IF NOT EXISTS idx_properties_status     ON properties(status);
CREATE INDEX IF NOT EXISTS idx_tenant_profiles_org   ON tenant_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_contracts_org         ON contracts(organization_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status      ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_end_date    ON contracts(end_date);
CREATE INDEX IF NOT EXISTS idx_invoices_org          ON invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status       ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date     ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_payments_org          ON payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_payments_status       ON payments(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user    ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read    ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_incidents_org         ON incidents(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org        ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user       ON audit_logs(user_id);

-- =============================================================================
-- Chat Threads & Messages
-- =============================================================================
CREATE TABLE IF NOT EXISTS chat_threads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id       UUID REFERENCES properties(id) ON DELETE SET NULL,
  contract_id       UUID REFERENCES contracts(id) ON DELETE SET NULL,
  tenant_profile_id UUID NOT NULL REFERENCES tenant_profiles(id) ON DELETE CASCADE,
  last_message_at   TIMESTAMPTZ DEFAULT NOW(),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id    UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender_id    UUID NOT NULL,
  sender_role  VARCHAR(50) NOT NULL,
  content      TEXT NOT NULL,
  attachments  JSONB DEFAULT '[]'::jsonb,
  is_read      BOOLEAN DEFAULT false,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_org ON chat_threads(organization_id);
CREATE INDEX IF NOT EXISTS idx_chat_threads_tenant ON chat_threads(tenant_profile_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id);

-- =============================================================================
-- Master Data: Countries & Cities (Données Géographiques)
-- =============================================================================
CREATE TABLE IF NOT EXISTS countries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(10) UNIQUE NOT NULL,
  name        VARCHAR(100) UNIQUE NOT NULL,
  phone_code  VARCHAR(20),
  currency    VARCHAR(10) DEFAULT 'XOF',
  flag        VARCHAR(20),
  is_active   BOOLEAN DEFAULT true,
  "order"     INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id  UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  region      VARCHAR(100),
  is_active   BOOLEAN DEFAULT true,
  "order"     INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_country_city UNIQUE (country_id, name)
);

CREATE INDEX IF NOT EXISTS idx_cities_country ON cities(country_id);

-- Assurer que la colonne country des properties supporte les noms de pays complets
ALTER TABLE properties ALTER COLUMN country TYPE VARCHAR(100);

