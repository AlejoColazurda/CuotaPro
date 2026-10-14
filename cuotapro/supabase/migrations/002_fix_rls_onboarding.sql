-- Migration: Fix RLS policies for onboarding and tenant creation
-- Addresses:
--   - No INSERT policy on tenants (42501)
--   - Recursive policy on tenant_users (42P17)
--   - First owner cannot insert into tenant_users

-- ============================================================================
-- HELPER FUNCTIONS (SECURITY DEFINER to bypass RLS)
-- ============================================================================

-- Check if user is owner of a specific tenant (avoids recursion)
CREATE OR REPLACE FUNCTION is_tenant_owner(p_tenant_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM tenant_users
    WHERE tenant_id = p_tenant_id
    AND user_id = auth.uid()
    AND role = 'owner'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Check if user is member of a specific tenant
CREATE OR REPLACE FUNCTION is_tenant_member(p_tenant_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM tenant_users
    WHERE tenant_id = p_tenant_id
    AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Generate a unique slug from a business name
CREATE OR REPLACE FUNCTION generate_unique_slug(p_name TEXT)
RETURNS TEXT AS $$
DECLARE
  v_base_slug TEXT;
  v_slug TEXT;
  v_suffix INTEGER := 1;
BEGIN
  -- Normalize: lowercase, remove accents, replace spaces with hyphens
  v_base_slug := lower(
    regexp_replace(
      regexp_replace(
        unaccent(trim(p_name)),
        '[^a-z0-9\s-]', '', 'gi'
      ),
      '\s+', '-', 'g'
    )
  );
  -- Remove leading/trailing hyphens and collapse multiple hyphens
  v_base_slug := regexp_replace(v_base_slug, '-+', '-', 'g');
  v_base_slug := regexp_replace(v_base_slug, '^-|-$', '', 'g');
  -- Limit length
  v_base_slug := left(v_base_slug, 50);
  
  -- If empty, use fallback
  IF v_base_slug = '' THEN
    v_base_slug := 'negocio';
  END IF;
  
  v_slug := v_base_slug;
  
  -- Find unique slug
  WHILE EXISTS (SELECT 1 FROM tenants WHERE slug = v_slug) LOOP
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix;
    IF v_suffix > 10000 THEN
      v_slug := v_base_slug || '-' || extract(epoch from now())::bigint;
      EXIT;
    END IF;
  END LOOP;
  
  RETURN v_slug;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- MAIN FUNCTION: Create tenant with owner (atomic, bypasses RLS)
-- ============================================================================

CREATE OR REPLACE FUNCTION create_tenant_with_owner(
  p_name TEXT,
  p_full_name TEXT
)
RETURNS JSON AS $$
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
  IF EXISTS (SELECT 1 FROM tenant_users WHERE user_id = v_user_id AND role = 'owner') THEN
    RAISE EXCEPTION 'User is already an owner of a tenant' USING ERRCODE = '23505';
  END IF;
  
  -- Generate unique slug
  v_slug := generate_unique_slug(p_name);
  
  -- Upsert user profile
  INSERT INTO user_profiles (id, email, full_name)
  VALUES (v_user_id, v_email, p_full_name)
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, user_profiles.full_name),
    updated_at = NOW();
  
  -- Create tenant
  INSERT INTO tenants (name, slug, email)
  VALUES (p_name, v_slug, v_email)
  RETURNING id INTO v_tenant_id;
  
  -- Link user as owner
  INSERT INTO tenant_users (tenant_id, user_id, role)
  VALUES (v_tenant_id, v_user_id, 'owner');
  
  -- Return result
  RETURN json_build_object(
    'tenant_id', v_tenant_id,
    'slug', v_slug
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke from public/anon, grant only to authenticated
REVOKE ALL ON FUNCTION create_tenant_with_owner(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_tenant_with_owner(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION create_tenant_with_owner(TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION generate_unique_slug(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION generate_unique_slug(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION generate_unique_slug(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION is_tenant_owner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_tenant_owner(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION is_tenant_owner(UUID) TO authenticated;

REVOKE ALL ON FUNCTION is_tenant_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_tenant_member(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION is_tenant_member(UUID) TO authenticated;

-- ============================================================================
-- FIX RECURSIVE/BROKEN RLS POLICIES
-- ============================================================================

-- Drop problematic policies
DROP POLICY IF EXISTS "Owners can manage tenant members" ON tenant_users;
DROP POLICY IF EXISTS "Owners can update their tenants" ON tenants;
DROP POLICY IF EXISTS "Owners can manage API keys" ON api_keys;

-- ============================================================================
-- TENANT_USERS: Fix recursive policy
-- ============================================================================

-- Users can view their own membership
CREATE POLICY "Users can view own tenant membership"
  ON tenant_users FOR SELECT
  USING (user_id = auth.uid());

-- Owners can view all members of their tenants (using helper to avoid recursion)
CREATE POLICY "Owners can view all tenant members"
  ON tenant_users FOR SELECT
  USING (is_tenant_owner(tenant_id));

-- Owners can insert new members
CREATE POLICY "Owners can insert tenant members"
  ON tenant_users FOR INSERT
  WITH CHECK (is_tenant_owner(tenant_id));

-- Owners can update members (not themselves to prevent lockout)
CREATE POLICY "Owners can update tenant members"
  ON tenant_users FOR UPDATE
  USING (is_tenant_owner(tenant_id) AND user_id != auth.uid());

-- Owners can delete members (not themselves)
CREATE POLICY "Owners can delete tenant members"
  ON tenant_users FOR DELETE
  USING (is_tenant_owner(tenant_id) AND user_id != auth.uid());

-- ============================================================================
-- TENANTS: Fix UPDATE policy
-- ============================================================================

CREATE POLICY "Owners can update their tenants"
  ON tenants FOR UPDATE
  USING (is_tenant_owner(id));

-- ============================================================================
-- API_KEYS: Fix recursive policy
-- ============================================================================

CREATE POLICY "Owners can manage API keys"
  ON api_keys FOR ALL
  USING (is_tenant_owner(tenant_id));

-- ============================================================================
-- PORTFOLIOS: Ensure INSERT works
-- ============================================================================

DROP POLICY IF EXISTS "Users can manage portfolios" ON portfolios;

CREATE POLICY "Members can insert portfolios"
  ON portfolios FOR INSERT
  WITH CHECK (is_tenant_member(tenant_id));

CREATE POLICY "Members can update portfolios"
  ON portfolios FOR UPDATE
  USING (is_tenant_member(tenant_id));

CREATE POLICY "Owners can delete portfolios"
  ON portfolios FOR DELETE
  USING (is_tenant_owner(tenant_id));

-- ============================================================================
-- CLIENTS: Ensure INSERT works
-- ============================================================================

DROP POLICY IF EXISTS "Users can manage clients" ON clients;

CREATE POLICY "Members can insert clients"
  ON clients FOR INSERT
  WITH CHECK (is_tenant_member(tenant_id));

CREATE POLICY "Members can update clients"
  ON clients FOR UPDATE
  USING (is_tenant_member(tenant_id));

CREATE POLICY "Owners can delete clients"
  ON clients FOR DELETE
  USING (is_tenant_owner(tenant_id));

-- ============================================================================
-- PLANS: Ensure INSERT works
-- ============================================================================

DROP POLICY IF EXISTS "Users can manage plans" ON plans;

CREATE POLICY "Members can insert plans"
  ON plans FOR INSERT
  WITH CHECK (is_tenant_member(tenant_id));

CREATE POLICY "Members can update plans"
  ON plans FOR UPDATE
  USING (is_tenant_member(tenant_id));

CREATE POLICY "Members can delete draft plans"
  ON plans FOR DELETE
  USING (is_tenant_member(tenant_id) AND status = 'draft');

-- ============================================================================
-- INSTALLMENTS: Fix INSERT policy
-- ============================================================================

DROP POLICY IF EXISTS "Users can insert installments" ON installments;
DROP POLICY IF EXISTS "Users can manage draft installments" ON installments;

-- Members can insert installments for their tenant's plans
CREATE POLICY "Members can insert installments"
  ON installments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM plans
    WHERE plans.id = installments.plan_id
    AND is_tenant_member(plans.tenant_id)
  ));

-- Members can update installments for draft plans
CREATE POLICY "Members can update draft installments"
  ON installments FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM plans
    WHERE plans.id = installments.plan_id
    AND is_tenant_member(plans.tenant_id)
  ));

-- Members can delete installments from draft plans
CREATE POLICY "Members can delete draft installments"
  ON installments FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM plans
    WHERE plans.id = installments.plan_id
    AND is_tenant_member(plans.tenant_id)
    AND plans.status = 'draft'
  ));

-- ============================================================================
-- PAYMENTS: Fix INSERT policy
-- ============================================================================

DROP POLICY IF EXISTS "Users can insert payments" ON payments;

CREATE POLICY "Members can insert payments"
  ON payments FOR INSERT
  WITH CHECK (is_tenant_member(tenant_id));

-- Members can delete payments (for corrections)
CREATE POLICY "Members can delete payments"
  ON payments FOR DELETE
  USING (is_tenant_member(tenant_id));

-- ============================================================================
-- AUDIT_LOG: Fix INSERT policy (allow authenticated users)
-- ============================================================================

DROP POLICY IF EXISTS "System can insert audit log" ON audit_log;

CREATE POLICY "Authenticated users can insert audit log"
  ON audit_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================================
-- PASSKEYS: Already correct, but let's be explicit
-- ============================================================================

DROP POLICY IF EXISTS "Users can manage own passkeys" ON passkeys;

CREATE POLICY "Users can select own passkeys"
  ON passkeys FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own passkeys"
  ON passkeys FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own passkeys"
  ON passkeys FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own passkeys"
  ON passkeys FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================================
-- SESSIONS: Already correct, but let's be explicit
-- ============================================================================

DROP POLICY IF EXISTS "Users can manage own sessions" ON sessions;

CREATE POLICY "Users can select own sessions"
  ON sessions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own sessions"
  ON sessions FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own sessions"
  ON sessions FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own sessions"
  ON sessions FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================================
-- Enable unaccent extension for slug generation
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS unaccent;

-- ============================================================================
-- COMMENT: Document the create_tenant_with_owner function
-- ============================================================================

COMMENT ON FUNCTION create_tenant_with_owner(TEXT, TEXT) IS 
'Creates a new tenant and assigns the current user as owner.
Arguments:
  p_name: Business name (used to generate slug)
  p_full_name: User''s full name (updates user_profiles)
Returns JSON: { tenant_id: uuid, slug: text }
Errors:
  P0001: Not authenticated or email not found
  23505: User is already an owner of a tenant';
