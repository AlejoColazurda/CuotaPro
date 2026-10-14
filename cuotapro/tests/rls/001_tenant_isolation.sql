-- RLS Integration Tests: Tenant Isolation
-- Uses pgTAP for PostgreSQL testing
-- Run with: psql -f tests/rls/001_tenant_isolation.sql

BEGIN;

-- Load pgTAP extension
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(28);

-- ============================================================================
-- Setup: Create test users and data
-- ============================================================================

-- Create test users in auth.users
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, instance_id, aud, role)
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'owner1@test.com', 'password', NOW(), NOW(), NOW(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'owner2@test.com', 'password', NOW(), NOW(), NOW(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'member1@test.com', 'password', NOW(), NOW(), NOW(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

-- Create tenants
INSERT INTO public.tenants (id, slug, name, email)
VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tenant-one', 'Tenant One', 'owner1@test.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'tenant-two', 'Tenant Two', 'owner2@test.com');

-- Create tenant-user relationships
INSERT INTO public.tenant_users (tenant_id, user_id, role)
VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'owner'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'merchant');

-- Create user profiles
INSERT INTO public.user_profiles (id, email, full_name)
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'owner1@test.com', 'Owner One'),
  ('22222222-2222-2222-2222-222222222222', 'owner2@test.com', 'Owner Two'),
  ('33333333-3333-3333-3333-333333333333', 'member1@test.com', 'Member One');

-- Create clients for each tenant
INSERT INTO public.clients (id, tenant_id, dni_cuit, full_name)
VALUES 
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '12345678', 'Client One'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '87654321', 'Client Two');

-- Create plans for each tenant
INSERT INTO public.plans (id, tenant_id, client_id, description, cash_price_cents, financed_amount_cents, total_amount_cents, num_installments, interest_type, interest_rate, status)
VALUES 
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Plan Tenant One', 100000, 100000, 110000, 3, 'fixed_surcharge', 0.10, 'draft'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Plan Tenant Two', 200000, 200000, 220000, 3, 'fixed_surcharge', 0.10, 'active');

-- Create installments
INSERT INTO public.installments (id, plan_id, number, due_date, principal_cents, interest_cents, total_cents)
VALUES 
  ('11110001-0000-0000-0000-000000000000', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 1, '2025-01-15', 33334, 3333, 36667),
  ('11110002-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 1, '2025-01-15', 66667, 6667, 73334);

-- ============================================================================
-- Test: Tenant isolation for SELECT
-- ============================================================================

-- Set session to user 1 (owner of tenant one)
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM public.tenants)::integer,
  1,
  'User 1 should only see their own tenant'
);

SELECT is(
  (SELECT COUNT(*) FROM public.clients)::integer,
  1,
  'User 1 should only see clients from their tenant'
);

SELECT is(
  (SELECT COUNT(*) FROM public.plans)::integer,
  1,
  'User 1 should only see plans from their tenant'
);

-- Set session to user 2 (owner of tenant two)
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM public.tenants)::integer,
  1,
  'User 2 should only see their own tenant'
);

SELECT is(
  (SELECT slug FROM public.tenants LIMIT 1),
  'tenant-two',
  'User 2 should only see tenant-two'
);

-- ============================================================================
-- Test: Tenant isolation for INSERT (client)
-- ============================================================================

-- User 2 tries to insert client into tenant 1 (should fail)
SELECT throws_ok(
  $$INSERT INTO public.clients (tenant_id, dni_cuit, full_name) 
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99999999', 'Evil Client')$$,
  '42501',
  NULL,
  'User 2 cannot insert client into tenant 1'
);

-- User 2 can insert client into their own tenant
SELECT lives_ok(
  $$INSERT INTO public.clients (tenant_id, dni_cuit, full_name) 
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111', 'Good Client')$$,
  'User 2 can insert client into their own tenant'
);

-- ============================================================================
-- Test: Immutable tenant_id on UPDATE
-- ============================================================================

-- User 2 tries to move their client to tenant 1 (should fail - immutable trigger)
SELECT throws_ok(
  $$UPDATE public.clients 
    SET tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    WHERE dni_cuit = '11111111'$$,
  '23514',
  NULL,
  'Cannot change tenant_id via UPDATE (immutable trigger)'
);

-- ============================================================================
-- Test: is_tenant_member and is_tenant_owner functions
-- ============================================================================

SELECT is(
  public.is_tenant_member('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  true,
  'User 2 is member of tenant two'
);

SELECT is(
  public.is_tenant_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  false,
  'User 2 is NOT member of tenant one'
);

SELECT is(
  public.is_tenant_owner('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  true,
  'User 2 is owner of tenant two'
);

-- Switch to member user (user 3)
SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
SELECT set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);

SELECT is(
  public.is_tenant_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  true,
  'User 3 is member of tenant one'
);

SELECT is(
  public.is_tenant_owner('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  false,
  'User 3 is NOT owner of tenant one (just merchant)'
);

-- ============================================================================
-- Test: No direct payment INSERT (must use RPC)
-- ============================================================================

SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

SELECT throws_ok(
  $$INSERT INTO public.payments (tenant_id, plan_id, installment_id, amount_cents, recorded_by)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 
            '11110002-0000-0000-0000-000000000000', 10000, '22222222-2222-2222-2222-222222222222')$$,
  '42501',
  NULL,
  'Direct payment INSERT should fail (no RLS policy)'
);

-- ============================================================================
-- Test: register_payment RPC
-- ============================================================================

SELECT lives_ok(
  $$SELECT public.register_payment(
    '11110002-0000-0000-0000-000000000000'::uuid,
    10000,
    0
  )$$,
  'register_payment RPC succeeds for tenant member with active plan'
);

-- Verify payment was created
SELECT is(
  (SELECT COUNT(*) FROM public.payments WHERE plan_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff')::integer,
  1,
  'Payment was created via RPC'
);

-- Verify audit log entry was created
SELECT is(
  (SELECT COUNT(*) FROM public.audit_log WHERE action = 'payment_recorded' AND entity_type = 'payment')::integer,
  1,
  'Audit log entry was created via RPC'
);

-- ============================================================================
-- Test: register_payment rejects overpayment
-- ============================================================================

SELECT throws_ok(
  $$SELECT public.register_payment(
    '11110002-0000-0000-0000-000000000000'::uuid,
    999999999,
    0
  )$$,
  'P0005',
  NULL,
  'register_payment rejects overpayment'
);

-- ============================================================================
-- Test: register_payment rejects payment on draft plan
-- ============================================================================

SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT public.register_payment(
    '11110001-0000-0000-0000-000000000000'::uuid,
    10000,
    0
  )$$,
  'P0004',
  NULL,
  'register_payment rejects payment on draft plan'
);

-- ============================================================================
-- Test: activate_plan RPC
-- ============================================================================

SELECT lives_ok(
  $$SELECT public.activate_plan('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid)$$,
  'activate_plan RPC succeeds for draft plan'
);

SELECT is(
  (SELECT status FROM public.plans WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  'active',
  'Plan status changed to active'
);

-- ============================================================================
-- Test: edit_installment only works on draft plans
-- ============================================================================

SELECT throws_ok(
  $$SELECT public.edit_installment(
    '11110001-0000-0000-0000-000000000000'::uuid,
    '2025-02-15'::date,
    40000
  )$$,
  'P0004',
  NULL,
  'edit_installment fails on active plan'
);

-- ============================================================================
-- Test: cancel_plan RPC
-- ============================================================================

SELECT lives_ok(
  $$SELECT public.cancel_plan('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid)$$,
  'cancel_plan RPC succeeds for active plan'
);

SELECT is(
  (SELECT status FROM public.plans WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  'cancelled',
  'Plan status changed to cancelled'
);

-- ============================================================================
-- Test: Cross-tenant access denied for RPCs
-- ============================================================================

SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT public.activate_plan('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid)$$,
  '42501',
  NULL,
  'User 2 cannot activate User 1 plan (cross-tenant)'
);

SELECT throws_ok(
  $$SELECT public.register_payment(
    '11110001-0000-0000-0000-000000000000'::uuid,
    10000,
    0
  )$$,
  '42501',
  NULL,
  'User 2 cannot register payment on User 1 plan (cross-tenant)'
);

-- ============================================================================
-- Cleanup
-- ============================================================================

SELECT * FROM finish();
ROLLBACK;
