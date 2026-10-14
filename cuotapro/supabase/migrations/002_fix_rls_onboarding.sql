-- Migration: Fix RLS policies for onboarding and tenant creation
-- Addresses:
--   - No INSERT policy on tenants (42501)
--   - Recursive policy on tenant_users (42P17)
--   - First owner cannot insert into tenant_users
--   - Prevent tenant hopping via UPDATE
--   - Secure payment recording via RPC only
--   - Audit log writes via RPC only
--   - Block status/total changes outside SECURITY DEFINER

-- ============================================================================
-- EXTENSIONS (in extensions schema for security)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- ============================================================================
-- FIX get_user_tenant_ids: add search_path and proper grants
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_tenant_ids()
RETURNS UUID[]
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(tenant_id), '{}')
  FROM public.tenant_users
  WHERE user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_user_tenant_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_tenant_ids() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_tenant_ids() TO authenticated;

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

-- plans: prevent changes to tenant_id, client_id, AND status/total outside SECURITY DEFINER
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
  -- Block status/total_amount_cents changes unless called from SECURITY DEFINER (current_setting returns null in definer)
  IF current_setting('rls.bypass_plan_check', true) IS DISTINCT FROM 'true' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Cannot change plan status directly; use activate_plan/cancel_plan RPC' USING ERRCODE = '23514';
    END IF;
    IF NEW.total_amount_cents IS DISTINCT FROM OLD.total_amount_cents THEN
      RAISE EXCEPTION 'Cannot change total_amount_cents directly; use edit_installment RPC' USING ERRCODE = '23514';
    END IF;
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

REVOKE ALL ON FUNCTION public.is_tenant_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_tenant_member(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_member(UUID) TO authenticated;

-- Generate a unique slug from a business name (internal use only)
-- Uses advisory lock to prevent race conditions
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
  v_lock_key BIGINT;
BEGIN
  -- Normalize: lowercase first, then remove accents, then clean
  v_base_slug := lower(trim(COALESCE(p_name, '')));
  v_base_slug := extensions.unaccent(v_base_slug);
  v_base_slug := regexp_replace(v_base_slug, '[^a-z0-9\s-]', '', 'g');
  v_base_slug := regexp_replace(v_base_slug, '\s+', '-', 'g');
  v_base_slug := regexp_replace(v_base_slug, '-+', '-', 'g');
  v_base_slug := regexp_replace(v_base_slug, '^-|-$', '', 'g');
  v_base_slug := left(v_base_slug, 50);
  
  IF v_base_slug = '' THEN
    v_base_slug := 'negocio';
  END IF;
  
  -- Use advisory lock to prevent race conditions on slug generation
  v_lock_key := hashtext(v_base_slug);
  PERFORM pg_advisory_xact_lock(v_lock_key);
  
  v_slug := v_base_slug;
  
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

REVOKE ALL ON FUNCTION public.generate_unique_slug(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_unique_slug(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.generate_unique_slug(TEXT) FROM authenticated;

-- ============================================================================
-- MAIN FUNCTION: Create tenant with owner (atomic, bypasses RLS)
-- Handles unique_violation with retry
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
  v_retries INTEGER := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'User email not found' USING ERRCODE = 'P0001';
  END IF;
  
  IF EXISTS (SELECT 1 FROM public.tenant_users WHERE user_id = v_user_id AND role = 'owner') THEN
    RAISE EXCEPTION 'User is already an owner of a tenant' USING ERRCODE = '23505';
  END IF;
  
  -- Retry loop for slug uniqueness race condition
  LOOP
    v_slug := public.generate_unique_slug(p_name);
    
    BEGIN
      INSERT INTO public.user_profiles (id, email, full_name)
      VALUES (v_user_id, v_email, p_full_name)
      ON CONFLICT (id) DO UPDATE SET
        full_name = COALESCE(EXCLUDED.full_name, public.user_profiles.full_name),
        updated_at = NOW();
      
      INSERT INTO public.tenants (name, slug, email)
      VALUES (p_name, v_slug, v_email)
      RETURNING id INTO v_tenant_id;
      
      INSERT INTO public.tenant_users (tenant_id, user_id, role)
      VALUES (v_tenant_id, v_user_id, 'owner');
      
      EXIT; -- Success, exit loop
    EXCEPTION
      WHEN unique_violation THEN
        v_retries := v_retries + 1;
        IF v_retries > 5 THEN
          RAISE EXCEPTION 'Failed to generate unique slug after % retries', v_retries;
        END IF;
        -- Continue loop to retry with new slug
    END;
  END LOOP;
  
  RETURN json_build_object(
    'tenant_id', v_tenant_id,
    'slug', v_slug
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_tenant_with_owner(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_tenant_with_owner(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_tenant_with_owner(TEXT, TEXT) TO authenticated;

-- ============================================================================
-- FUNCTION: Register payment (secure, with validation, locking, and audit)
-- Uses BIGINT for cents, proper enum type for status
-- ============================================================================

CREATE OR REPLACE FUNCTION public.register_payment(
  p_installment_id UUID,
  p_amount_cents BIGINT,
  p_penalty_paid_cents BIGINT DEFAULT 0,
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
  v_plan_status public.plan_status;
  v_installment_total BIGINT;
  v_installment_paid BIGINT;
  v_installment_number INTEGER;
  v_outstanding BIGINT;
  v_new_paid BIGINT;
  v_new_status public.payment_status;
  v_payment_id UUID;
  v_all_paid BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = 'P0001';
  END IF;
  
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero' USING ERRCODE = 'P0002';
  END IF;
  
  IF p_penalty_paid_cents IS NULL THEN
    p_penalty_paid_cents := 0;
  END IF;
  
  IF p_penalty_paid_cents < 0 THEN
    RAISE EXCEPTION 'Los punitorios no pueden ser negativos' USING ERRCODE = 'P0002';
  END IF;
  
  -- Lock plan and installment rows to prevent concurrent modifications
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
  WHERE i.id = p_installment_id
  FOR UPDATE OF i, p;
  
  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'Cuota no encontrada' USING ERRCODE = 'P0003';
  END IF;
  
  IF NOT public.is_tenant_member(v_tenant_id) THEN
    RAISE EXCEPTION 'No tenés acceso a este plan' USING ERRCODE = '42501';
  END IF;
  
  IF v_plan_status != 'active' THEN
    RAISE EXCEPTION 'Solo podés registrar pagos en planes activos' USING ERRCODE = 'P0004';
  END IF;
  
  v_outstanding := v_installment_total - v_installment_paid;
  
  IF p_amount_cents > v_outstanding THEN
    RAISE EXCEPTION 'El pago de $% excede el saldo pendiente de $%', 
      (p_amount_cents / 100.0)::numeric(12,2),
      (v_outstanding / 100.0)::numeric(12,2)
    USING ERRCODE = 'P0005';
  END IF;
  
  v_new_paid := v_installment_paid + p_amount_cents;
  IF v_new_paid >= v_installment_total THEN
    v_new_status := 'paid'::public.payment_status;
  ELSE
    v_new_status := 'partial'::public.payment_status;
  END IF;
  
  -- Insert payment record (penalty_paid_cents stored in payment, NOT added to installment)
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
  
  -- Update installment (paid_cents only, penalty tracked in payment record)
  UPDATE public.installments
  SET 
    paid_cents = v_new_paid,
    status = v_new_status,
    updated_at = NOW()
  WHERE id = p_installment_id;
  
  -- Check if all installments are paid
  SELECT NOT EXISTS (
    SELECT 1 FROM public.installments
    WHERE plan_id = v_plan_id AND status != 'paid'
  ) INTO v_all_paid;
  
  -- Mark plan as completed if all paid (bypass trigger check)
  IF v_all_paid THEN
    PERFORM set_config('rls.bypass_plan_check', 'true', true);
    UPDATE public.plans
    SET status = 'completed', updated_at = NOW()
    WHERE id = v_plan_id;
    PERFORM set_config('rls.bypass_plan_check', '', true);
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
  
  RETURN json_build_object(
    'payment_id', v_payment_id,
    'installment_status', v_new_status::text,
    'plan_completed', v_all_paid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_payment(UUID, BIGINT, BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_payment(UUID, BIGINT, BIGINT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_payment(UUID, BIGINT, BIGINT, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.register_payment(UUID, BIGINT, BIGINT, TEXT, TEXT, TEXT) IS 
'Registra un pago para una cuota. Valida plan activo, tenant membership, y saldo.
Argumentos:
  p_installment_id: ID de la cuota
  p_amount_cents: Monto del pago en centavos (BIGINT, > 0)
  p_penalty_paid_cents: Punitorios pagados (BIGINT, default 0, registrado en payment)
  p_method: Método de pago (opcional)
  p_reference: Referencia/comprobante (opcional)
  p_notes: Notas adicionales (opcional)
Retorna JSON: { payment_id, installment_status, plan_completed }';

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
  v_status public.plan_status;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = 'P0001';
  END IF;
  
  SELECT tenant_id, status INTO v_tenant_id, v_status
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
  
  -- Bypass trigger check for status change
  PERFORM set_config('rls.bypass_plan_check', 'true', true);
  UPDATE public.plans
  SET status = 'active', activated_at = NOW(), updated_at = NOW()
  WHERE id = p_plan_id;
  PERFORM set_config('rls.bypass_plan_check', '', true);
  
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
  v_status public.plan_status;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = 'P0001';
  END IF;
  
  SELECT tenant_id, status INTO v_tenant_id, v_status
  FROM public.plans WHERE id = p_plan_id
  FOR UPDATE;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Plan no encontrado' USING ERRCODE = 'P0003';
  END IF;
  
  IF NOT public.is_tenant_member(v_tenant_id) THEN
    RAISE EXCEPTION 'No tenés acceso a este plan' USING ERRCODE = '42501';
  END IF;
  
  IF v_status NOT IN ('draft', 'active') THEN
    RAISE EXCEPTION 'No podés cancelar un plan en estado %', v_status USING ERRCODE = 'P0004';
  END IF;
  
  PERFORM set_config('rls.bypass_plan_check', 'true', true);
  UPDATE public.plans
  SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
  WHERE id = p_plan_id;
  PERFORM set_config('rls.bypass_plan_check', '', true);
  
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
  p_total_cents BIGINT DEFAULT NULL
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
  v_plan_status public.plan_status;
  v_old_due_date DATE;
  v_old_total_cents BIGINT;
  v_new_plan_total BIGINT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = 'P0001';
  END IF;
  
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
  WHERE i.id = p_installment_id
  FOR UPDATE OF i, p;
  
  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'Cuota no encontrada' USING ERRCODE = 'P0003';
  END IF;
  
  IF NOT public.is_tenant_member(v_tenant_id) THEN
    RAISE EXCEPTION 'No tenés acceso a este plan' USING ERRCODE = '42501';
  END IF;
  
  IF v_plan_status != 'draft' THEN
    RAISE EXCEPTION 'Solo podés editar cuotas de planes en borrador' USING ERRCODE = 'P0004';
  END IF;
  
  IF p_total_cents IS NOT NULL AND p_total_cents <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero' USING ERRCODE = 'P0002';
  END IF;
  
  UPDATE public.installments
  SET 
    due_date = COALESCE(p_due_date, due_date),
    total_cents = COALESCE(p_total_cents, total_cents),
    updated_at = NOW()
  WHERE id = p_installment_id;
  
  IF p_total_cents IS NOT NULL THEN
    SELECT SUM(total_cents) INTO v_new_plan_total
    FROM public.installments WHERE plan_id = v_plan_id;
    
    PERFORM set_config('rls.bypass_plan_check', 'true', true);
    UPDATE public.plans
    SET total_amount_cents = v_new_plan_total, updated_at = NOW()
    WHERE id = v_plan_id;
    PERFORM set_config('rls.bypass_plan_check', '', true);
  END IF;
  
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

REVOKE ALL ON FUNCTION public.edit_installment(UUID, DATE, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.edit_installment(UUID, DATE, BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.edit_installment(UUID, DATE, BIGINT) TO authenticated;

-- ============================================================================
-- FIX RECURSIVE/BROKEN RLS POLICIES
-- Use DROP POLICY IF EXISTS before each CREATE for re-runnability
-- ============================================================================

DROP POLICY IF EXISTS "Owners can manage tenant members" ON public.tenant_users;
DROP POLICY IF EXISTS "Owners can update their tenants" ON public.tenants;
DROP POLICY IF EXISTS "Owners can manage API keys" ON public.api_keys;
DROP POLICY IF EXISTS "Users can view own tenant membership" ON public.tenant_users;
DROP POLICY IF EXISTS "Owners can view all tenant members" ON public.tenant_users;
DROP POLICY IF EXISTS "Owners can insert tenant members" ON public.tenant_users;
DROP POLICY IF EXISTS "Owners can update tenant members" ON public.tenant_users;
DROP POLICY IF EXISTS "Owners can delete tenant members" ON public.tenant_users;

-- ============================================================================
-- TENANT_USERS: Fix recursive policy
-- ============================================================================

CREATE POLICY "Users can view own tenant membership"
  ON public.tenant_users FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Owners can view all tenant members"
  ON public.tenant_users FOR SELECT
  USING (public.is_tenant_owner(tenant_id));

CREATE POLICY "Owners can insert tenant members"
  ON public.tenant_users FOR INSERT
  WITH CHECK (
    public.is_tenant_owner(tenant_id)
    AND role != 'owner'
  );

CREATE POLICY "Owners can update tenant members"
  ON public.tenant_users FOR UPDATE
  USING (public.is_tenant_owner(tenant_id) AND user_id != auth.uid())
  WITH CHECK (
    public.is_tenant_owner(tenant_id)
    AND user_id != auth.uid()
    AND role != 'owner'
  );

CREATE POLICY "Owners can delete tenant members"
  ON public.tenant_users FOR DELETE
  USING (public.is_tenant_owner(tenant_id) AND user_id != auth.uid());

-- ============================================================================
-- TENANTS: Fix UPDATE policy
-- ============================================================================

DROP POLICY IF EXISTS "Owners can update their tenants v2" ON public.tenants;
CREATE POLICY "Owners can update their tenants v2"
  ON public.tenants FOR UPDATE
  USING (public.is_tenant_owner(id))
  WITH CHECK (public.is_tenant_owner(id));

-- ============================================================================
-- API_KEYS: Fix recursive policy
-- ============================================================================

DROP POLICY IF EXISTS "Owners can manage API keys v2" ON public.api_keys;
CREATE POLICY "Owners can manage API keys v2"
  ON public.api_keys FOR ALL
  USING (public.is_tenant_owner(tenant_id))
  WITH CHECK (public.is_tenant_owner(tenant_id));

-- ============================================================================
-- PORTFOLIOS: Ensure INSERT works
-- ============================================================================

DROP POLICY IF EXISTS "Users can manage portfolios" ON public.portfolios;
DROP POLICY IF EXISTS "Members can insert portfolios" ON public.portfolios;
DROP POLICY IF EXISTS "Members can update portfolios" ON public.portfolios;
DROP POLICY IF EXISTS "Owners can delete portfolios" ON public.portfolios;

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
-- CLIENTS: Ensure INSERT works
-- ============================================================================

DROP POLICY IF EXISTS "Users can manage clients" ON public.clients;
DROP POLICY IF EXISTS "Members can insert clients" ON public.clients;
DROP POLICY IF EXISTS "Members can update clients" ON public.clients;
DROP POLICY IF EXISTS "Owners can delete clients" ON public.clients;

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
-- PLANS: INSERT and limited UPDATE (status/total blocked by trigger)
-- ============================================================================

DROP POLICY IF EXISTS "Users can manage plans" ON public.plans;
DROP POLICY IF EXISTS "Members can insert plans" ON public.plans;
DROP POLICY IF EXISTS "Members can update plans" ON public.plans;
DROP POLICY IF EXISTS "Members can delete draft plans" ON public.plans;
DROP POLICY IF EXISTS "Members can update draft plans" ON public.plans;

CREATE POLICY "Members can insert plans"
  ON public.plans FOR INSERT
  WITH CHECK (public.is_tenant_member(tenant_id));

-- Allow update only on draft plans for non-critical fields (status/total blocked by trigger)
CREATE POLICY "Members can update draft plans"
  ON public.plans FOR UPDATE
  USING (public.is_tenant_member(tenant_id) AND status = 'draft')
  WITH CHECK (public.is_tenant_member(tenant_id) AND status = 'draft');

CREATE POLICY "Members can delete draft plans"
  ON public.plans FOR DELETE
  USING (public.is_tenant_member(tenant_id) AND status = 'draft');

-- ============================================================================
-- INSTALLMENTS: INSERT requires draft plan, pending status, paid_cents=0
-- ============================================================================

DROP POLICY IF EXISTS "Users can insert installments" ON public.installments;
DROP POLICY IF EXISTS "Users can manage draft installments" ON public.installments;
DROP POLICY IF EXISTS "Members can insert installments" ON public.installments;
DROP POLICY IF EXISTS "Members can update draft installments" ON public.installments;
DROP POLICY IF EXISTS "Members can delete draft installments" ON public.installments;

-- INSERT: plan must be draft, new installment must be pending with paid_cents=0
CREATE POLICY "Members can insert installments"
  ON public.installments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE public.plans.id = installments.plan_id
      AND public.is_tenant_member(public.plans.tenant_id)
      AND public.plans.status = 'draft'
    )
    AND status = 'pending'
    AND paid_cents = 0
  );

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

CREATE POLICY "Members can delete draft installments"
  ON public.installments FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.plans
    WHERE public.plans.id = installments.plan_id
    AND public.is_tenant_member(public.plans.tenant_id)
    AND public.plans.status = 'draft'
  ));

-- ============================================================================
-- PAYMENTS: No direct INSERT/UPDATE/DELETE - only via register_payment RPC
-- ============================================================================

DROP POLICY IF EXISTS "Users can insert payments" ON public.payments;
DROP POLICY IF EXISTS "Members can insert payments" ON public.payments;

-- ============================================================================
-- AUDIT_LOG: Remove client INSERT policy
-- ============================================================================

DROP POLICY IF EXISTS "System can insert audit log" ON public.audit_log;
DROP POLICY IF EXISTS "Authenticated users can insert audit log" ON public.audit_log;

-- ============================================================================
-- PASSKEYS: Explicit per-operation policies
-- ============================================================================

DROP POLICY IF EXISTS "Users can manage own passkeys" ON public.passkeys;
DROP POLICY IF EXISTS "Users can select own passkeys" ON public.passkeys;
DROP POLICY IF EXISTS "Users can insert own passkeys" ON public.passkeys;
DROP POLICY IF EXISTS "Users can update own passkeys" ON public.passkeys;
DROP POLICY IF EXISTS "Users can delete own passkeys" ON public.passkeys;

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
-- SESSIONS: Explicit per-operation policies
-- ============================================================================

DROP POLICY IF EXISTS "Users can manage own sessions" ON public.sessions;
DROP POLICY IF EXISTS "Users can select own sessions" ON public.sessions;
DROP POLICY IF EXISTS "Users can insert own sessions" ON public.sessions;
DROP POLICY IF EXISTS "Users can update own sessions" ON public.sessions;
DROP POLICY IF EXISTS "Users can delete own sessions" ON public.sessions;

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
-- COMMENTS
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
