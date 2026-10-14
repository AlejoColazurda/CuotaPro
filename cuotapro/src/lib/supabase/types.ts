import type { Tenant, Plan, Installment, Client, Payment, Portfolio, Passkey, UserProfile } from '@/types/database';

export interface TenantUserResult {
  tenant_id: string;
  tenants?: Tenant;
}

export interface TenantUserWithTenant {
  tenant_id: string;
  tenants: Tenant;
}

export interface PlanWithRelations extends Plan {
  clients: Client;
  installments: Installment[];
  payments: Payment[];
}

export type { Tenant, Plan, Installment, Client, Payment, Portfolio, Passkey, UserProfile };

export interface SupabaseQueryResult<T> {
  data: T | null;
  error: Error | null;
}
