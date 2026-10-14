-- CuotaPro Seed Data
-- Demo data for testing and development

-- Note: This seed file assumes you have already run the migrations
-- and have a user created through Supabase Auth.
-- After creating a user, get their UUID and replace the placeholder below.

-- Example: Create a demo tenant
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
  'distribuidorabemberg',
  'Distribuidora Bemberg',
  'BEMBERG.MP',
  '0000003100000000000001',
  '30-12345678-9',
  'Av. Corrientes 1234, CABA',
  '+54 11 4567-8901',
  'contacto@distribuidorabemberg.com.ar',
  0,
  3,
  0.001,
  0.30,
  'Acepto recibir recordatorios de pago por WhatsApp según la Ley 25.326 de Protección de Datos Personales.'
) ON CONFLICT (id) DO NOTHING;

-- Create demo portfolios
INSERT INTO portfolios (id, tenant_id, name, description, is_active) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Electrodomésticos', 'Venta de electrodomésticos en cuotas', true),
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'Servicios Profesionales', 'Honorarios y servicios', true),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'Alquileres', 'Planes de alquiler', true)
ON CONFLICT (id) DO NOTHING;

-- Create demo clients
INSERT INTO clients (id, tenant_id, portfolio_id, dni_cuit, full_name, email, phone, address, whatsapp_opt_in) VALUES
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '20345678', 'María González', 'maria.gonzalez@email.com', '+54 11 2345-6789', 'Belgrano 567, CABA', true),
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '30456789', 'Juan Rodríguez', 'juan.rodriguez@email.com', '+54 11 3456-7890', 'San Martín 890, Lanús', true),
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', '20-34567890-1', 'Ana Martínez', 'ana.martinez@empresa.com', '+54 11 4567-8901', 'Rivadavia 1234, CABA', false),
  ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000001', NULL, '40567890', 'Carlos López', 'carlos.lopez@gmail.com', '+54 11 5678-9012', 'Mitre 456, Avellaneda', true)
ON CONFLICT (id) DO NOTHING;

-- Note: Plans and installments should be created through the application
-- to ensure proper calculation of interest rates and CFT.

-- Create some audit log entries for demo
INSERT INTO audit_log (tenant_id, action, entity_type, new_data) VALUES
  ('00000000-0000-0000-0000-000000000001', 'portfolio_created', 'portfolio', '{"name": "Electrodomésticos"}'),
  ('00000000-0000-0000-0000-000000000001', 'portfolio_created', 'portfolio', '{"name": "Servicios Profesionales"}'),
  ('00000000-0000-0000-0000-000000000001', 'client_created', 'client', '{"full_name": "María González"}'),
  ('00000000-0000-0000-0000-000000000001', 'client_created', 'client', '{"full_name": "Juan Rodríguez"}'),
  ('00000000-0000-0000-0000-000000000001', 'client_created', 'client', '{"full_name": "Ana Martínez"}')
ON CONFLICT DO NOTHING;
