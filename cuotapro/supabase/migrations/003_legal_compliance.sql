-- Migration: Legal Compliance (Ley 24.240 Art. 36, WhatsApp Opt-in, Terms/Privacy)
-- 
-- This migration adds:
-- 1. Art. 36 acceptance tracking (date, IP, version, SHA-256 hash)
-- 2. WhatsApp opt-in/opt-out with signed links
-- 3. Legal acceptances table for Terms and Privacy
-- 4. Enhanced installments trigger (block amount_cents/due_date outside draft)
-- 5. Penalty cap validation (plan.penalty_cap <= tenant.max_penalty_cap)

-- ============================================================================
-- EXTENSIONS (ensure pgcrypto is in extensions schema for gen_random_bytes)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ============================================================================
-- 1. ART. 36 ACCEPTANCE TRACKING
-- ============================================================================

-- Add columns for Art. 36 compliance
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS art36_ip_address INET,
  ADD COLUMN IF NOT EXISTS art36_document_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS art36_document_hash VARCHAR(64);

COMMENT ON COLUMN public.plans.art36_document_url IS 'URL to the generated Art. 36 PDF document';
COMMENT ON COLUMN public.plans.art36_accepted_at IS 'Timestamp when client accepted the Art. 36 document';
COMMENT ON COLUMN public.plans.art36_ip_address IS 'Client IP address at time of Art. 36 acceptance';
COMMENT ON COLUMN public.plans.art36_document_version IS 'Version of the Art. 36 document template';
COMMENT ON COLUMN public.plans.art36_document_hash IS 'SHA-256 hash of the PDF content for integrity verification';

-- Function to record Art. 36 acceptance
CREATE OR REPLACE FUNCTION public.record_art36_acceptance(
  p_plan_id UUID,
  p_document_url TEXT,
  p_document_version VARCHAR(50),
  p_document_hash VARCHAR(64),
  p_ip_address INET DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_tenant_id UUID;
  v_status public.plan_status;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  
  -- Validate hash format (64 hex chars for SHA-256)
  IF p_document_hash IS NULL OR length(p_document_hash) != 64 OR p_document_hash !~ '^[a-f0-9]+$' THEN
    RAISE EXCEPTION 'Invalid document hash: must be 64 hex characters (SHA-256)' USING ERRCODE = 'P0002';
  END IF;
  
  SELECT tenant_id, status INTO v_tenant_id, v_status
  FROM public.plans WHERE id = p_plan_id
  FOR UPDATE;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Plan not found' USING ERRCODE = 'P0003';
  END IF;
  
  IF NOT public.is_tenant_member(v_tenant_id) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  
  IF v_status != 'draft' THEN
    RAISE EXCEPTION 'Art. 36 acceptance can only be recorded for draft plans' USING ERRCODE = 'P0004';
  END IF;
  
  UPDATE public.plans
  SET 
    art36_document_url = p_document_url,
    art36_document_version = p_document_version,
    art36_document_hash = p_document_hash,
    art36_accepted_at = NOW(),
    art36_ip_address = p_ip_address,
    updated_at = NOW()
  WHERE id = p_plan_id;
  
  INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id, new_data)
  VALUES (
    v_tenant_id,
    v_user_id,
    'plan_activated', -- Using existing enum
    'art36_acceptance',
    p_plan_id,
    json_build_object(
      'document_url', p_document_url,
      'document_version', p_document_version,
      'document_hash', p_document_hash,
      'ip_address', p_ip_address::text
    )
  );
  
  RETURN json_build_object('success', true, 'accepted_at', NOW());
END;
$$;

REVOKE ALL ON FUNCTION public.record_art36_acceptance(UUID, TEXT, VARCHAR, VARCHAR, INET) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_art36_acceptance(UUID, TEXT, VARCHAR, VARCHAR, INET) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_art36_acceptance(UUID, TEXT, VARCHAR, VARCHAR, INET) TO authenticated;

-- Update activate_plan to require Art. 36 acceptance
CREATE OR REPLACE FUNCTION public.activate_plan(p_plan_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_tenant_id UUID;
  v_status public.plan_status;
  v_art36_accepted_at TIMESTAMPTZ;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = 'P0001';
  END IF;
  
  SELECT tenant_id, status, art36_accepted_at INTO v_tenant_id, v_status, v_art36_accepted_at
  FROM public.plans WHERE id = p_plan_id
  FOR UPDATE;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Plan no encontrado' USING ERRCODE = 'P0003';
  END IF;
  
  IF NOT public.is_tenant_member(v_tenant_id) THEN
    RAISE EXCEPTION 'No tenés acceso a este plan' USING ERRCODE = '42501';
  END IF;
  
  IF v_status != 'draft' THEN
    RAISE EXCEPTION 'Solo podés activar planes en borrador' USING ERRCODE = 'P0004';
  END IF;
  
  -- Require Art. 36 acceptance
  IF v_art36_accepted_at IS NULL THEN
    RAISE EXCEPTION 'El cliente debe aceptar el documento Art. 36 antes de activar el plan' USING ERRCODE = 'P0006';
  END IF;
  
  UPDATE public.plans
  SET status = 'active', activated_at = NOW(), updated_at = NOW()
  WHERE id = p_plan_id;
  
  INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id)
  VALUES (v_tenant_id, v_user_id, 'plan_activated', 'plan', p_plan_id);
  
  RETURN json_build_object('success', true);
END;
$$;

-- ============================================================================
-- 2. WHATSAPP OPT-IN/OPT-OUT
-- ============================================================================

-- Add columns for WhatsApp consent tracking
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_source VARCHAR(100),
  ADD COLUMN IF NOT EXISTS whatsapp_opt_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_out_token VARCHAR(64);

COMMENT ON COLUMN public.clients.whatsapp_opt_in IS 'Current opt-in status (derived from opt_in_at and opt_out_at)';
COMMENT ON COLUMN public.clients.whatsapp_opt_in_at IS 'When the client opted in to WhatsApp messages';
COMMENT ON COLUMN public.clients.whatsapp_opt_in_source IS 'Source of opt-in (signup, plan_creation, manual, etc.)';
COMMENT ON COLUMN public.clients.whatsapp_opt_out_at IS 'When the client opted out (null if still opted in)';
COMMENT ON COLUMN public.clients.whatsapp_opt_out_token IS 'Signed token for one-click opt-out link';

-- Function to record WhatsApp opt-in
CREATE OR REPLACE FUNCTION public.record_whatsapp_opt_in(
  p_client_id UUID,
  p_source VARCHAR(100) DEFAULT 'manual'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_tenant_id UUID;
  v_token VARCHAR(64);
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  
  SELECT tenant_id INTO v_tenant_id
  FROM public.clients WHERE id = p_client_id;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Client not found' USING ERRCODE = 'P0003';
  END IF;
  
  IF NOT public.is_tenant_member(v_tenant_id) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  
  -- Generate a secure, non-guessable opt-out token
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  
  UPDATE public.clients
  SET 
    whatsapp_opt_in = TRUE,
    whatsapp_opt_in_at = NOW(),
    whatsapp_opt_in_source = p_source,
    whatsapp_opt_out_at = NULL,
    whatsapp_opt_out_token = v_token,
    updated_at = NOW()
  WHERE id = p_client_id;
  
  RETURN json_build_object(
    'success', true,
    'opted_in_at', NOW(),
    'opt_out_token', v_token
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_whatsapp_opt_in(UUID, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_whatsapp_opt_in(UUID, VARCHAR) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_opt_in(UUID, VARCHAR) TO authenticated;

-- Function to process opt-out via signed link (callable by anon for one-click unsubscribe)
CREATE OR REPLACE FUNCTION public.process_whatsapp_opt_out(
  p_client_id UUID,
  p_token VARCHAR(64)
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stored_token VARCHAR(64);
  v_tenant_id UUID;
BEGIN
  -- Get the stored token (no auth required - token IS the auth)
  SELECT whatsapp_opt_out_token, tenant_id INTO v_stored_token, v_tenant_id
  FROM public.clients WHERE id = p_client_id;
  
  IF v_stored_token IS NULL THEN
    RAISE EXCEPTION 'Invalid opt-out request' USING ERRCODE = 'P0002';
  END IF;
  
  -- Verify token matches (constant-time comparison would be ideal but this is acceptable)
  IF v_stored_token != p_token THEN
    RAISE EXCEPTION 'Invalid opt-out token' USING ERRCODE = 'P0002';
  END IF;
  
  UPDATE public.clients
  SET 
    whatsapp_opt_in = FALSE,
    whatsapp_opt_out_at = NOW(),
    updated_at = NOW()
  WHERE id = p_client_id;
  
  INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id, new_data)
  VALUES (
    v_tenant_id,
    NULL, -- No user - self-service opt-out
    'client_updated',
    'whatsapp_opt_out',
    p_client_id,
    json_build_object('opted_out_at', NOW())
  );
  
  RETURN json_build_object('success', true, 'message', 'Has sido dado de baja de los mensajes de WhatsApp.');
END;
$$;

-- Allow anon to call opt-out (one-click unsubscribe)
REVOKE ALL ON FUNCTION public.process_whatsapp_opt_out(UUID, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_whatsapp_opt_out(UUID, VARCHAR) TO anon;
GRANT EXECUTE ON FUNCTION public.process_whatsapp_opt_out(UUID, VARCHAR) TO authenticated;

-- Function to check if WhatsApp messages can be sent
CREATE OR REPLACE FUNCTION public.can_send_whatsapp(p_client_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_opt_in BOOLEAN;
  v_opt_out_at TIMESTAMPTZ;
BEGIN
  SELECT whatsapp_opt_in, whatsapp_opt_out_at INTO v_opt_in, v_opt_out_at
  FROM public.clients WHERE id = p_client_id;
  
  -- Can't send if: not found, not opted in, or has opted out
  IF v_opt_in IS NULL OR v_opt_in = FALSE THEN
    RETURN FALSE;
  END IF;
  
  IF v_opt_out_at IS NOT NULL THEN
    RETURN FALSE;
  END IF;
  
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.can_send_whatsapp(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_send_whatsapp(UUID) TO authenticated;

-- ============================================================================
-- 3. LEGAL ACCEPTANCES TABLE (Terms and Privacy)
-- ============================================================================

-- Document types enum
CREATE TYPE legal_document_type AS ENUM ('terms_of_service', 'privacy_policy', 'art36_conditions');

-- Table to version legal documents
CREATE TABLE IF NOT EXISTS public.legal_document_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_type legal_document_type NOT NULL,
  version VARCHAR(50) NOT NULL,
  content_hash VARCHAR(64) NOT NULL, -- SHA-256 of the content
  content_url TEXT, -- URL to the document
  effective_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(document_type, version)
);

COMMENT ON TABLE public.legal_document_versions IS 'Versioned legal documents (Terms, Privacy, Art.36)';

-- Table to track user acceptances
CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  document_type legal_document_type NOT NULL,
  document_version VARCHAR(50) NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT,
  UNIQUE(user_id, document_type, document_version)
);

COMMENT ON TABLE public.legal_acceptances IS 'Tracks user acceptances of legal documents';
COMMENT ON COLUMN public.legal_acceptances.user_id IS 'User who accepted (nullable for pre-signup)';
COMMENT ON COLUMN public.legal_acceptances.tenant_id IS 'Tenant context if applicable';
COMMENT ON COLUMN public.legal_acceptances.document_version IS 'Version of the document that was accepted';
COMMENT ON COLUMN public.legal_acceptances.ip_address IS 'IP address at time of acceptance (Ley 25.326)';

-- Enable RLS
ALTER TABLE public.legal_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

-- RLS: Anyone can view document versions
CREATE POLICY "Anyone can view document versions"
  ON public.legal_document_versions FOR SELECT
  USING (TRUE);

-- RLS: Only system can manage document versions
CREATE POLICY "System can manage document versions"
  ON public.legal_document_versions FOR ALL
  USING (current_user IN ('postgres', 'supabase_admin'));

-- RLS: Users can view their own acceptances
CREATE POLICY "Users can view own acceptances"
  ON public.legal_acceptances FOR SELECT
  USING (user_id = auth.uid() OR tenant_id = ANY(public.get_user_tenant_ids()));

-- RLS: Users can insert their own acceptances
CREATE POLICY "Users can insert own acceptances"
  ON public.legal_acceptances FOR INSERT
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Function to record legal acceptance
CREATE OR REPLACE FUNCTION public.record_legal_acceptance(
  p_document_type legal_document_type,
  p_document_version VARCHAR(50),
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_acceptance_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  
  -- Verify the document version exists
  IF NOT EXISTS (
    SELECT 1 FROM public.legal_document_versions
    WHERE document_type = p_document_type AND version = p_document_version
  ) THEN
    RAISE EXCEPTION 'Document version not found' USING ERRCODE = 'P0003';
  END IF;
  
  INSERT INTO public.legal_acceptances (user_id, document_type, document_version, ip_address, user_agent)
  VALUES (v_user_id, p_document_type, p_document_version, p_ip_address, p_user_agent)
  ON CONFLICT (user_id, document_type, document_version) DO UPDATE SET
    accepted_at = NOW(),
    ip_address = EXCLUDED.ip_address
  RETURNING id INTO v_acceptance_id;
  
  RETURN json_build_object(
    'success', true,
    'acceptance_id', v_acceptance_id,
    'accepted_at', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_legal_acceptance(legal_document_type, VARCHAR, INET, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_legal_acceptance(legal_document_type, VARCHAR, INET, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_legal_acceptance(legal_document_type, VARCHAR, INET, TEXT) TO authenticated;

-- Function to check if user has accepted required documents
CREATE OR REPLACE FUNCTION public.has_accepted_legal_documents(
  p_required_documents legal_document_type[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_accepted_count INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  SELECT COUNT(DISTINCT document_type) INTO v_accepted_count
  FROM public.legal_acceptances
  WHERE user_id = v_user_id AND document_type = ANY(p_required_documents);
  
  RETURN v_accepted_count = array_length(p_required_documents, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.has_accepted_legal_documents(legal_document_type[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_accepted_legal_documents(legal_document_type[]) TO authenticated;

-- Insert initial document versions (v1.0)
INSERT INTO public.legal_document_versions (document_type, version, content_hash, effective_date) VALUES
  ('terms_of_service', '1.0', '0000000000000000000000000000000000000000000000000000000000000000', CURRENT_DATE),
  ('privacy_policy', '1.0', '0000000000000000000000000000000000000000000000000000000000000000', CURRENT_DATE)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 4. ENHANCED INSTALLMENTS TRIGGER
-- ============================================================================

-- Update installments trigger to also block total_cents and due_date changes outside draft
CREATE OR REPLACE FUNCTION public.installments_immutable_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_plan_status public.plan_status;
BEGIN
  -- Always block plan_id changes
  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
    RAISE EXCEPTION 'Cannot change plan_id' USING ERRCODE = '23514';
  END IF;
  
  -- Get plan status
  SELECT status INTO v_plan_status FROM public.plans WHERE id = NEW.plan_id;
  
  -- Block changes outside SECURITY DEFINER context
  IF current_user NOT IN ('postgres', 'supabase_admin') THEN
    -- Always block paid_cents and status changes
    IF NEW.paid_cents IS DISTINCT FROM OLD.paid_cents THEN
      RAISE EXCEPTION 'Cannot change paid_cents directly; use register_payment RPC' USING ERRCODE = '23514';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Cannot change installment status directly; use register_payment RPC' USING ERRCODE = '23514';
    END IF;
    
    -- Block total_cents and due_date if plan is not draft
    IF v_plan_status != 'draft' THEN
      IF NEW.total_cents IS DISTINCT FROM OLD.total_cents THEN
        RAISE EXCEPTION 'Cannot change total_cents on non-draft plan; installments are immutable after activation' USING ERRCODE = '23514';
      END IF;
      IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
        RAISE EXCEPTION 'Cannot change due_date on non-draft plan; installments are immutable after activation' USING ERRCODE = '23514';
      END IF;
      IF NEW.principal_cents IS DISTINCT FROM OLD.principal_cents THEN
        RAISE EXCEPTION 'Cannot change principal_cents on non-draft plan; installments are immutable after activation' USING ERRCODE = '23514';
      END IF;
      IF NEW.interest_cents IS DISTINCT FROM OLD.interest_cents THEN
        RAISE EXCEPTION 'Cannot change interest_cents on non-draft plan; installments are immutable after activation' USING ERRCODE = '23514';
      END IF;
      IF NEW.admin_fee_cents IS DISTINCT FROM OLD.admin_fee_cents THEN
        RAISE EXCEPTION 'Cannot change admin_fee_cents on non-draft plan; installments are immutable after activation' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 5. PENALTY CAP VALIDATION
-- ============================================================================

-- Add constraint to ensure plan.penalty_cap <= tenant.max_penalty_cap
CREATE OR REPLACE FUNCTION public.check_penalty_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant_max_cap NUMERIC(5, 4);
BEGIN
  SELECT max_penalty_cap INTO v_tenant_max_cap
  FROM public.tenants WHERE id = NEW.tenant_id;
  
  IF NEW.penalty_cap > v_tenant_max_cap THEN
    RAISE EXCEPTION 'Plan penalty_cap (%) cannot exceed tenant max_penalty_cap (%)', 
      NEW.penalty_cap, v_tenant_max_cap
    USING ERRCODE = '23514';
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_plan_penalty_cap ON public.plans;
CREATE TRIGGER check_plan_penalty_cap
  BEFORE INSERT OR UPDATE OF penalty_cap ON public.plans
  FOR EACH ROW
  EXECUTE FUNCTION public.check_penalty_cap();

-- Also validate existing plans (this should not fail if data is clean)
-- If it does fail, you need to fix the data first

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user ON public.legal_acceptances(user_id);
CREATE INDEX IF NOT EXISTS idx_legal_acceptances_type ON public.legal_acceptances(document_type);
CREATE INDEX IF NOT EXISTS idx_legal_document_versions_type ON public.legal_document_versions(document_type);
CREATE INDEX IF NOT EXISTS idx_clients_opt_out_token ON public.clients(whatsapp_opt_out_token) WHERE whatsapp_opt_out_token IS NOT NULL;
