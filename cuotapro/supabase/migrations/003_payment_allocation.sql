-- Migration: Payment allocation tracking and penalty calculation
-- Adds columns to track how each payment is allocated (penalty, interest, fee, principal)
-- Updates register_payment to use proper allocation order

-- ============================================================================
-- ADD PAYMENT ALLOCATION COLUMNS
-- ============================================================================

ALTER TABLE public.payments 
  ADD COLUMN IF NOT EXISTS interest_applied_cents BIGINT NOT NULL DEFAULT 0 CHECK (interest_applied_cents >= 0),
  ADD COLUMN IF NOT EXISTS admin_fee_applied_cents BIGINT NOT NULL DEFAULT 0 CHECK (admin_fee_applied_cents >= 0),
  ADD COLUMN IF NOT EXISTS principal_applied_cents BIGINT NOT NULL DEFAULT 0 CHECK (principal_applied_cents >= 0);

-- Rename existing penalty column for clarity
ALTER TABLE public.payments 
  RENAME COLUMN penalty_paid_cents TO penalty_applied_cents;

COMMENT ON COLUMN public.payments.penalty_applied_cents IS 'Amount of payment applied to penalty (punitorios)';
COMMENT ON COLUMN public.payments.interest_applied_cents IS 'Amount of payment applied to interest (intereses)';
COMMENT ON COLUMN public.payments.admin_fee_applied_cents IS 'Amount of payment applied to admin fee (cargo administrativo)';
COMMENT ON COLUMN public.payments.principal_applied_cents IS 'Amount of payment applied to principal (capital)';

-- ============================================================================
-- ADD INSTALLMENT BREAKDOWN COLUMNS (for tracking what's paid vs outstanding)
-- ============================================================================

ALTER TABLE public.installments
  ADD COLUMN IF NOT EXISTS interest_paid_cents BIGINT NOT NULL DEFAULT 0 CHECK (interest_paid_cents >= 0),
  ADD COLUMN IF NOT EXISTS admin_fee_paid_cents BIGINT NOT NULL DEFAULT 0 CHECK (admin_fee_paid_cents >= 0),
  ADD COLUMN IF NOT EXISTS principal_paid_cents BIGINT NOT NULL DEFAULT 0 CHECK (principal_paid_cents >= 0),
  ADD COLUMN IF NOT EXISTS penalty_paid_cents BIGINT NOT NULL DEFAULT 0 CHECK (penalty_paid_cents >= 0);

COMMENT ON COLUMN public.installments.interest_paid_cents IS 'Total interest paid so far';
COMMENT ON COLUMN public.installments.admin_fee_paid_cents IS 'Total admin fee paid so far';
COMMENT ON COLUMN public.installments.principal_paid_cents IS 'Total principal paid so far';
COMMENT ON COLUMN public.installments.penalty_paid_cents IS 'Total penalty paid so far';

-- ============================================================================
-- FUNCTION: Calculate penalty with ROUND_HALF_UP (server is source of truth)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_penalty(
  p_outstanding_cents BIGINT,
  p_due_date DATE,
  p_current_date DATE DEFAULT CURRENT_DATE,
  p_grace_days INTEGER DEFAULT 5,
  p_daily_rate NUMERIC DEFAULT 0.001,
  p_cap NUMERIC DEFAULT 0.30
)
RETURNS BIGINT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_days_overdue INTEGER;
  v_penalty NUMERIC;
  v_max_penalty NUMERIC;
BEGIN
  v_days_overdue := (p_current_date - p_due_date) - p_grace_days;
  
  IF v_days_overdue <= 0 THEN
    RETURN 0;
  END IF;
  
  v_penalty := p_outstanding_cents * p_daily_rate * v_days_overdue;
  v_max_penalty := p_outstanding_cents * p_cap;
  
  -- ROUND_HALF_UP to centavo
  RETURN ROUND(LEAST(v_penalty, v_max_penalty));
END;
$$;

COMMENT ON FUNCTION public.calculate_penalty(BIGINT, DATE, DATE, INTEGER, NUMERIC, NUMERIC) IS 
'Calculates penalty using ROUND_HALF_UP. Server is source of truth for penalty calculations.';

-- ============================================================================
-- UPDATE: register_payment with proper allocation order
-- Allocation order: 1) Penalty, 2) Interest, 3) Admin fee, 4) Principal
-- ============================================================================

-- Drop old function first to allow parameter name change
DROP FUNCTION IF EXISTS public.register_payment(UUID, BIGINT, BIGINT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.register_payment(
  p_installment_id UUID,
  p_amount_cents BIGINT,
  p_penalty_cents BIGINT DEFAULT 0,
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
  v_installment_number INTEGER;
  
  -- Installment amounts
  v_principal_cents BIGINT;
  v_interest_cents BIGINT;
  v_admin_fee_cents BIGINT;
  v_total_cents BIGINT;
  v_penalty_cents_calc BIGINT;
  v_due_date DATE;
  
  -- Already paid
  v_principal_paid BIGINT;
  v_interest_paid BIGINT;
  v_admin_fee_paid BIGINT;
  v_penalty_paid BIGINT;
  v_paid_cents BIGINT;
  
  -- Outstanding amounts
  v_outstanding_penalty BIGINT;
  v_outstanding_interest BIGINT;
  v_outstanding_admin_fee BIGINT;
  v_outstanding_principal BIGINT;
  v_outstanding_total BIGINT;
  
  -- Allocation results
  v_apply_penalty BIGINT := 0;
  v_apply_interest BIGINT := 0;
  v_apply_admin_fee BIGINT := 0;
  v_apply_principal BIGINT := 0;
  v_remaining BIGINT;
  
  -- Final state
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
  
  IF p_penalty_cents IS NULL THEN
    p_penalty_cents := 0;
  END IF;
  
  IF p_penalty_cents < 0 THEN
    RAISE EXCEPTION 'Los punitorios no pueden ser negativos' USING ERRCODE = 'P0002';
  END IF;
  
  -- Lock and fetch installment + plan data
  SELECT 
    i.plan_id,
    i.number,
    i.principal_cents,
    i.interest_cents,
    i.admin_fee_cents,
    i.total_cents,
    i.penalty_cents,
    i.due_date,
    i.principal_paid_cents,
    i.interest_paid_cents,
    i.admin_fee_paid_cents,
    i.penalty_paid_cents,
    i.paid_cents,
    p.tenant_id,
    p.status
  INTO 
    v_plan_id,
    v_installment_number,
    v_principal_cents,
    v_interest_cents,
    v_admin_fee_cents,
    v_total_cents,
    v_penalty_cents_calc,
    v_due_date,
    v_principal_paid,
    v_interest_paid,
    v_admin_fee_paid,
    v_penalty_paid,
    v_paid_cents,
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
  
  -- Calculate current penalty if overdue (server is source of truth)
  IF v_due_date < CURRENT_DATE THEN
    v_penalty_cents_calc := public.calculate_penalty(
      v_total_cents - v_paid_cents,
      v_due_date,
      CURRENT_DATE
    );
    
    -- Update installment penalty if changed
    IF v_penalty_cents_calc != v_penalty_cents_calc THEN
      UPDATE public.installments 
      SET penalty_cents = v_penalty_cents_calc 
      WHERE id = p_installment_id;
    END IF;
  ELSE
    v_penalty_cents_calc := 0;
  END IF;
  
  -- Calculate outstanding amounts
  v_outstanding_penalty := GREATEST(0, v_penalty_cents_calc - v_penalty_paid);
  v_outstanding_interest := GREATEST(0, v_interest_cents - v_interest_paid);
  v_outstanding_admin_fee := GREATEST(0, v_admin_fee_cents - v_admin_fee_paid);
  v_outstanding_principal := GREATEST(0, v_principal_cents - v_principal_paid);
  v_outstanding_total := v_outstanding_penalty + v_outstanding_interest + v_outstanding_admin_fee + v_outstanding_principal;
  
  -- Include any explicitly passed penalty amount
  IF p_penalty_cents > 0 THEN
    v_outstanding_penalty := GREATEST(v_outstanding_penalty, p_penalty_cents);
  END IF;
  
  IF p_amount_cents > v_outstanding_total THEN
    RAISE EXCEPTION 'El pago de $% excede el saldo pendiente de $%', 
      (p_amount_cents / 100.0)::numeric(12,2),
      (v_outstanding_total / 100.0)::numeric(12,2)
    USING ERRCODE = 'P0005';
  END IF;
  
  -- Allocate payment in order: penalty, interest, admin_fee, principal
  v_remaining := p_amount_cents;
  
  -- 1. Penalty
  v_apply_penalty := LEAST(v_remaining, v_outstanding_penalty);
  v_remaining := v_remaining - v_apply_penalty;
  
  -- 2. Interest
  v_apply_interest := LEAST(v_remaining, v_outstanding_interest);
  v_remaining := v_remaining - v_apply_interest;
  
  -- 3. Admin fee
  v_apply_admin_fee := LEAST(v_remaining, v_outstanding_admin_fee);
  v_remaining := v_remaining - v_apply_admin_fee;
  
  -- 4. Principal
  v_apply_principal := LEAST(v_remaining, v_outstanding_principal);
  v_remaining := v_remaining - v_apply_principal;
  
  -- Determine new status based on total paid vs total (maintains backward compatibility)
  -- The allocation breakdown is tracked for audit purposes but status is based on total
  IF (v_paid_cents + p_amount_cents) >= v_total_cents THEN
    v_new_status := 'paid'::public.payment_status;
  ELSE
    v_new_status := 'partial'::public.payment_status;
  END IF;
  
  -- Insert payment record with allocation breakdown
  INSERT INTO public.payments (
    tenant_id,
    plan_id,
    installment_id,
    amount_cents,
    penalty_applied_cents,
    interest_applied_cents,
    admin_fee_applied_cents,
    principal_applied_cents,
    payment_method,
    reference,
    notes,
    recorded_by
  ) VALUES (
    v_tenant_id,
    v_plan_id,
    p_installment_id,
    p_amount_cents,
    v_apply_penalty,
    v_apply_interest,
    v_apply_admin_fee,
    v_apply_principal,
    p_method,
    p_reference,
    p_notes,
    v_user_id
  ) RETURNING id INTO v_payment_id;
  
  -- Update installment with new paid amounts
  UPDATE public.installments
  SET 
    paid_cents = paid_cents + p_amount_cents,
    principal_paid_cents = principal_paid_cents + v_apply_principal,
    interest_paid_cents = interest_paid_cents + v_apply_interest,
    admin_fee_paid_cents = admin_fee_paid_cents + v_apply_admin_fee,
    penalty_paid_cents = penalty_paid_cents + v_apply_penalty,
    status = v_new_status,
    updated_at = NOW()
  WHERE id = p_installment_id;
  
  -- Check if all installments are paid
  SELECT NOT EXISTS (
    SELECT 1 FROM public.installments
    WHERE plan_id = v_plan_id AND status != 'paid'
  ) INTO v_all_paid;
  
  IF v_all_paid THEN
    UPDATE public.plans
    SET status = 'completed', updated_at = NOW()
    WHERE id = v_plan_id;
  END IF;
  
  -- Audit log
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
      'allocation', json_build_object(
        'penalty', v_apply_penalty,
        'interest', v_apply_interest,
        'admin_fee', v_apply_admin_fee,
        'principal', v_apply_principal
      ),
      'method', p_method,
      'plan_completed', v_all_paid
    )
  );
  
  RETURN json_build_object(
    'payment_id', v_payment_id,
    'installment_status', v_new_status::text,
    'allocation', json_build_object(
      'penalty_applied_cents', v_apply_penalty,
      'interest_applied_cents', v_apply_interest,
      'admin_fee_applied_cents', v_apply_admin_fee,
      'principal_applied_cents', v_apply_principal
    ),
    'plan_completed', v_all_paid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_payment(UUID, BIGINT, BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_payment(UUID, BIGINT, BIGINT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_payment(UUID, BIGINT, BIGINT, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.register_payment(UUID, BIGINT, BIGINT, TEXT, TEXT, TEXT) IS 
'Registra un pago con imputación en orden: punitorio, interés, cargo, capital. El servidor es fuente de verdad para punitorios.';
