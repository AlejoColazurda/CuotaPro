-- CuotaPro Seed Data
-- Demo data for testing and development

-- Note: This seed file assumes you have already run the migrations
-- and have a user created through Supabase Auth.
-- After creating a user, get their UUID and replace the placeholder below.

-- Example: Create a demo tenant
-- Replace with your own data after setup
INSERT INTO tenants (
  id,
  slug,
  name,
  cbu_alias,
  cbu,
  cuit,
  address,
  phone,
  email,
  fee_bps,
  default_grace_days,
  default_penalty_rate,
  max_penalty_cap,
  whatsapp_opt_in_text
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'mi-comercio',
  'Mi Comercio',
  'MI.COMERCIO.MP',
  '0000003100000000000001',
  '30-12345678-9',
  'Av. Corrientes 1234, CABA',
  '+54 11 4567-8901',
  'contacto@mi-comercio.com.ar',
  0,
  3,
  0.001,
  0.30,
  'Acepto recibir recordatorios de pago por WhatsApp según la Ley 25.326 de Protección de Datos Personales.'
) ON CONFLICT (id) DO NOTHING;

-- Example portfolios (optional - create your own in the app)
INSERT INTO portfolios (id, tenant_id, name, description, is_active) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Ventas', 'Ventas en cuotas', true),
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'Servicios', 'Servicios profesionales', true)
ON CONFLICT (id) DO NOTHING;

-- Note: Clients, plans, and installments should be created through the application
-- to ensure proper calculation of interest rates and CFT.
-- Do not seed customer data - create it via the UI after setup.
