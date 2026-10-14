-- CuotaPro Initial Schema
-- Multi-tenant installment collection SaaS for Argentina
-- All monetary values in integer cents (ARS * 100)

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
CREATE TYPE user_role AS ENUM ('owner', 'merchant');
CREATE TYPE plan_status AS ENUM ('draft', 'active', 'completed', 'cancelled');
CREATE TYPE payment_status AS ENUM ('pending', 'partial', 'paid', 'overdue');
CREATE TYPE interest_type AS ENUM ('fixed_surcharge', 'direct_rate', 'french', 'zero_interest');
CREATE TYPE audit_action AS ENUM (
  'plan_created', 'plan_activated', 'plan_cancelled',
  'payment_recorded', 'payment_deleted',
  'installment_edited', 'client_created', 'client_updated',
  'portfolio_created', 'settings_updated', 'user_login', 'user_logout',
  'two_factor_enabled', 'two_factor_disabled', 'passkey_registered'
);

-- Tenants (businesses using the platform)
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug VARCHAR(100) UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  name VARCHAR(255) NOT NULL,
  cbu_alias VARCHAR(100),
  cbu VARCHAR(22),
  cuit VARCHAR(13),
  address TEXT,
  phone VARCHAR(50),
  email VARCHAR(255),
  logo_url TEXT,
  fee_bps INTEGER NOT NULL DEFAULT 0 CHECK (fee_bps >= 0 AND fee_bps <= 10000),
  default_grace_days INTEGER NOT NULL DEFAULT 0 CHECK (default_grace_days >= 0),
  default_penalty_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.001 CHECK (default_penalty_rate >= 0),
  max_penalty_cap NUMERIC(5, 4) NOT NULL DEFAULT 0.30 CHECK (max_penalty_cap >= 0 AND max_penalty_cap <= 1),
  whatsapp_opt_in_text TEXT NOT NULL DEFAULT 'Acepto recibir recordatorios de pago por WhatsApp.',
  privacy_policy_url TEXT,
  terms_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User profiles (extends Supabase auth.users)
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  phone VARCHAR(50),
  totp_secret TEXT,
  totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  recovery_codes TEXT[],
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenant-User relationship
CREATE TABLE tenant_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'merchant',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, user_id)
);

-- Passkeys for WebAuthn
CREATE TABLE passkeys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id TEXT UNIQUE NOT NULL,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  device_type VARCHAR(100),
  transports TEXT[],
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

-- Sessions for multi-device management
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_info TEXT,
  ip_address INET,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Portfolios (grouped collections of plans)
CREATE TABLE portfolios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Clients (debtors)
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES portfolios(id) ON DELETE SET NULL,
  dni_cuit VARCHAR(13) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  address TEXT,
  notes TEXT,
  whatsapp_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, dni_cuit)
);

-- Plans (financing agreements)
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES portfolios(id) ON DELETE SET NULL,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  status plan_status NOT NULL DEFAULT 'draft',
  description TEXT NOT NULL,
  
  -- Financial data (all in cents)
  cash_price_cents BIGINT NOT NULL CHECK (cash_price_cents > 0),
  admin_fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (admin_fee_cents >= 0),
  financed_amount_cents BIGINT NOT NULL CHECK (financed_amount_cents > 0),
  total_amount_cents BIGINT NOT NULL CHECK (total_amount_cents >= financed_amount_cents),
  
  -- Installment config
  num_installments INTEGER NOT NULL CHECK (num_installments > 0 AND num_installments <= 120),
  interest_type interest_type NOT NULL,
  interest_rate NUMERIC(10, 6) NOT NULL CHECK (interest_rate >= 0),
  
  -- Calculated rates (for Ley 24.240 art. 36)
  tna NUMERIC(10, 6) NOT NULL DEFAULT 0,
  tea NUMERIC(10, 6) NOT NULL DEFAULT 0,
  cft NUMERIC(10, 6) NOT NULL DEFAULT 0,
  
  -- Late payment config
  grace_days INTEGER NOT NULL DEFAULT 0,
  penalty_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.001,
  penalty_cap NUMERIC(5, 4) NOT NULL DEFAULT 0.30,
  
  -- Legal compliance
  art36_document_url TEXT,
  art36_accepted_at TIMESTAMPTZ,
  
  -- Lifecycle
  activated_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Installments (individual payments due)
CREATE TABLE installments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number > 0),
  due_date DATE NOT NULL,
  
  -- Amounts (all in cents)
  principal_cents BIGINT NOT NULL CHECK (principal_cents >= 0),
  interest_cents BIGINT NOT NULL CHECK (interest_cents >= 0),
  admin_fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (admin_fee_cents >= 0),
  total_cents BIGINT NOT NULL CHECK (total_cents > 0),
  paid_cents BIGINT NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  penalty_cents BIGINT NOT NULL DEFAULT 0 CHECK (penalty_cents >= 0),
  
  status payment_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(plan_id, number)
);

-- Payments (actual money received)
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  installment_id UUID NOT NULL REFERENCES installments(id) ON DELETE CASCADE,
  
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  penalty_paid_cents BIGINT NOT NULL DEFAULT 0 CHECK (penalty_paid_cents >= 0),
  payment_method VARCHAR(50),
  reference VARCHAR(255),
  notes TEXT,
  receipt_url TEXT,
  
  recorded_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit log
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action audit_action NOT NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- API Keys for integrations
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix VARCHAR(10) NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_tenant_users_user ON tenant_users(user_id);
CREATE INDEX idx_tenant_users_tenant ON tenant_users(tenant_id);
CREATE INDEX idx_portfolios_tenant ON portfolios(tenant_id);
CREATE INDEX idx_clients_tenant ON clients(tenant_id);
CREATE INDEX idx_clients_dni ON clients(dni_cuit);
CREATE INDEX idx_plans_tenant ON plans(tenant_id);
CREATE INDEX idx_plans_client ON plans(client_id);
CREATE INDEX idx_plans_status ON plans(status);
CREATE INDEX idx_installments_plan ON installments(plan_id);
CREATE INDEX idx_installments_due_date ON installments(due_date);
CREATE INDEX idx_installments_status ON installments(status);
CREATE INDEX idx_payments_plan ON payments(plan_id);
CREATE INDEX idx_payments_installment ON payments(installment_id);
CREATE INDEX idx_audit_log_tenant ON audit_log(tenant_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_passkeys_user ON passkeys(user_id);

-- Updated at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_portfolios_updated_at BEFORE UPDATE ON portfolios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_plans_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_installments_updated_at BEFORE UPDATE ON installments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Function to calculate penalty for an overdue installment
CREATE OR REPLACE FUNCTION calculate_installment_penalty(p_installment_id UUID)
RETURNS BIGINT AS $$
DECLARE
  v_installment RECORD;
  v_plan RECORD;
  v_days_overdue INTEGER;
  v_penalty_base BIGINT;
  v_penalty BIGINT;
  v_max_penalty BIGINT;
BEGIN
  SELECT * INTO v_installment FROM installments WHERE id = p_installment_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  
  SELECT * INTO v_plan FROM plans WHERE id = v_installment.plan_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  
  -- Calculate days overdue after grace period
  v_days_overdue := GREATEST(0, CURRENT_DATE - v_installment.due_date - v_plan.grace_days);
  IF v_days_overdue <= 0 THEN RETURN 0; END IF;
  
  -- Calculate penalty
  v_penalty_base := v_installment.total_cents - v_installment.paid_cents;
  v_penalty := (v_penalty_base * v_plan.penalty_rate * v_days_overdue)::BIGINT;
  
  -- Apply cap
  v_max_penalty := (v_penalty_base * v_plan.penalty_cap)::BIGINT;
  v_penalty := LEAST(v_penalty, v_max_penalty);
  
  RETURN v_penalty;
END;
$$ LANGUAGE plpgsql;

-- RLS Policies
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Helper function to get user's tenant IDs
CREATE OR REPLACE FUNCTION get_user_tenant_ids()
RETURNS UUID[] AS $$
  SELECT COALESCE(array_agg(tenant_id), '{}')
  FROM tenant_users
  WHERE user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Tenants: users can only see tenants they belong to
CREATE POLICY "Users can view their tenants"
  ON tenants FOR SELECT
  USING (id = ANY(get_user_tenant_ids()));

CREATE POLICY "Owners can update their tenants"
  ON tenants FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM tenant_users
    WHERE tenant_users.tenant_id = tenants.id
    AND tenant_users.user_id = auth.uid()
    AND tenant_users.role = 'owner'
  ));

-- Tenant users
CREATE POLICY "Users can view tenant members"
  ON tenant_users FOR SELECT
  USING (tenant_id = ANY(get_user_tenant_ids()));

CREATE POLICY "Owners can manage tenant members"
  ON tenant_users FOR ALL
  USING (EXISTS (
    SELECT 1 FROM tenant_users tu
    WHERE tu.tenant_id = tenant_users.tenant_id
    AND tu.user_id = auth.uid()
    AND tu.role = 'owner'
  ));

-- User profiles
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- Passkeys
CREATE POLICY "Users can manage own passkeys"
  ON passkeys FOR ALL
  USING (user_id = auth.uid());

-- Sessions
CREATE POLICY "Users can manage own sessions"
  ON sessions FOR ALL
  USING (user_id = auth.uid());

-- Portfolios
CREATE POLICY "Users can view portfolios"
  ON portfolios FOR SELECT
  USING (tenant_id = ANY(get_user_tenant_ids()));

CREATE POLICY "Users can manage portfolios"
  ON portfolios FOR ALL
  USING (tenant_id = ANY(get_user_tenant_ids()));

-- Clients
CREATE POLICY "Users can view clients"
  ON clients FOR SELECT
  USING (tenant_id = ANY(get_user_tenant_ids()));

CREATE POLICY "Users can manage clients"
  ON clients FOR ALL
  USING (tenant_id = ANY(get_user_tenant_ids()));

-- Plans
CREATE POLICY "Users can view plans"
  ON plans FOR SELECT
  USING (tenant_id = ANY(get_user_tenant_ids()));

CREATE POLICY "Users can manage plans"
  ON plans FOR ALL
  USING (tenant_id = ANY(get_user_tenant_ids()));

-- Installments (via plan's tenant)
CREATE POLICY "Users can view installments"
  ON installments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM plans
    WHERE plans.id = installments.plan_id
    AND plans.tenant_id = ANY(get_user_tenant_ids())
  ));

CREATE POLICY "Users can manage draft installments"
  ON installments FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM plans
    WHERE plans.id = installments.plan_id
    AND plans.tenant_id = ANY(get_user_tenant_ids())
    AND plans.status = 'draft'
  ));

CREATE POLICY "Users can insert installments"
  ON installments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM plans
    WHERE plans.id = installments.plan_id
    AND plans.tenant_id = ANY(get_user_tenant_ids())
  ));

-- Payments
CREATE POLICY "Users can view payments"
  ON payments FOR SELECT
  USING (tenant_id = ANY(get_user_tenant_ids()));

CREATE POLICY "Users can insert payments"
  ON payments FOR INSERT
  WITH CHECK (tenant_id = ANY(get_user_tenant_ids()));

-- Audit log (read-only for users)
CREATE POLICY "Users can view their audit log"
  ON audit_log FOR SELECT
  USING (tenant_id = ANY(get_user_tenant_ids()) OR user_id = auth.uid());

CREATE POLICY "System can insert audit log"
  ON audit_log FOR INSERT
  WITH CHECK (TRUE);

-- API Keys
CREATE POLICY "Users can view API keys"
  ON api_keys FOR SELECT
  USING (tenant_id = ANY(get_user_tenant_ids()));

CREATE POLICY "Owners can manage API keys"
  ON api_keys FOR ALL
  USING (EXISTS (
    SELECT 1 FROM tenant_users
    WHERE tenant_users.tenant_id = api_keys.tenant_id
    AND tenant_users.user_id = auth.uid()
    AND tenant_users.role = 'owner'
  ));
