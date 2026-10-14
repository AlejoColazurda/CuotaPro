/**
 * Typed query helpers for Supabase operations
 * These helpers provide proper typing for common Supabase operations
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Tenant, Plan, Installment, Client, Payment, Portfolio, Passkey, UserProfile, AuditLogEntry } from '@/types/database';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientType = SupabaseClient<any>;

interface QueryResult<T> {
  data: T | null;
  error: Error | null;
}

interface QueryArrayResult<T> {
  data: T[] | null;
  error: Error | null;
  count?: number | null;
}

export async function getTenantUser(supabase: SupabaseClientType, userId?: string) {
  const query = supabase.from('tenant_users').select('tenant_id, tenants(*)');
  const result = userId ? await query.eq('user_id', userId).single() : await query.single();
  return result as unknown as QueryResult<{ tenant_id: string; tenants: Tenant }>;
}

export async function getPlanWithRelations(supabase: SupabaseClientType, planId: string, tenantId: string) {
  const result = await supabase
    .from('plans')
    .select(`*, clients(*), installments(*), payments(*)`)
    .eq('id', planId)
    .eq('tenant_id', tenantId)
    .single();
  return result as unknown as QueryResult<Plan & { clients: Client; installments: Installment[]; payments: Payment[] }>;
}

export async function getClients(supabase: SupabaseClientType, tenantId: string) {
  const result = await supabase
    .from('clients')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('full_name');
  return result as unknown as QueryArrayResult<Client>;
}

export async function getPortfolios(supabase: SupabaseClientType, tenantId: string) {
  const result = await supabase
    .from('portfolios')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name');
  return result as unknown as QueryArrayResult<Portfolio>;
}

export async function getPasskeys(supabase: SupabaseClientType, userId: string) {
  const result = await supabase
    .from('passkeys')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return result as unknown as QueryArrayResult<Passkey>;
}

export async function getUserProfile(supabase: SupabaseClientType, userId: string) {
  const result = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return result as unknown as QueryResult<UserProfile>;
}

export async function updatePlan(supabase: SupabaseClientType, planId: string, data: Partial<Plan>) {
  const result = await supabase.from('plans').update(data as Record<string, unknown>).eq('id', planId);
  return result as unknown as { error: Error | null };
}

export async function updateInstallment(supabase: SupabaseClientType, installmentId: string, data: Partial<Installment>) {
  const result = await supabase.from('installments').update(data as Record<string, unknown>).eq('id', installmentId);
  return result as unknown as { error: Error | null };
}

export async function updateTenant(supabase: SupabaseClientType, tenantId: string, data: Partial<Tenant>) {
  const result = await supabase.from('tenants').update(data as Record<string, unknown>).eq('id', tenantId);
  return result as unknown as { error: Error | null };
}

export async function updateUserProfile(supabase: SupabaseClientType, userId: string, data: Partial<UserProfile>) {
  const result = await supabase.from('user_profiles').update(data as Record<string, unknown>).eq('id', userId);
  return result as unknown as { error: Error | null };
}

export async function updatePasskey(supabase: SupabaseClientType, passkeyId: string, data: Partial<Passkey>) {
  const result = await supabase.from('passkeys').update(data as Record<string, unknown>).eq('id', passkeyId);
  return result as unknown as { error: Error | null };
}

export async function insertPayment(supabase: SupabaseClientType, data: Partial<Payment>) {
  const result = await supabase.from('payments').insert(data as Record<string, unknown>);
  return result as unknown as { error: Error | null };
}

export async function insertPlan(supabase: SupabaseClientType, data: Partial<Plan>) {
  const result = await supabase.from('plans').insert(data as Record<string, unknown>).select().single();
  return result as unknown as QueryResult<Plan>;
}

export async function insertInstallments(supabase: SupabaseClientType, data: Partial<Installment>[]) {
  const result = await supabase.from('installments').insert(data as Record<string, unknown>[]);
  return result as unknown as { error: Error | null };
}

export async function insertPortfolio(supabase: SupabaseClientType, data: Partial<Portfolio>) {
  const result = await supabase.from('portfolios').insert(data as Record<string, unknown>).select().single();
  return result as unknown as QueryResult<Portfolio>;
}

export async function updatePortfolio(supabase: SupabaseClientType, portfolioId: string, data: Partial<Portfolio>) {
  const result = await supabase.from('portfolios').update(data as Record<string, unknown>).eq('id', portfolioId);
  return result as unknown as { error: Error | null };
}

export async function insertPasskey(supabase: SupabaseClientType, data: Partial<Passkey>) {
  const result = await supabase.from('passkeys').insert(data as Record<string, unknown>);
  return result as unknown as { error: Error | null };
}

export async function insertAuditLog(supabase: SupabaseClientType, data: Partial<AuditLogEntry>) {
  const result = await supabase.from('audit_log').insert(data as Record<string, unknown>);
  return result as unknown as { error: Error | null };
}

export async function getInstallmentsForPlan(supabase: SupabaseClientType, planId: string) {
  const result = await supabase.from('installments').select('*').eq('plan_id', planId);
  return result as unknown as QueryArrayResult<Installment>;
}
