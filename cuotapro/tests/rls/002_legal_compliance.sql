-- RLS Integration Tests: Legal Compliance (Ley 24.240, WhatsApp, Terms)
-- Uses pgTAP for PostgreSQL testing
-- 
-- Tests cover:
-- 1. Art. 36 acceptance tracking (record_art36_acceptance, activate_plan)
-- 2. WhatsApp opt-in/opt-out (signed token, anon opt-out)
-- 3. Legal acceptances table (RLS, record_legal_acceptance)
-- 4. Enhanced installments trigger (block total_cents/due_date on non-draft)
-- 5. Penalty cap validation (plan.penalty_cap <= tenant.max_penalty_cap)

\set ON_ERROR_STOP on

BEGIN;

-- Load pgTAP extension
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(36);

-- ============================================================================
-- Setup: Create test users and data AS SUPERUSER (bypass RLS for setup)
-- ============================================================================

-- Create test users in auth.users
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, instance_id, aud, role)
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'owner1@test.com', crypt('password', gen_salt('bf')), NOW(), NOW(), NOW(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'owner2@test.com', crypt('password', gen_salt('bf')), NOW(), NOW(), NOW(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

-- Create tenants with max_penalty_cap
INSERT INTO public.tenants (id, slug, name, email, max_penalty_cap)
VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tenant-one', 'Tenant One', 'owner1@test.com', 0.30),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'tenant-two', 'Tenant Two', 'owner2@test.com', 0.25)
ON CONFLICT (id) DO NOTHING;

-- Create tenant-user relationships
INSERT INTO public.tenant_users (tenant_id, user_id, role)
VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'owner')
ON CONFLICT DO NOTHING;

-- Create user profiles
INSERT INTO public.user_profiles (id, email, full_name)
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'owner1@test.com', 'Owner One'),
  ('22222222-2222-2222-2222-222222222222', 'owner2@test.com', 'Owner Two')
ON CONFLICT (id) DO NOTHING;

-- Create clients for each tenant
INSERT INTO public.clients (id, tenant_id, dni_cuit, full_name, whatsapp_opt_in)
VALUES 
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '12345678', 'Client One', FALSE),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '87654321', 'Client Two', FALSE)
ON CONFLICT (id) DO NOTHING;

-- Create plans for each tenant (draft and active)
INSERT INTO public.plans (id, tenant_id, client_id, description, cash_price_cents, financed_amount_cents, total_amount_cents, num_installments, interest_type, interest_rate, status, penalty_cap)
VALUES 
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Draft Plan One', 100000, 100000, 110000, 3, 'fixed_surcharge', 0.10, 'draft', 0.30),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Active Plan Two', 200000, 200000, 220000, 3, 'fixed_surcharge', 0.10, 'active', 0.25)
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
-- Test 1-5: Art. 36 Acceptance (record_art36_acceptance)
-- ============================================================================

-- Test 1: record_art36_acceptance succeeds for draft plan (valid hash)
SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.record_art36_acceptance(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
    'https://storage.example.com/art36/doc.pdf',
    '1.0',
    'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    '192.168.1.1'::inet
  )$$,
  'Test 1: record_art36_acceptance succeeds for draft plan with valid hash'
);

RESET ROLE;

-- Verify Art. 36 data was saved
SELECT is(
  (SELECT art36_document_version FROM public.plans WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  '1.0',
  'Test 2: Art. 36 document version saved correctly'
);

SELECT isnt(
  (SELECT art36_accepted_at FROM public.plans WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  NULL,
  'Test 3: Art. 36 accepted_at timestamp was set'
);

-- Test 4: record_art36_acceptance fails with invalid hash (not 64 hex chars)
SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

-- Create another draft plan for this test
RESET ROLE;
INSERT INTO public.plans (id, tenant_id, client_id, description, cash_price_cents, financed_amount_cents, total_amount_cents, num_installments, interest_type, interest_rate, status)
VALUES ('99990001-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Plan Hash Test', 50000, 50000, 55000, 2, 'fixed_surcharge', 0.10, 'draft')
ON CONFLICT (id) DO NOTHING;

SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.record_art36_acceptance(
    '99990001-0000-0000-0000-000000000000'::uuid,
    'https://storage.example.com/art36/doc.pdf',
    '1.0',
    'invalidhash',
    NULL
  )$$,
  'P0002',
  NULL,
  'Test 4: record_art36_acceptance fails with invalid hash format'
);

RESET ROLE;

-- Test 5: record_art36_acceptance fails for non-draft plan
SELECT test_set_user('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.record_art36_acceptance(
    'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
    'https://storage.example.com/art36/doc.pdf',
    '1.0',
    'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    NULL
  )$$,
  'P0004',
  NULL,
  'Test 5: record_art36_acceptance fails for non-draft (active) plan'
);

RESET ROLE;

-- Test 6: record_art36_acceptance fails for cross-tenant access
SELECT test_set_user('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.record_art36_acceptance(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
    'https://storage.example.com/art36/doc.pdf',
    '1.0',
    'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    NULL
  )$$,
  '42501',
  NULL,
  'Test 6: record_art36_acceptance fails for cross-tenant access'
);

RESET ROLE;

-- Test 7: activate_plan requires Art. 36 acceptance
-- Create a fresh draft plan without Art. 36 acceptance
INSERT INTO public.plans (id, tenant_id, client_id, description, cash_price_cents, financed_amount_cents, total_amount_cents, num_installments, interest_type, interest_rate, status)
VALUES ('99990002-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Plan No Art36', 30000, 30000, 33000, 2, 'fixed_surcharge', 0.10, 'draft')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.installments (id, plan_id, number, due_date, principal_cents, interest_cents, total_cents, status, paid_cents)
VALUES ('99990003-0000-0000-0000-000000000000', '99990002-0000-0000-0000-000000000000', 1, '2025-02-15', 16500, 0, 16500, 'pending', 0)
ON CONFLICT (id) DO NOTHING;

SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.activate_plan('99990002-0000-0000-0000-000000000000'::uuid)$$,
  'P0006',
  NULL,
  'Test 7: activate_plan fails without Art. 36 acceptance'
);

-- Test 8: activate_plan succeeds after Art. 36 acceptance
SELECT lives_ok(
  $$SELECT public.record_art36_acceptance(
    '99990002-0000-0000-0000-000000000000'::uuid,
    'https://storage.example.com/art36/doc.pdf',
    '1.0',
    'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
    '10.0.0.1'::inet
  )$$,
  'Test 8a: Art. 36 acceptance recorded'
);

SELECT lives_ok(
  $$SELECT public.activate_plan('99990002-0000-0000-0000-000000000000'::uuid)$$,
  'Test 8: activate_plan succeeds after Art. 36 acceptance'
);

RESET ROLE;

-- ============================================================================
-- Test 9-15: WhatsApp Opt-in/Opt-out
-- ============================================================================

-- Test 9: record_whatsapp_opt_in succeeds and generates token
SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.record_whatsapp_opt_in('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'signup')$$,
  'Test 9: record_whatsapp_opt_in succeeds'
);

RESET ROLE;

-- Verify opt-in data was saved
SELECT is(
  (SELECT whatsapp_opt_in FROM public.clients WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  TRUE,
  'Test 10: WhatsApp opt_in flag set to TRUE'
);

SELECT isnt(
  (SELECT whatsapp_opt_out_token FROM public.clients WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  NULL,
  'Test 11: WhatsApp opt_out_token was generated'
);

SELECT is(
  (SELECT LENGTH(whatsapp_opt_out_token) FROM public.clients WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  64,
  'Test 12: WhatsApp opt_out_token is 64 chars (32 bytes hex)'
);

-- Test 13: record_whatsapp_opt_in fails for cross-tenant client
SELECT test_set_user('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.record_whatsapp_opt_in('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'manual')$$,
  '42501',
  NULL,
  'Test 13: record_whatsapp_opt_in fails for cross-tenant client'
);

RESET ROLE;

-- Test 14: process_whatsapp_opt_out succeeds with valid token (anon can call)
-- Get the token and test opt-out
DO $$
DECLARE
  v_token VARCHAR(64);
  v_result JSON;
BEGIN
  SELECT whatsapp_opt_out_token INTO v_token
  FROM public.clients WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  
  -- Call opt-out with valid token (this runs as postgres which is fine for the test)
  SELECT public.process_whatsapp_opt_out('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, v_token) INTO v_result;
  
  IF (v_result->>'success')::boolean != true THEN
    RAISE EXCEPTION 'Opt-out should succeed with valid token';
  END IF;
END;
$$;

-- Re-verify with anon role can call the function (with invalid token to test access)
SET LOCAL ROLE anon;

-- Note: anon can CALL the function (grant is given), but with invalid token it fails
SELECT throws_ok(
  $$SELECT public.process_whatsapp_opt_out('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'wrongtoken')$$,
  'P0002',
  NULL,
  'Test 14: anon role can call process_whatsapp_opt_out (fails with wrong token as expected)'
);

RESET ROLE;

-- Verify opt-out was recorded
SELECT is(
  (SELECT whatsapp_opt_in FROM public.clients WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  FALSE,
  'Test 15: WhatsApp opt_in flag set to FALSE after opt-out'
);

SELECT isnt(
  (SELECT whatsapp_opt_out_at FROM public.clients WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  NULL,
  'Test 16: WhatsApp opt_out_at timestamp was set'
);

-- Test 17: process_whatsapp_opt_out fails with invalid token
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$SELECT public.process_whatsapp_opt_out('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'invalidtoken12345')$$,
  'P0002',
  NULL,
  'Test 17: process_whatsapp_opt_out fails with invalid token'
);

RESET ROLE;

-- Test 18: can_send_whatsapp returns FALSE after opt-out
SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT is(
  public.can_send_whatsapp('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid),
  FALSE,
  'Test 18: can_send_whatsapp returns FALSE after opt-out'
);

RESET ROLE;

-- ============================================================================
-- Test 19-22: Legal Acceptances Table (RLS)
-- ============================================================================

-- Test 19: record_legal_acceptance succeeds for existing document version
SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.record_legal_acceptance('terms_of_service'::legal_document_type, '1.0', '192.168.1.1'::inet, 'Mozilla/5.0')$$,
  'Test 19: record_legal_acceptance succeeds for existing document version'
);

RESET ROLE;

-- Verify acceptance was recorded
SELECT is(
  (SELECT COUNT(*) FROM public.legal_acceptances WHERE user_id = '11111111-1111-1111-1111-111111111111' AND document_type = 'terms_of_service')::integer,
  1,
  'Test 20: Legal acceptance was recorded'
);

-- Test 21: Users can view their own acceptances (RLS)
SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT COUNT(*) FROM public.legal_acceptances)::integer,
  1,
  'Test 21: User can view their own legal acceptances'
);

RESET ROLE;

-- Test 22: record_legal_acceptance fails for non-existent document version
SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.record_legal_acceptance('terms_of_service'::legal_document_type, '999.0', NULL, NULL)$$,
  'P0003',
  NULL,
  'Test 22: record_legal_acceptance fails for non-existent document version'
);

RESET ROLE;

-- ============================================================================
-- Test 23-27: Enhanced Installments Trigger (block total_cents/due_date on non-draft)
-- ============================================================================

-- Test 23: Trigger allows total_cents change on draft plan (authenticated)
SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$UPDATE public.installments SET total_cents = 37000 WHERE id = '11110001-0000-0000-0000-000000000000'$$,
  'Test 23: Trigger allows total_cents change on draft plan'
);

-- Test 24: Trigger allows due_date change on draft plan (authenticated)
SELECT lives_ok(
  $$UPDATE public.installments SET due_date = '2025-01-20' WHERE id = '11110001-0000-0000-0000-000000000000'$$,
  'Test 24: Trigger allows due_date change on draft plan'
);

RESET ROLE;

-- Test 25-27: Use service_role to bypass RLS and test trigger
-- (RLS only allows UPDATE on draft plans for authenticated, so we use service_role)
-- service_role bypasses RLS but trigger should still block non-draft changes
SET LOCAL ROLE service_role;

-- Test 25: Trigger blocks total_cents change on non-draft (active) plan
SELECT throws_ok(
  $$UPDATE public.installments SET total_cents = 99999 WHERE id = '11110002-0000-0000-0000-000000000000'$$,
  '23514',
  NULL,
  'Test 25: Trigger blocks total_cents change on active plan (service_role)'
);

-- Test 26: Trigger blocks due_date change on non-draft (active) plan
SELECT throws_ok(
  $$UPDATE public.installments SET due_date = '2025-12-31' WHERE id = '11110002-0000-0000-0000-000000000000'$$,
  '23514',
  NULL,
  'Test 26: Trigger blocks due_date change on active plan (service_role)'
);

-- Test 27: Trigger blocks principal_cents change on non-draft plan
SELECT throws_ok(
  $$UPDATE public.installments SET principal_cents = 50000 WHERE id = '11110002-0000-0000-0000-000000000000'$$,
  '23514',
  NULL,
  'Test 27: Trigger blocks principal_cents change on active plan (service_role)'
);

RESET ROLE;

-- ============================================================================
-- Test 28-32: Penalty Cap Validation (plan.penalty_cap <= tenant.max_penalty_cap)
-- ============================================================================

-- Test 28: Plan creation with valid penalty_cap succeeds
SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.plans (tenant_id, client_id, description, cash_price_cents, financed_amount_cents, total_amount_cents, num_installments, interest_type, interest_rate, penalty_cap)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Valid Cap Plan', 40000, 40000, 44000, 2, 'fixed_surcharge', 0.10, 0.25)$$,
  'Test 28: Plan creation with valid penalty_cap (0.25 <= 0.30) succeeds'
);

RESET ROLE;

-- Test 29: Plan creation with penalty_cap > tenant.max_penalty_cap fails
SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.plans (tenant_id, client_id, description, cash_price_cents, financed_amount_cents, total_amount_cents, num_installments, interest_type, interest_rate, penalty_cap)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Invalid Cap Plan', 40000, 40000, 44000, 2, 'fixed_surcharge', 0.10, 0.50)$$,
  '23514',
  NULL,
  'Test 29: Plan creation with penalty_cap > max_penalty_cap (0.50 > 0.30) fails'
);

RESET ROLE;

-- Test 30: Plan creation with penalty_cap = tenant.max_penalty_cap succeeds
SELECT test_set_user('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.plans (tenant_id, client_id, description, cash_price_cents, financed_amount_cents, total_amount_cents, num_installments, interest_type, interest_rate, penalty_cap)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Equal Cap Plan', 40000, 40000, 44000, 2, 'fixed_surcharge', 0.10, 0.25)$$,
  'Test 30: Plan creation with penalty_cap = max_penalty_cap (0.25 = 0.25) succeeds'
);

RESET ROLE;

-- Test 31: Plan UPDATE of penalty_cap to exceed max fails
-- First create a plan with valid cap
INSERT INTO public.plans (id, tenant_id, client_id, description, cash_price_cents, financed_amount_cents, total_amount_cents, num_installments, interest_type, interest_rate, status, penalty_cap)
VALUES ('99990004-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Cap Update Test', 60000, 60000, 66000, 2, 'fixed_surcharge', 0.10, 'draft', 0.20)
ON CONFLICT (id) DO NOTHING;

SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$UPDATE public.plans SET penalty_cap = 0.40 WHERE id = '99990004-0000-0000-0000-000000000000'$$,
  '23514',
  NULL,
  'Test 31: Plan UPDATE of penalty_cap to exceed max (0.40 > 0.30) fails'
);

-- Test 32: Plan UPDATE of penalty_cap within limit succeeds
SELECT lives_ok(
  $$UPDATE public.plans SET penalty_cap = 0.28 WHERE id = '99990004-0000-0000-0000-000000000000'$$,
  'Test 32: Plan UPDATE of penalty_cap within limit (0.28 <= 0.30) succeeds'
);

RESET ROLE;

-- ============================================================================
-- Test 33-35: Document versions RLS
-- ============================================================================

-- Test 33: Anyone can view document versions
SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT COUNT(*) FROM public.legal_document_versions WHERE document_type = 'terms_of_service')::integer,
  1,
  'Test 33: Authenticated user can view document versions'
);

RESET ROLE;

-- Test 34: Authenticated cannot insert document versions (system only)
SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.legal_document_versions (document_type, version, content_hash, effective_date)
    VALUES ('terms_of_service', '2.0', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', CURRENT_DATE)$$,
  '42501',
  NULL,
  'Test 34: Authenticated user cannot insert document versions (system only)'
);

RESET ROLE;

-- Test 35: has_accepted_legal_documents returns correct value
SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT is(
  public.has_accepted_legal_documents(ARRAY['terms_of_service']::legal_document_type[]),
  TRUE,
  'Test 35: has_accepted_legal_documents returns TRUE for accepted documents'
);

RESET ROLE;

-- ============================================================================
-- Cleanup
-- ============================================================================

DROP FUNCTION IF EXISTS test_set_user(UUID);
SELECT * FROM finish();
ROLLBACK;
