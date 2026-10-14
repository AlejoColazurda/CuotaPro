# CuotaPro - Sistema de Cobro en Cuotas

Sistema de gestión de cobros en cuotas para comercios argentinos. Permite crear planes de financiación, gestionar clientes, registrar pagos y enviar recordatorios por WhatsApp.

## Características

### Core v1 (Owner Mode)
- **Gestión de Clientes**: DNI/CUIT, teléfono, email, opt-in para WhatsApp
- **Carteras**: Organización de clientes y planes por proyecto/negocio
- **Simulador de Financiación**:
  - Recargo Fijo Total (%)
  - Tasa Mensual Directa
  - Sistema Francés (cuota fija)
  - Sin Interés (0%)
- **Indicadores Ley 24.240 art. 36**: TNA, TEA, CFT automáticos
- **Planes Inmutables**: Las cuotas no pueden editarse una vez activado el plan
- **Pagos**: Totales y parciales con registro de punitorios
- **Punitorios**: Días de gracia configurables y tope máximo
- **Recibos PDF**: Generación automática de comprobantes
- **WhatsApp**: Recordatorios con Alias/CBU via wa.me
- **Dashboard de Mora**: Estadísticas y cuotas vencidas
- **Exportación CSV**: Clientes, planes y cuotas
- **Registro de Auditoría**: Historial completo de acciones

### Autenticación Completa
- Email + contraseña con validación
- Mostrar/ocultar contraseña
- Recuperación por email
- Passkeys/WebAuthn (Face ID, Touch ID, biométricos)
- TOTP 2FA completo (enroll, verify, challenge, disable)
- Códigos de recuperación (10 códigos, uso único)
- Rate limiting y bloqueo de cuenta
- Gestión de sesiones

### Cumplimiento Legal
- **Ley 24.240**: Documento de condiciones con TNA, TEA, CFT
- **Ley 25.326**: Consentimiento explícito para datos y WhatsApp
- **Sin intermediación de fondos**: El dinero va directo del deudor al merchant

### Multi-tenant
- Diseño multi-tenant desde el inicio
- RLS (Row Level Security) en todas las tablas
- Roles: owner (fee_bps=0) y merchant (configurable)

## Stack Técnico

- **Frontend**: Next.js 15 (App Router), TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL, Auth, RLS, Storage)
- **Componentes**: Radix UI primitives con estilos personalizados
- **PDF**: jsPDF
- **Testing**: Vitest
- **Deploy**: Vercel

## Requisitos Previos

- Node.js 18+
- npm 8+
- Cuenta de Supabase
- Cuenta de Vercel (para deploy)

## Instalación Local

### 1. Clonar el repositorio

```bash
git clone <repository-url>
cd cuotapro
npm install
```

### 2. Configurar Supabase

1. Crear un nuevo proyecto en [Supabase](https://supabase.com)
2. Ir a SQL Editor y ejecutar el contenido de `supabase/migrations/001_initial_schema.sql`
3. (Opcional) Ejecutar `supabase/seed.sql` para datos de ejemplo

### 3. Configurar variables de entorno

Crear archivo `.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# WebAuthn (para passkeys)
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:3000
```

### 4. Ejecutar en desarrollo

```bash
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000)

## Deploy en Vercel

### 1. Configurar proyecto en Vercel

1. Importar el repositorio en Vercel
2. Configurar las siguientes variables de entorno:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# WebAuthn para demo.potenciapp.com
WEBAUTHN_RP_ID=demo.potenciapp.com
WEBAUTHN_ORIGIN=https://demo.potenciapp.com
```

### 2. Configurar dominio

Si vas a usar `demo.potenciapp.com`:

1. En Vercel, ir a Settings > Domains
2. Agregar `demo.potenciapp.com`
3. Configurar DNS en tu proveedor

### 3. Configurar Supabase Auth

1. En Supabase Dashboard > Authentication > URL Configuration
2. Agregar `https://demo.potenciapp.com` a Site URL
3. Agregar `https://demo.potenciapp.com/**` a Redirect URLs

## Rutas de Tenant

La aplicación soporta rutas por tenant:

- `demo.potenciapp.com/web/distribuidorabemberg` - Portal del tenant "distribuidorabemberg"

El slug del tenant se define al crear la cuenta y no puede cambiarse.

## WebAuthn / Passkeys

Para que los passkeys funcionen correctamente:

1. El dominio debe usar HTTPS (excepto localhost)
2. `WEBAUTHN_RP_ID` debe coincidir con el dominio base
3. `WEBAUTHN_ORIGIN` debe ser la URL completa con https://

Ejemplo para producción:
```env
WEBAUTHN_RP_ID=demo.potenciapp.com
WEBAUTHN_ORIGIN=https://demo.potenciapp.com
```

## Pruebas

```bash
# Ejecutar tests
npm run test

# Ejecutar tests una vez
npm run test:run
```

## Estructura del Proyecto

```
cuotapro/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (auth)/            # Páginas de autenticación
│   │   ├── (protected)/       # Páginas protegidas (dashboard, etc)
│   │   ├── api/               # API Routes
│   │   └── web/[tenant]/      # Portal de tenants
│   ├── components/
│   │   ├── ui/                # Componentes UI base
│   │   └── layout/            # Layout components
│   ├── lib/
│   │   ├── amortization/      # Motor de cálculo de cuotas
│   │   ├── pdf/               # Generación de PDFs
│   │   ├── supabase/          # Clientes Supabase
│   │   └── utils/             # Utilidades
│   └── types/                 # TypeScript types
├── supabase/
│   ├── migrations/            # Migraciones SQL
│   └── seed.sql               # Datos de ejemplo
└── tests/
    └── unit/                  # Tests unitarios
```

## Motor de Amortización

El motor soporta 4 tipos de cálculo:

1. **Recargo Fijo Total**: `total = precio * (1 + recargo%)`
2. **Tasa Directa**: `interés = precio * tasa_mensual * n_cuotas`
3. **Sistema Francés**: Cuota fija con amortización compuesta
4. **Sin Interés**: `cuota = precio / n_cuotas`

Todos los cálculos incluyen:
- TNA (Tasa Nominal Anual)
- TEA (Tasa Efectiva Anual)
- CFT (Costo Financiero Total) - incluye cargo administrativo

El CFT se calcula usando TIR (Tasa Interna de Retorno) para cumplir con Ley 24.240.

## Lo que Funciona

- ✅ Autenticación completa (email, passkeys)
- ✅ TOTP 2FA end-to-end (enroll, verify, challenge, disable)
- ✅ Códigos de recuperación 2FA
- ✅ Rate limiting en login, signup, recovery, 2FA
- ✅ Bloqueo de cuenta por intentos fallidos
- ✅ CRUD de clientes con validación
- ✅ CRUD de carteras
- ✅ Simulador de planes con TNA/TEA/CFT
- ✅ Creación de planes en borrador
- ✅ Edición de cuotas en borrador
- ✅ Activación de planes (inmutabilidad)
- ✅ Registro de pagos totales/parciales
- ✅ Cálculo de punitorios
- ✅ Recordatorios WhatsApp (wa.me)
- ✅ Dashboard con estadísticas
- ✅ Exportación CSV
- ✅ Registro de auditoría
- ✅ UI responsive mobile-first
- ✅ Estados de carga/vacío/error
- ✅ Confirmaciones en acciones destructivas
- ✅ Generación de PDFs (recibos y art. 36)
- ✅ GitHub Actions CI (lint, typecheck, tests, build)

## Lo que Necesita Credenciales del Owner

- **Supabase**: URL y Anon Key del proyecto
- **Dominio**: Configuración DNS para demo.potenciapp.com
- **Email SMTP**: Para que funcione la recuperación de contraseña
  - Configurar en Supabase > Authentication > Email Templates

## Gaps Conocidos

1. **Split de Mercado Pago**: Detrás de feature flag, no implementado
2. **Merchant onboarding**: Preparado pero no implementado

## Seguridad

- Contraseñas: mínimo 8 caracteres, mayúscula, minúscula, número
- RLS habilitado en todas las tablas
- Los datos monetarios se almacenan en centavos (integer)
- Audit log de todas las acciones sensibles
- Passkeys como alternativa segura a contraseñas

## Licencia

Propietario - POTENCIAPP
