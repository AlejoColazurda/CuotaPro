-- Migration: Fix RLS policies for onboarding and tenant creation
-- Addresses:
--   - No INSERT policy on tenants (42501)
--   - Recursive policy on tenant_users (42P17)
--   - First owner cannot insert into tenant_users
--   - Prevent tenant hopping via UPDATE
--   - Secure payment recording via RPC only
--   - Audit log writes via RPC only

-- ============================================================================
-- EXTENSIONS (in extensions schema for security)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- ============================================================================
-- IMMUTABLE FIELD TRIGGERS (prevent tenant hopping)
-- ============================================================================

-- tenant_users: prevent changes to tenant_id and user_id
CREATE OR REPLACE FUNCTION public.tenant_users_immutable_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Cannot change tenant_id' USING ERRCODE = '23514';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Cannot change user_id' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenant_users_immutable ON public.tenant_users;
CREATE TRIGGER tenant_users_immutable
  BEFORE UPDATE ON public.tenant_users
  FOR EACH ROW
  EXECUTE FUNCTION public.tenant_users_immutable_check();

-- clients: prevent changes to tenant_id
CREATE OR REPLACE FUNCTION public.clients_immutable_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Cannot change tenant_id' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_immutable ON public.clients;
CREATE TRIGGER clients_immutable
  BEFORE UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.clients_immutable_check();

-- portfolios: prevent changes to tenant_id
CREATE OR REPLACE FUNCTION public.portfolios_immutable_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Cannot change tenant_id' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS portfolios_immutable ON public.portfolios;
CREATE TRIGGER portfolios_immutable
  BEFORE UPDATE ON public.portfolios
  FOR EACH ROW
  EXECUTE FUNCTION public.portfolios_immutable_check();

-- plans: prevent changes to tenant_id and client_id
CREATE OR REPLACE FUNCTION public.plans_immutable_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Cannot change tenant_id' USING ERRCODE = '23514';
  END IF;
  IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    RAISE EXCEPTION 'Cannot change client_id' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS plans_immutable ON public.plans;
CREATE TRIGGER plans_immutable
  BEFORE UPDATE ON public.plans
  FOR EACH ROW
  EXECUTE FUNCTION public.plans_immutable_check();

-- installments: prevent changes to plan_id
CREATE OR REPLACE FUNCTION public.installments_immutable_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
    RAISE EXCEPTION 'Cannot change plan_id' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS installments_immutable ON public.installments;
CREATE TRIGGER installments_immutable
  BEFORE UPDATE ON public.installments
  FOR EACH ROW
  EXECUTE FUNCTION public.installments_immutable_check();

-- payments: prevent changes to tenant_id, plan_id, installment_id
CREATE OR REPLACE FUNCTION public.payments_immutable_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Cannot change tenant_id' USING ERRCODE = '23514';
  END IF;
  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
    RAISE EXCEPTION 'Cannot change plan_id' USING ERRCODE = '23514';
  END IF;
  IF NEW.installment_id IS DISTINCT FROM OLD.installment_id THEN
    RAISE EXCEPTION 'Cannot change installment_id' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_immutable ON public.payments;
CREATE TRIGGER payments_immutable
  BEFORE UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.payments_immutable_check();

-- api_keys: prevent changes to tenant_id
CREATE OR REPLACE FUNCTION public.api_keys_immutable_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Cannot change tenant_id' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS api_keys_immutable ON public.api_keys;
CREATE TRIGGER api_keys_immutable
  BEFORE UPDATE ON public.api_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.api_keys_immutable_check();

-- passkeys: prevent changes to user_id
CREATE OR REPLACE FUNCTION public.passkeys_immutable_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Cannot change user_id' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS passkeys_immutable ON public.passkeys;
CREATE TRIGGER passkeys_immutable
  BEFORE UPDATE ON public.passkeys
  FOR EACH ROW
  EXECUTE FUNCTION public.passkeys_immutable_check();

-- sessions: prevent changes to user_id
CREATE OR REPLACE FUNCTION public.sessions_immutable_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Cannot change user_id' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sessions_immutable ON public.sessions;
CREATE TRIGGER sessions_immutable
  BEFORE UPDATE ON public.sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.sessions_immutable_check();

-- ============================================================================
-- HELPER FUNCTIONS (SECURITY DEFINER with search_path protection)
-- ============================================================================

-- Check if user is owner of a specific tenant (avoids recursion)
CREATE OR REPLACE FUNCTION public.is_tenant_owner(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE tenant_id = p_tenant_id
    AND user_id = auth.uid()
    AND role = 'owner'
  );
END;
$$;

-- Revoke from all, grant only to authenticated
REVOKE ALL ON FUNCTION public.is_tenant_owner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_tenant_owner(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_owner(UUID) TO authenticated;

-- Check if user is member of a specific tenant
CREATE OR REPLACE FUNCTION public.is_tenant_member(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE tenant_id = p_tenant_id
    AND user_id = auth.uid()
  );
END;
$$;

-- Revoke from all, grant only to authenticated
REVOKE ALL ON FUNCTION public.is_tenant_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_tenant_member(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_member(UUID) TO authenticated;

-- Generate a unique slug from a business name (internal use only)
CREATE OR REPLACE FUNCTION public.generate_unique_slug(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_base_slug TEXT;
  v_slug TEXT;
  v_suffix INTEGER := 2;
BEGIN
  -- Normalize: lowercase first, then remove accents, then clean
  v_base_slug := lower(trim(COALESCE(p_name, '')));
  v_base_slug := extensions.unaccent(v_base_slug);
  -- Remove non-alphanumeric except spaces and hyphens
  v_base_slug := regexp_replace(v_base_slug, '[^a-z0-9\s-]', '', 'g');
  -- Replace spaces with hyphens
  v_base_slug := regexp_replace(v_base_slug, '\s+', '-', 'g');
  -- Collapse multiple hyphens
  v_base_slug := regexp_replace(v_base_slug, '-+', '-', 'g');
  -- Remove leading/trailing hyphens
  v_base_slug := regexp_replace(v_base_slug, '^-|-$', '', 'g');
  -- Limit length
  v_base_slug := left(v_base_slug, 50);
  
  -- If empty, use fallback
  IF v_base_slug = '' THEN
    v_base_slug := 'negocio';
  END IF;
  
  v_slug := v_base_slug;
  
  -- Find unique slug (suffix starts at 2)
  WHILE EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_slug) LOOP
    v_slug := v_base_slug || '-' || v_suffix;
    v_suffix := v_suffix + 1;
    IF v_suffix > 10000 THEN
      v_slug := v_base_slug || '-' || extract(epoch from now())::bigint;
      EXIT;
    END IF;
  END LOOP;
  
  RETURN v_slug;
END;
$$;

-- This is an internal function, revoke from everyone
REVOKE ALL ON FUNCTION public.generate_unique_slug(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_unique_slug(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.generate_unique_slug(TEXT) FROM authenticated;

-- ============================================================================
-- MAIN FUNCTION: Create tenant with owner (atomic, bypasses RLS)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_tenant_with_owner(
  p_name TEXT,
  p_full_name TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_email TEXT;
  v_slug TEXT;
  v_tenant_id UUID;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  
  -- Get user email from auth.users
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'User email not found' USING ERRCODE = 'P0001';
  END IF;
  
  -- Check if user is already an owner of any tenant
  IF EXISTS (SELECT 1 FROM public.tenant_users WHERE user_id = v_user_id AND role = 'owner') THEN
    RAISE EXCEPTION 'User is already an owner of a tenant' USING ERRCODE = '23505';
  END IF;
  
  -- Generate unique slug
  v_slug := public.generate_unique_slug(p_name);
  
  -- Upsert user profile
  INSERT INTO public.user_profiles (id, email, full_name)
  VALUES (v_user_id, v_email, p_full_name)
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, public.user_profiles.full_name),
    updated_at = NOW();
  
  -- Create tenant
  INSERT INTO public.tenants (name, slug, email)
  VALUES (p_name, v_slug, v_email)
  RETURNING id INTO v_tenant_id;
  
  -- Link user as owner
  INSERT INTO public.tenant_users (tenant_id, user_id, role)
  VALUES (v_tenant_id, v_user_id, 'owner');
  
  -- Return result
  RETURN json_build_object(
    'tenant_id', v_tenant_id,
    'slug', v_slug
  );
END;
$$;

-- Revoke from all, grant only to authenticated
REVOKE ALL ON FUNCTION public.create_tenant_with_owner(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_tenant_with_owner(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_tenant_with_owner(TEXT, TEXT) TO authenticated;

-- ============================================================================
-- FUNCTION: Register payment (secure, with validation and audit)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.register_payment(
  p_installment_id UUID,
  p_amount_cents INTEGER,
  p_penalty_paid_cents INTEGER DEFAULT 0,
  p_method TEXT DEFAULT NULL,
  p_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_plan_id UUID;
  v_tenant_id UUID;
  v_plan_status TEXT;
  v_installment_total INTEGER;
  v_installment_paid INTEGER;
  v_installment_number INTEGER;
  v_outstanding INTEGER;
  v_new_paid INTEGER;
  v_new_status TEXT;
  v_payment_id UUID;
  v_all_paid BOOLEAN;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = 'P0001';
  END IF;
  
  -- Validate input
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero' USING ERRCODE = 'P0002';
  END IF;
  
  IF p_penalty_paid_cents IS NULL THEN
    p_penalty_paid_cents := 0;
  END IF;
  
  IF p_penalty_paid_cents < 0 THEN
    RAISE EXCEPTION 'Los punitorios no pueden ser negativos' USING ERRCODE = 'P0002';
  END IF;
  
  -- Get installment and plan info
  SELECT 
    i.plan_id,
    i.total_cents,
    i.paid_cents,
    i.number,
    p.tenant_id,
    p.status
  INTO 
    v_plan_id,
    v_installment_total,
    v_installment_paid,
    v_installment_number,
    v_tenant_id,
    v_plan_status
  FROM public.installments i
  JOIN public.plans p ON p.id = i.plan_id
  WHERE i.id = p_installment_id;
  
  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'Cuota no encontrada' USING ERRCODE = 'P0003';
  END IF;
  
  -- Check tenant membership
  IF NOT public.is_tenant_member(v_tenant_id) THEN
    RAISE EXCEPTION 'No tenés acceso a este plan' USING ERRCODE = '42501';
  END IF;
  
  -- Check plan is active
  IF v_plan_status != 'active' THEN
    RAISE EXCEPTION 'Solo podés registrar pagos en planes activos' USING ERRCODE = 'P0004';
  END IF;
  
  -- Calculate outstanding and check for overpayment
  v_outstanding := v_installment_total - v_installment_paid;
  
  IF p_amount_cents > v_outstanding THEN
    RAISE EXCEPTION 'El pago de $% excede el saldo pendiente de $%', 
      (p_amount_cents / 100.0)::numeric(12,2),
      (v_outstanding / 100.0)::numeric(12,2)
    USING ERRCODE = 'P0005';
  END IF;
  
  -- Calculate new paid amount and status
  v_new_paid := v_installment_paid + p_amount_cents;
  IF v_new_paid >= v_installment_total THEN
    v_new_status := 'paid';
  ELSE
    v_new_status := 'partial';
  END IF;
  
  -- Insert payment record
  INSERT INTO public.payments (
    tenant_id,
    plan_id,
    installment_id,
    amount_cents,
    penalty_paid_cents,
    payment_method,
    reference,
    notes,
    recorded_by
  ) VALUES (
    v_tenant_id,
    v_plan_id,
    p_installment_id,
    p_amount_cents,
    p_penalty_paid_cents,
    p_method,
    p_reference,
    p_notes,
    v_user_id
  ) RETURNING id INTO v_payment_id;
  
  -- Update installment
  UPDATE public.installments
  SET 
    paid_cents = v_new_paid,
    penalty_cents = penalty_cents + p_penalty_paid_cents,
    status = v_new_status,
    updated_at = NOW()
  WHERE id = p_installment_id;
  
  -- Check if all installments are paid
  SELECT NOT EXISTS (
    SELECT 1 FROM public.installments
    WHERE plan_id = v_plan_id AND status != 'paid'
  ) INTO v_all_paid;
  
  -- Mark plan as completed if all paid
  IF v_all_paid THEN
    UPDATE public.plans
    SET status = 'completed', updated_at = NOW()
    WHERE id = v_plan_id;
  END IF;
  
  -- Write audit log
  INSERT INTO public.audit_log (
    tenant_id,
    user_id,
    action,
    entity_type,
    entity_id,
    new_data
  ) VALUES (
    v_tenant_id,
    v_user_id,
    'payment_recorded',
    'payment',
    v_payment_id,
    json_build_object(
      'installment_number', v_installment_number,
      'amount_cents', p_amount_cents,
      'penalty_paid_cents', p_penalty_paid_cents,
      'method', p_method,
      'plan_completed', v_all_paid
    )
  );
  
  -- Return result
  RETURN json_build_object(
    'payment_id', v_payment_id,
    'installment_status', v_new_status,
    'plan_completed', v_all_paid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_payment(UUID, INTEGER, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_payment(UUID, INTEGER, INTEGER, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_payment(UUID, INTEGER, INTEGER, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.register_payment(UUID, INTEGER, INTEGER, TEXT, TEXT, TEXT) IS 
'Registra un pago para una cuota. Valida que el plan esté activo, el usuario sea miembro del tenant, y no se exceda el saldo pendiente.
Argumentos:
  p_installment_id: ID de la cuota
  p_amount_cents: Monto del pago en centavos (requerido, > 0)
  p_penalty_paid_cents: Punitorios pagados en centavos (opcional, default 0)
  p_method: Método de pago (payment_method column, opcional)
  p_reference: Referencia/comprobante (opcional)
  p_notes: Notas adicionales (opcional)
Retorna JSON: { payment_id, installment_status, plan_completed }
Errores:
  P0001: No autenticado
  P0002: Parámetros inválidos
  P0003: Cuota no encontrada
  P0004: Plan no activo
  P0005: Sobrepago
  42501: Sin acceso al tenant';

-- ============================================================================
-- FUNCTION: Activate plan (secure, with audit)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.activate_plan(p_plan_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_tenant_id UUID;
  v_status TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = 'P0001';
  END IF;
  
  -- Get plan info
  SELECT tenant_id, status INTO v_tenant_id, v_status
  FROM public.plans WHERE id = p_plan_id;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Plan no encontrado' USING ERRCODE = 'P0003';
  END IF;
  
  IF NOT public.is_tenant_member(v_tenant_id) THEN
    RAISE EXCEPTION 'No tenés acceso a este plan' USING ERRCODE = '42501';
  END IF;
  
  IF v_status != 'draft' THEN
    RAISE EXCEPTION 'Solo podés activar planes en borrador' USING ERRCODE = 'P0004';
  END IF;
  
  -- Activate plan
  UPDATE public.plans
  SET status = 'active', activated_at = NOW(), updated_at = NOW()
  WHERE id = p_plan_id;
  
  -- Audit log
  INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id)
  VALUES (v_tenant_id, v_user_id, 'plan_activated', 'plan', p_plan_id);
  
  RETURN json_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.activate_plan(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_plan(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.activate_plan(UUID) TO authenticated;

-- ============================================================================
-- FUNCTION: Cancel plan (secure, with audit)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_plan(p_plan_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_tenant_id UUID;
  v_status TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = 'P0001';
  END IF;
  
  SELECT tenant_id, status INTO v_tenant_id, v_status
  FROM public.plans WHERE id = p_plan_id;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Plan no encontrado' USING ERRCODE = 'P0003';
  END IF;
  
  IF NOT public.is_tenant_member(v_tenant_id) THEN
    RAISE EXCEPTION 'No tenés acceso a este plan' USING ERRCODE = '42501';
  END IF;
  
  IF v_status NOT IN ('draft', 'active') THEN
    RAISE EXCEPTION 'No podés cancelar un plan en estado %', v_status USING ERRCODE = 'P0004';
  END IF;
  
  -- Cancel plan
  UPDATE public.plans
  SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
  WHERE id = p_plan_id;
  
  -- Audit log
  INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id)
  VALUES (v_tenant_id, v_user_id, 'plan_cancelled', 'plan', p_plan_id);
  
  RETURN json_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_plan(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_plan(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_plan(UUID) TO authenticated;

-- ============================================================================
-- FUNCTION: Edit installment (only draft plans, with audit)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.edit_installment(
  p_installment_id UUID,
  p_due_date DATE DEFAULT NULL,
  p_total_cents INTEGER DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_tenant_id UUID;
  v_plan_id UUID;
  v_plan_status TEXT;
  v_old_due_date DATE;
  v_old_total_cents INTEGER;
  v_new_plan_total INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = 'P0001';
  END IF;
  
  -- Get installment and plan info
  SELECT 
    i.plan_id,
    i.due_date,
    i.total_cents,
    p.tenant_id,
    p.status
  INTO 
    v_plan_id,
    v_old_due_date,
    v_old_total_cents,
    v_tenant_id,
    v_plan_status
  FROM public.installments i
  JOIN public.plans p ON p.id = i.plan_id
  WHERE i.id = p_installment_id;
  
  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'Cuota no encontrada' USING ERRCODE = 'P0003';
  END IF;
  
  IF NOT public.is_tenant_member(v_tenant_id) THEN
    RAISE EXCEPTION 'No tenés acceso a este plan' USING ERRCODE = '42501';
  END IF;
  
  IF v_plan_status != 'draft' THEN
    RAISE EXCEPTION 'Solo podés editar cuotas de planes en borrador' USING ERRCODE = 'P0004';
  END IF;
  
  -- Validate
  IF p_total_cents IS NOT NULL AND p_total_cents <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero' USING ERRCODE = 'P0002';
  END IF;
  
  -- Update installment
  UPDATE public.installments
  SET 
    due_date = COALESCE(p_due_date, due_date),
    total_cents = COALESCE(p_total_cents, total_cents),
    updated_at = NOW()
  WHERE id = p_installment_id;
  
  -- Recalculate plan total if amount changed
  IF p_total_cents IS NOT NULL THEN
    SELECT SUM(total_cents) INTO v_new_plan_total
    FROM public.installments WHERE plan_id = v_plan_id;
    
    UPDATE public.plans
    SET total_amount_cents = v_new_plan_total, updated_at = NOW()
    WHERE id = v_plan_id;
  END IF;
  
  -- Audit log
  INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id, old_data, new_data)
  VALUES (
    v_tenant_id,
    v_user_id,
    'installment_edited',
    'installment',
    p_installment_id,
    json_build_object('due_date', v_old_due_date, 'total_cents', v_old_total_cents),
    json_build_object('due_date', COALESCE(p_due_date, v_old_due_date), 'total_cents', COALESCE(p_total_cents, v_old_total_cents))
  );
  
  RETURN json_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.edit_installment(UUID, DATE, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.edit_installment(UUID, DATE, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.edit_installment(UUID, DATE, INTEGER) TO authenticated;

-- ============================================================================
-- FIX RECURSIVE/BROKEN RLS POLICIES
-- ============================================================================

-- Drop problematic policies
DROP POLICY IF EXISTS "Owners can manage tenant members" ON public.tenant_users;
DROP POLICY IF EXISTS "Owners can update their tenants" ON public.tenants;
DROP POLICY IF EXISTS "Owners can manage API keys" ON public.api_keys;

-- ============================================================================
-- TENANT_USERS: Fix recursive policy
-- Note: tenant_id and user_id cannot change (enforced by trigger)
-- ============================================================================

-- Users can view their own membership
CREATE POLICY "Users can view own tenant membership"
  ON public.tenant_users FOR SELECT
  USING (user_id = auth.uid());

-- Owners can view all members of their tenants (using helper to avoid recursion)
CREATE POLICY "Owners can view all tenant members"
  ON public.tenant_users FOR SELECT
  USING (public.is_tenant_owner(tenant_id));

-- Owners can insert new members (but not as owner - owners created via RPC only)
CREATE POLICY "Owners can insert tenant members"
  ON public.tenant_users FOR INSERT
  WITH CHECK (
    public.is_tenant_owner(tenant_id)
    AND role != 'owner'
  );

-- Owners can update members (not themselves, cannot promote to owner)
-- Full constraint in WITH CHECK since tenant_id/user_id are immutable via trigger
CREATE POLICY "Owners can update tenant members"
  ON public.tenant_users FOR UPDATE
  USING (public.is_tenant_owner(tenant_id) AND user_id != auth.uid())
  WITH CHECK (
    public.is_tenant_owner(tenant_id)
    AND user_id != auth.uid()
    AND role != 'owner'
  );

-- Owners can delete members (not themselves)
CREATE POLICY "Owners can delete tenant members"
  ON public.tenant_users FOR DELETE
  USING (public.is_tenant_owner(tenant_id) AND user_id != auth.uid());

-- ============================================================================
-- TENANTS: Fix UPDATE policy
-- ============================================================================

CREATE POLICY "Owners can update their tenants"
  ON public.tenants FOR UPDATE
  USING (public.is_tenant_owner(id))
  WITH CHECK (public.is_tenant_owner(id));

-- ============================================================================
-- API_KEYS: Fix recursive policy (tenant_id immutable via trigger)
-- ============================================================================

CREATE POLICY "Owners can manage API keys"
  ON public.api_keys FOR ALL
  USING (public.is_tenant_owner(tenant_id))
  WITH CHECK (public.is_tenant_owner(tenant_id));

-- ============================================================================
-- PORTFOLIOS: Ensure INSERT works (tenant_id immutable via trigger)
-- ============================================================================

DROP POLICY IF EXISTS "Users can manage portfolios" ON public.portfolios;

CREATE POLICY "Members can insert portfolios"
  ON public.portfolios FOR INSERT
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY "Members can update portfolios"
  ON public.portfolios FOR UPDATE
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY "Owners can delete portfolios"
  ON public.portfolios FOR DELETE
  USING (public.is_tenant_owner(tenant_id));

-- ============================================================================
-- CLIENTS: Ensure INSERT works (tenant_id immutable via trigger)
-- ============================================================================

DROP POLICY IF EXISTS "Users can manage clients" ON public.clients;

CREATE POLICY "Members can insert clients"
  ON public.clients FOR INSERT
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY "Members can update clients"
  ON public.clients FOR UPDATE
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY "Owners can delete clients"
  ON public.clients FOR DELETE
  USING (public.is_tenant_owner(tenant_id));

-- ============================================================================
-- PLANS: Ensure INSERT works (tenant_id, client_id immutable via trigger)
-- ============================================================================

DROP POLICY IF EXISTS "Users can manage plans" ON public.plans;

CREATE POLICY "Members can insert plans"
  ON public.plans FOR INSERT
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY "Members can update plans"
  ON public.plans FOR UPDATE
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY "Members can delete draft plans"
  ON public.plans FOR DELETE
  USING (public.is_tenant_member(tenant_id) AND status = 'draft');

-- ============================================================================
-- INSTALLMENTS: Fix INSERT/UPDATE/DELETE policies (plan_id immutable via trigger)
-- ============================================================================

DROP POLICY IF EXISTS "Users can insert installments" ON public.installments;
DROP POLICY IF EXISTS "Users can manage draft installments" ON public.installments;

-- Members can insert installments for their tenant's plans
CREATE POLICY "Members can insert installments"
  ON public.installments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.plans
    WHERE public.plans.id = installments.plan_id
    AND public.is_tenant_member(public.plans.tenant_id)
  ));

-- Members can update installments ONLY for draft plans
CREATE POLICY "Members can update draft installments"
  ON public.installments FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.plans
    WHERE public.plans.id = installments.plan_id
    AND public.is_tenant_member(public.plans.tenant_id)
    AND public.plans.status = 'draft'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.plans
    WHERE public.plans.id = installments.plan_id
    AND public.is_tenant_member(public.plans.tenant_id)
    AND public.plans.status = 'draft'
  ));

-- Members can delete installments from draft plans
CREATE POLICY "Members can delete draft installments"
  ON public.installments FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.plans
    WHERE public.plans.id = installments.plan_id
    AND public.is_tenant_member(public.plans.tenant_id)
    AND public.plans.status = 'draft'
  ));

-- ============================================================================
-- PAYMENTS: No direct client INSERT/UPDATE/DELETE - only via register_payment RPC
-- tenant_id, plan_id, installment_id all immutable via trigger
-- ============================================================================

DROP POLICY IF EXISTS "Users can insert payments" ON public.payments;
DROP POLICY IF EXISTS "Members can insert payments" ON public.payments;

-- SELECT only - viewing payments is allowed for tenant members
-- INSERT/UPDATE/DELETE only via register_payment RPC (SECURITY DEFINER bypasses RLS)

-- ============================================================================
-- AUDIT_LOG: Remove client INSERT policy - audit only via triggers/definer
-- ============================================================================

DROP POLICY IF EXISTS "System can insert audit log" ON public.audit_log;
DROP POLICY IF EXISTS "Authenticated users can insert audit log" ON public.audit_log;

-- No INSERT policy for clients - audit log written only by SECURITY DEFINER functions or triggers

-- ============================================================================
-- PASSKEYS: Explicit per-operation policies (user_id immutable via trigger)
-- ============================================================================

DROP POLICY IF EXISTS "Users can manage own passkeys" ON public.passkeys;

CREATE POLICY "Users can select own passkeys"
  ON public.passkeys FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own passkeys"
  ON public.passkeys FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own passkeys"
  ON public.passkeys FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own passkeys"
  ON public.passkeys FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================================
-- SESSIONS: Explicit per-operation policies (user_id immutable via trigger)
-- ============================================================================

DROP POLICY IF EXISTS "Users can manage own sessions" ON public.sessions;

CREATE POLICY "Users can select own sessions"
  ON public.sessions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own sessions"
  ON public.sessions FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own sessions"
  ON public.sessions FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own sessions"
  ON public.sessions FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================================
-- COMMENT: Document the create_tenant_with_owner function
-- ============================================================================

COMMENT ON FUNCTION public.create_tenant_with_owner(TEXT, TEXT) IS 
'Creates a new tenant and assigns the current user as owner.
Arguments:
  p_name: Business name (used to generate slug)
  p_full_name: User''s full name (updates user_profiles)
Returns JSON: { tenant_id: uuid, slug: text }
Errors:
  P0001: Not authenticated or email not found
  23505: User is already an owner of a tenant';
