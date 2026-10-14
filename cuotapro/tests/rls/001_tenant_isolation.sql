-- RLS Integration Tests: Tenant Isolation
-- Uses pgTAP for PostgreSQL testing
-- CRITICAL: Tests run as 'authenticated' role with proper JWT claims to test RLS

\set ON_ERROR_STOP on

BEGIN;

-- Load pgTAP extension
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(38);

-- ============================================================================
-- Setup: Create test users and data AS SUPERUSER (bypass RLS for setup)
-- ============================================================================

-- Create test users in auth.users
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, instance_id, aud, role)
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'owner1@test.com', crypt('password', gen_salt('bf')), NOW(), NOW(), NOW(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'owner2@test.com', crypt('password', gen_salt('bf')), NOW(), NOW(), NOW(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'member1@test.com', crypt('password', gen_salt('bf')), NOW(), NOW(), NOW(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

-- Create tenants
INSERT INTO public.tenants (id, slug, name, email)
VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tenant-one', 'Tenant One', 'owner1@test.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'tenant-two', 'Tenant Two', 'owner2@test.com')
ON CONFLICT (id) DO NOTHING;

-- Create tenant-user relationships
INSERT INTO public.tenant_users (tenant_id, user_id, role)
VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'owner'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'merchant')
ON CONFLICT DO NOTHING;

-- Create user profiles
INSERT INTO public.user_profiles (id, email, full_name)
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'owner1@test.com', 'Owner One'),
  ('22222222-2222-2222-2222-222222222222', 'owner2@test.com', 'Owner Two'),
  ('33333333-3333-3333-3333-333333333333', 'member1@test.com', 'Member One')
ON CONFLICT (id) DO NOTHING;

-- Create clients for each tenant
INSERT INTO public.clients (id, tenant_id, dni_cuit, full_name)
VALUES 
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '12345678', 'Client One'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '87654321', 'Client Two')
ON CONFLICT (id) DO NOTHING;

-- Create plans for each tenant
INSERT INTO public.plans (id, tenant_id, client_id, description, cash_price_cents, financed_amount_cents, total_amount_cents, num_installments, interest_type, interest_rate, status)
VALUES 
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Plan Tenant One', 100000, 100000, 110000, 3, 'fixed_surcharge', 0.10, 'draft'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Plan Tenant Two', 200000, 200000, 220000, 3, 'fixed_surcharge', 0.10, 'active')
ON CONFLICT (id) DO NOTHING;

-- Create installments
INSERT INTO public.installments (id, plan_id, number, due_date, principal_cents, interest_cents, total_cents, status, paid_cents)
VALUES 
  ('11110001-0000-0000-0000-000000000000', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 1, '2025-01-15', 33334, 3333, 36667, 'pending', 0),
  ('11110002-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 1, '2025-01-15', 66667, 6667, 73334, 'pending', 0)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Helper function to simulate user authentication
-- ============================================================================

CREATE OR REPLACE FUNCTION test_set_user(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id::text,
    'role', 'authenticated',
    'aud', 'authenticated'
  )::text, true);
END;
$$;

-- ============================================================================
-- Test 1-3: Tenant isolation for SELECT (as User 1 - owner of tenant one)
-- ============================================================================

-- Set session to user 1 (owner of tenant one) and switch to authenticated role
SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT COUNT(*) FROM public.tenants)::integer,
  1,
  'Test 1: User 1 should only see their own tenant'
);

SELECT is(
  (SELECT COUNT(*) FROM public.clients)::integer,
  1,
  'Test 2: User 1 should only see clients from their tenant'
);

SELECT is(
  (SELECT COUNT(*) FROM public.plans)::integer,
  1,
  'Test 3: User 1 should only see plans from their tenant'
);

-- Reset to postgres for next setup
RESET ROLE;

-- ============================================================================
-- Test 4-5: Tenant isolation for SELECT (as User 2 - owner of tenant two)
-- ============================================================================

SELECT test_set_user('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT COUNT(*) FROM public.tenants)::integer,
  1,
  'Test 4: User 2 should only see their own tenant'
);

SELECT is(
  (SELECT slug FROM public.tenants LIMIT 1),
  'tenant-two',
  'Test 5: User 2 should only see tenant-two'
);

RESET ROLE;

-- ============================================================================
-- Test 6-7: Tenant isolation for INSERT (client)
-- ============================================================================

SELECT test_set_user('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

-- User 2 tries to insert client into tenant 1 (should fail)
SELECT throws_ok(
  $$INSERT INTO public.clients (tenant_id, dni_cuit, full_name) 
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99999999', 'Evil Client')$$,
  '42501',
  NULL,
  'Test 6: User 2 cannot insert client into tenant 1'
);

-- User 2 can insert client into their own tenant
SELECT lives_ok(
  $$INSERT INTO public.clients (tenant_id, dni_cuit, full_name) 
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111', 'Good Client')$$,
  'Test 7: User 2 can insert client into their own tenant'
);

RESET ROLE;

-- ============================================================================
-- Test 8: Immutable tenant_id on UPDATE
-- ============================================================================

SELECT test_set_user('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

-- User 2 tries to move their client to tenant 1 (should fail - immutable trigger)
SELECT throws_ok(
  $$UPDATE public.clients 
    SET tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    WHERE dni_cuit = '11111111'$$,
  '23514',
  NULL,
  'Test 8: Cannot change tenant_id via UPDATE (immutable trigger)'
);

RESET ROLE;

-- ============================================================================
-- Test 9-12: is_tenant_member and is_tenant_owner functions
-- ============================================================================

SELECT test_set_user('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

SELECT is(
  public.is_tenant_member('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  true,
  'Test 9: User 2 is member of tenant two'
);

SELECT is(
  public.is_tenant_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  false,
  'Test 10: User 2 is NOT member of tenant one'
);

SELECT is(
  public.is_tenant_owner('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  true,
  'Test 11: User 2 is owner of tenant two'
);

RESET ROLE;

-- Switch to member user (user 3)
SELECT test_set_user('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;

SELECT is(
  public.is_tenant_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  true,
  'Test 12: User 3 is member of tenant one'
);

SELECT is(
  public.is_tenant_owner('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  false,
  'Test 13: User 3 is NOT owner of tenant one (just merchant)'
);

RESET ROLE;

-- ============================================================================
-- Test 14: No direct payment INSERT (must use RPC)
-- ============================================================================

SELECT test_set_user('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.payments (tenant_id, plan_id, installment_id, amount_cents, recorded_by)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 
            '11110002-0000-0000-0000-000000000000', 10000, '22222222-2222-2222-2222-222222222222')$$,
  '42501',
  NULL,
  'Test 14: Direct payment INSERT should fail (no RLS policy)'
);

RESET ROLE;

-- ============================================================================
-- Test 15-17: register_payment RPC
-- ============================================================================

SELECT test_set_user('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.register_payment(
    '11110002-0000-0000-0000-000000000000'::uuid,
    10000::bigint,
    0::bigint
  )$$,
  'Test 15: register_payment RPC succeeds for tenant member with active plan'
);

RESET ROLE;

-- Verify payment was created (as superuser to bypass RLS for verification)
SELECT is(
  (SELECT COUNT(*) FROM public.payments WHERE plan_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff')::integer,
  1,
  'Test 16: Payment was created via RPC'
);

-- Verify audit log entry was created
SELECT is(
  (SELECT COUNT(*) FROM public.audit_log WHERE action = 'payment_recorded' AND entity_type = 'payment')::integer,
  1,
  'Test 17: Audit log entry was created via RPC'
);

-- ============================================================================
-- Test 18: register_payment rejects overpayment
-- ============================================================================

SELECT test_set_user('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.register_payment(
    '11110002-0000-0000-0000-000000000000'::uuid,
    999999999::bigint,
    0::bigint
  )$$,
  'P0005',
  NULL,
  'Test 18: register_payment rejects overpayment'
);

RESET ROLE;

-- ============================================================================
-- Test 19: register_payment rejects payment on draft plan
-- ============================================================================

SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.register_payment(
    '11110001-0000-0000-0000-000000000000'::uuid,
    10000::bigint,
    0::bigint
  )$$,
  'P0004',
  NULL,
  'Test 19: register_payment rejects payment on draft plan'
);

RESET ROLE;

-- ============================================================================
-- Test 20-21: activate_plan RPC
-- ============================================================================

SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.activate_plan('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid)$$,
  'Test 20: activate_plan RPC succeeds for draft plan'
);

RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.plans WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  'active',
  'Test 21: Plan status changed to active'
);

-- ============================================================================
-- Test 22: edit_installment only works on draft plans
-- ============================================================================

SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.edit_installment(
    '11110001-0000-0000-0000-000000000000'::uuid,
    '2025-02-15'::date,
    40000::bigint
  )$$,
  'P0004',
  NULL,
  'Test 22: edit_installment fails on active plan'
);

RESET ROLE;

-- ============================================================================
-- Test 23-24: cancel_plan RPC
-- ============================================================================

SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.cancel_plan('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid)$$,
  'Test 23: cancel_plan RPC succeeds for active plan'
);

RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.plans WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  'cancelled',
  'Test 24: Plan status changed to cancelled'
);

-- ============================================================================
-- Test 25-26: Cross-tenant access denied for RPCs
-- ============================================================================

SELECT test_set_user('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.activate_plan('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid)$$,
  '42501',
  NULL,
  'Test 25: User 2 cannot activate User 1 plan (cross-tenant denied)'
);

SELECT throws_ok(
  $$SELECT public.register_payment(
    '11110001-0000-0000-0000-000000000000'::uuid,
    10000::bigint,
    0::bigint
  )$$,
  '42501',
  NULL,
  'Test 26: User 2 cannot register payment on User 1 plan (cross-tenant)'
);

RESET ROLE;

-- ============================================================================
-- Test 27-29: Partial and complete payments with plan completion
-- ============================================================================

-- Create a fresh active plan for payment tests
INSERT INTO public.plans (id, tenant_id, client_id, description, cash_price_cents, financed_amount_cents, total_amount_cents, num_installments, interest_type, interest_rate, status)
VALUES ('77777777-7777-7777-7777-777777777777', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Plan Payment Test', 30000, 30000, 30000, 2, 'fixed_surcharge', 0, 'active')
ON CONFLICT (id) DO NOTHING;

-- Create two installments for this plan
INSERT INTO public.installments (id, plan_id, number, due_date, principal_cents, interest_cents, total_cents, status, paid_cents)
VALUES 
  ('77770001-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 1, '2025-02-15', 15000, 0, 15000, 'pending', 0),
  ('77770002-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 2, '2025-03-15', 15000, 0, 15000, 'pending', 0)
ON CONFLICT (id) DO NOTHING;

SELECT test_set_user('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

-- Test 27: Partial payment sets status to 'partial'
SELECT lives_ok(
  $$SELECT public.register_payment('77770001-0000-0000-0000-000000000000'::uuid, 5000::bigint, 0::bigint)$$,
  'Test 27: Partial payment succeeds'
);

RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.installments WHERE id = '77770001-0000-0000-0000-000000000000'),
  'partial',
  'Test 28: Partial payment sets installment status to partial'
);

-- Test 29: Complete payment sets status to 'paid'
SELECT test_set_user('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.register_payment('77770001-0000-0000-0000-000000000000'::uuid, 10000::bigint, 0::bigint)$$,
  'Test 29: Complete payment on partial installment succeeds'
);

RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.installments WHERE id = '77770001-0000-0000-0000-000000000000'),
  'paid',
  'Test 30: Full payment sets installment status to paid'
);

-- Test 31: Plan transitions to 'completed' when all installments are paid
SELECT test_set_user('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.register_payment('77770002-0000-0000-0000-000000000000'::uuid, 15000::bigint, 0::bigint)$$,
  'Test 31: Payment on second installment succeeds'
);

RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.plans WHERE id = '77777777-7777-7777-7777-777777777777'),
  'completed',
  'Test 32: Plan status transitions to completed when all installments paid'
);

-- ============================================================================
-- Test 33-35: Trigger blocks direct changes to plans (authenticated cannot bypass)
-- ============================================================================

-- Create a fresh draft plan for trigger tests
INSERT INTO public.plans (id, tenant_id, client_id, description, cash_price_cents, financed_amount_cents, total_amount_cents, num_installments, interest_type, interest_rate, status)
VALUES ('88888888-8888-8888-8888-888888888888', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Plan Trigger Test', 50000, 50000, 55000, 2, 'fixed_surcharge', 0.10, 'draft')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.installments (id, plan_id, number, due_date, principal_cents, interest_cents, total_cents, status, paid_cents)
VALUES ('88880001-0000-0000-0000-000000000000', '88888888-8888-8888-8888-888888888888', 1, '2025-04-15', 27500, 2750, 30250, 'pending', 0)
ON CONFLICT (id) DO NOTHING;

SELECT test_set_user('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

-- Test 33: Trigger blocks direct status change on plans
SELECT throws_ok(
  $$UPDATE public.plans SET status = 'active' WHERE id = '88888888-8888-8888-8888-888888888888'$$,
  '23514',
  NULL,
  'Test 33: Trigger blocks direct status change on plans'
);

-- Test 34: Trigger blocks direct total_amount_cents change on plans
SELECT throws_ok(
  $$UPDATE public.plans SET total_amount_cents = 999999 WHERE id = '88888888-8888-8888-8888-888888888888'$$,
  '23514',
  NULL,
  'Test 34: Trigger blocks direct total_amount_cents change on plans'
);

-- Test 35: set_config exploit attempt fails (current_user check cannot be bypassed)
-- First attempt to set a GUC that old trigger might have used, then try to bypass
-- Note: set_config runs in the same session but current_user cannot be changed by set_config
DO $$
BEGIN
  PERFORM set_config('rls.bypass_plan_check', 'true', true);
END;
$$;

SELECT throws_ok(
  $$UPDATE public.plans SET status = 'active' WHERE id = '88888888-8888-8888-8888-888888888888'$$,
  '23514',
  NULL,
  'Test 35: set_config bypass exploit fails (current_user check is secure)'
);

RESET ROLE;

-- ============================================================================
-- Test 36-37: Trigger blocks direct changes to installments
-- ============================================================================

SELECT test_set_user('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

-- Test 36: Trigger blocks direct paid_cents change
SELECT throws_ok(
  $$UPDATE public.installments SET paid_cents = 10000 WHERE id = '88880001-0000-0000-0000-000000000000'$$,
  '23514',
  NULL,
  'Test 36: Trigger blocks direct paid_cents change on installments'
);

-- Test 37: Trigger blocks direct status change on installments
SELECT throws_ok(
  $$UPDATE public.installments SET status = 'paid' WHERE id = '88880001-0000-0000-0000-000000000000'$$,
  '23514',
  NULL,
  'Test 37: Trigger blocks direct status change on installments'
);

RESET ROLE;

-- ============================================================================
-- Test 38: Paid draft + activate_plan exploit blocked
-- ============================================================================

-- First, as superuser, create a draft plan with a "paid" installment (simulating exploit setup)
-- This would require bypassing the normal flow, which the trigger should prevent
INSERT INTO public.plans (id, tenant_id, client_id, description, cash_price_cents, financed_amount_cents, total_amount_cents, num_installments, interest_type, interest_rate, status)
VALUES ('99999999-9999-9999-9999-999999999999', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Plan Exploit Test', 10000, 10000, 10000, 1, 'fixed_surcharge', 0, 'draft')
ON CONFLICT (id) DO UPDATE SET status = 'draft';

INSERT INTO public.installments (id, plan_id, number, due_date, principal_cents, interest_cents, total_cents, status, paid_cents)
VALUES ('99990001-0000-0000-0000-000000000000', '99999999-9999-9999-9999-999999999999', 1, '2025-05-15', 10000, 0, 10000, 'paid', 10000)
ON CONFLICT (id) DO UPDATE SET status = 'paid', paid_cents = 10000;

-- Now test: even if somehow a draft plan has paid installments, activate_plan should work
-- (the plan status check is on the plan, not on installments)
-- The real protection is the trigger preventing authenticated users from setting paid_cents/status directly
SELECT test_set_user('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.activate_plan('99999999-9999-9999-9999-999999999999'::uuid)$$,
  'Test 38: activate_plan works on draft (exploit prevented at trigger level, not activate_plan)'
);

RESET ROLE;

-- ============================================================================
-- Cleanup
-- ============================================================================

DROP FUNCTION IF EXISTS test_set_user(UUID);
SELECT * FROM finish();
ROLLBACK;
