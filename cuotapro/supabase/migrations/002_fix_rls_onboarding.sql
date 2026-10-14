-- Migration: Fix RLS policies for onboarding and tenant creation
-- Addresses:
--   - No INSERT policy on tenants (42501)
--   - Recursive policy on tenant_users (42P17)
--   - First owner cannot insert into tenant_users

-- ============================================================================
-- EXTENSIONS (in extensions schema for security)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

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
-- FIX RECURSIVE/BROKEN RLS POLICIES
-- ============================================================================

-- Drop problematic policies
DROP POLICY IF EXISTS "Owners can manage tenant members" ON public.tenant_users;
DROP POLICY IF EXISTS "Owners can update their tenants" ON public.tenants;
DROP POLICY IF EXISTS "Owners can manage API keys" ON public.api_keys;

-- ============================================================================
-- TENANT_USERS: Fix recursive policy
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
CREATE POLICY "Owners can update tenant members"
  ON public.tenant_users FOR UPDATE
  USING (public.is_tenant_owner(tenant_id) AND user_id != auth.uid())
  WITH CHECK (role != 'owner');

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
-- API_KEYS: Fix recursive policy
-- ============================================================================

CREATE POLICY "Owners can manage API keys"
  ON public.api_keys FOR ALL
  USING (public.is_tenant_owner(tenant_id))
  WITH CHECK (public.is_tenant_owner(tenant_id));

-- ============================================================================
-- PORTFOLIOS: Ensure INSERT works
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
-- CLIENTS: Ensure INSERT works
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
-- PLANS: Ensure INSERT works
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
-- INSTALLMENTS: Fix INSERT/UPDATE/DELETE policies
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
-- PAYMENTS: Fix INSERT policy (no DELETE - use reversal payments instead)
-- ============================================================================

DROP POLICY IF EXISTS "Users can insert payments" ON public.payments;

CREATE POLICY "Members can insert payments"
  ON public.payments FOR INSERT
  WITH CHECK (public.is_tenant_member(tenant_id));

-- No DELETE policy for payments - use reversal payments instead

-- ============================================================================
-- AUDIT_LOG: Remove client INSERT policy - audit only via triggers/definer
-- ============================================================================

DROP POLICY IF EXISTS "System can insert audit log" ON public.audit_log;
DROP POLICY IF EXISTS "Authenticated users can insert audit log" ON public.audit_log;

-- No INSERT policy for clients - audit log written only by SECURITY DEFINER functions or triggers

-- ============================================================================
-- PASSKEYS: Explicit per-operation policies
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
-- SESSIONS: Explicit per-operation policies
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
