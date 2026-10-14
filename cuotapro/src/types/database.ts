export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type UserRole = 'owner' | 'merchant';
export type PlanStatus = 'draft' | 'active' | 'completed' | 'cancelled';
export type PaymentStatus = 'pending' | 'partial' | 'paid' | 'overdue';
export type InterestType = 'fixed_surcharge' | 'direct_rate' | 'french' | 'zero_interest';
export type AuditAction = 
  | 'plan_created' | 'plan_activated' | 'plan_cancelled'
  | 'payment_recorded' | 'payment_deleted'
  | 'installment_edited' | 'client_created' | 'client_updated'
  | 'portfolio_created' | 'settings_updated' | 'user_login' | 'user_logout'
  | 'two_factor_enabled' | 'two_factor_disabled' | 'passkey_registered';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  cbu_alias: string | null;
  cbu: string | null;
  cuit: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  fee_bps: number;
  default_grace_days: number;
  default_penalty_rate: number;
  max_penalty_cap: number;
  whatsapp_opt_in_text: string;
  privacy_policy_url: string | null;
  terms_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantUser {
  id: string;
  tenant_id: string;
  user_id: string;
  role: UserRole;
  created_at: string;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  totp_secret: string | null;
  totp_enabled: boolean;
  totp_verified_at: string | null;
  recovery_codes: string[] | null;
  failed_login_attempts: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface Passkey {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  device_type: string | null;
  transports: string[] | null;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export interface Portfolio {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  tenant_id: string;
  portfolio_id: string | null;
  dni_cuit: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  whatsapp_opt_in: boolean;
  created_at: string;
  updated_at: string;
}

export interface Plan {
  id: string;
  tenant_id: string;
  portfolio_id: string | null;
  client_id: string;
  status: PlanStatus;
  description: string;
  cash_price_cents: number;
  admin_fee_cents: number;
  financed_amount_cents: number;
  total_amount_cents: number;
  num_installments: number;
  interest_type: InterestType;
  interest_rate: number;
  tna: number;
  tea: number;
  cft: number;
  grace_days: number;
  penalty_rate: number;
  penalty_cap: number;
  art36_document_url: string | null;
  art36_accepted_at: string | null;
  activated_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Installment {
  id: string;
  plan_id: string;
  number: number;
  due_date: string;
  principal_cents: number;
  interest_cents: number;
  admin_fee_cents: number;
  total_cents: number;
  paid_cents: number;
  penalty_cents: number;
  status: PaymentStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  tenant_id: string;
  plan_id: string;
  installment_id: string;
  amount_cents: number;
  penalty_paid_cents: number;
  payment_method: string | null;
  reference: string | null;
  notes: string | null;
  receipt_url: string | null;
  recorded_by: string;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  tenant_id: string | null;
  user_id: string | null;
  action: AuditAction | string;
  entity_type: string | null;
  entity_id: string | null;
  old_data: Json | null;
  new_data: Json | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface ApiKey {
  id: string;
  tenant_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  device_info: string | null;
  ip_address: string | null;
  last_active_at: string;
  created_at: string;
  expires_at: string;
}

type TableConfig<T> = {
  Row: T;
  Insert: Partial<T> & Record<string, unknown>;
  Update: Partial<T> & Record<string, unknown>;
  Relationships: unknown[];
};

export interface Database {
  public: {
    Tables: {
      tenants: TableConfig<Tenant>;
      tenant_users: TableConfig<TenantUser>;
      user_profiles: TableConfig<UserProfile>;
      passkeys: TableConfig<Passkey>;
      portfolios: TableConfig<Portfolio>;
      clients: TableConfig<Client>;
      plans: TableConfig<Plan>;
      installments: TableConfig<Installment>;
      payments: TableConfig<Payment>;
      audit_log: TableConfig<AuditLogEntry>;
      api_keys: TableConfig<ApiKey>;
      sessions: TableConfig<Session>;
    };
    Views: Record<string, never>;
    Functions: {
      calculate_installment_penalty: {
        Args: { installment_id: string };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
