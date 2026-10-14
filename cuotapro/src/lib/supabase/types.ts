export interface TenantUserResult {
  tenant_id: string;
  tenants?: {
    id: string;
    name: string;
    slug: string;
    cbu_alias: string | null;
    cbu: string | null;
    cuit: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    default_grace_days: number;
    default_penalty_rate: number;
    max_penalty_cap: number;
  };
}
