import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Política de Privacidad | CuotaPro',
  description: 'Política de privacidad y protección de datos personales de CuotaPro by POTENCIAPP',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <Link 
          href="/login" 
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-8"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver
        </Link>
        
        <div className="bg-white rounded-lg shadow-sm p-8 prose prose-blue max-w-none">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Política de Privacidad</h1>
          <p className="text-sm text-gray-500 mb-8">Última actualización: Octubre 2026</p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">1. Introducción</h2>
            <p className="text-gray-600">
              POTENCIAPP (&ldquo;nosotros&rdquo;, &ldquo;nuestro&rdquo;) se compromete a proteger la privacidad de los usuarios 
              de CuotaPro. Esta política describe cómo recopilamos, usamos y protegemos tu información 
              personal de acuerdo con la Ley 25.326 de Protección de Datos Personales de la República Argentina.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">2. Responsable del Tratamiento</h2>
            <p className="text-gray-600">
              El responsable del tratamiento de los datos personales es POTENCIAPP, con domicilio en 
              la Ciudad Autónoma de Buenos Aires, República Argentina.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">3. Datos que Recopilamos</h2>
            <p className="text-gray-600">Recopilamos los siguientes tipos de información:</p>
            
            <h3 className="text-lg font-medium text-gray-800 mt-4">3.1 Datos de Usuarios (Comercios)</h3>
            <ul className="list-disc pl-6 text-gray-600 space-y-1">
              <li>Nombre completo y email</li>
              <li>Nombre del negocio</li>
              <li>CUIT/CUIL (opcional)</li>
              <li>Datos de contacto (teléfono, dirección)</li>
              <li>Información de autenticación</li>
            </ul>

            <h3 className="text-lg font-medium text-gray-800 mt-4">3.2 Datos de Clientes (ingresados por los Usuarios)</h3>
            <ul className="list-disc pl-6 text-gray-600 space-y-1">
              <li>Nombre completo</li>
              <li>DNI/CUIT</li>
              <li>Datos de contacto</li>
              <li>Información de planes de pago y transacciones</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">4. Finalidad del Tratamiento</h2>
            <p className="text-gray-600">Utilizamos los datos personales para:</p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li>Proveer y mantener el Servicio</li>
              <li>Gestionar tu cuenta y autenticación</li>
              <li>Procesar y administrar planes de pago</li>
              <li>Enviar comunicaciones relacionadas con el Servicio</li>
              <li>Cumplir con obligaciones legales</li>
              <li>Mejorar nuestros servicios</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">5. Base Legal del Tratamiento</h2>
            <p className="text-gray-600">
              El tratamiento de datos se realiza con base en:
            </p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li>Tu consentimiento al registrarte y aceptar estos términos</li>
              <li>La ejecución de la relación contractual de uso del Servicio</li>
              <li>Nuestros intereses legítimos de mejorar el Servicio</li>
              <li>El cumplimiento de obligaciones legales aplicables</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">6. Comunicaciones vía WhatsApp</h2>
            <p className="text-gray-600">
              El envío de recordatorios y notificaciones vía WhatsApp requiere el consentimiento expreso 
              de los clientes finales (opt-in). Como usuario del Servicio, sos responsable de:
            </p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li>Obtener el consentimiento de tus clientes antes de enviar mensajes</li>
              <li>Informar a tus clientes sobre cómo revocar su consentimiento</li>
              <li>Respetar las solicitudes de baja de comunicaciones</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">7. Seguridad de los Datos</h2>
            <p className="text-gray-600">
              Implementamos medidas de seguridad técnicas y organizativas apropiadas para proteger 
              tus datos personales, incluyendo:
            </p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li>Cifrado de datos en tránsito y en reposo</li>
              <li>Autenticación segura con opciones de 2FA</li>
              <li>Acceso restringido mediante Row Level Security (RLS)</li>
              <li>Auditoría de accesos y operaciones</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">8. Tus Derechos (Ley 25.326)</h2>
            <p className="text-gray-600">
              De acuerdo con la Ley 25.326 de Protección de Datos Personales, tenés derecho a:
            </p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li><strong>Acceso:</strong> Conocer qué datos personales tenemos sobre vos</li>
              <li><strong>Rectificación:</strong> Corregir datos inexactos o incompletos</li>
              <li><strong>Supresión:</strong> Solicitar la eliminación de tus datos</li>
              <li><strong>Confidencialidad:</strong> Que tus datos sean tratados confidencialmente</li>
            </ul>
            <p className="text-gray-600 mt-4">
              Para ejercer estos derechos, contactanos en{' '}
              <a href="mailto:privacidad@potenciapp.com" className="text-blue-600 hover:underline">
                privacidad@potenciapp.com
              </a>
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">9. Retención de Datos</h2>
            <p className="text-gray-600">
              Conservamos tus datos personales mientras mantengas una cuenta activa o según sea 
              necesario para cumplir con obligaciones legales (como requisitos fiscales y contables). 
              Los datos de transacciones se conservan por el período legal requerido.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">10. Transferencias Internacionales</h2>
            <p className="text-gray-600">
              Tus datos pueden ser procesados en servidores ubicados fuera de Argentina. En estos casos, 
              nos aseguramos de que existan las garantías adecuadas de protección de datos según la 
              normativa vigente.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">11. Cookies y Tecnologías Similares</h2>
            <p className="text-gray-600">
              Utilizamos cookies esenciales para el funcionamiento del Servicio (autenticación, 
              preferencias de sesión). No utilizamos cookies de seguimiento publicitario.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">12. Cambios a esta Política</h2>
            <p className="text-gray-600">
              Podemos actualizar esta política periódicamente. Te notificaremos sobre cambios 
              significativos mediante un aviso en el Servicio o por email.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">13. Autoridad de Control</h2>
            <p className="text-gray-600">
              Podés presentar una denuncia ante la Agencia de Acceso a la Información Pública (AAIP) 
              si considerás que el tratamiento de tus datos personales infringe la normativa vigente.
            </p>
            <p className="text-gray-600 mt-2">
              Sitio web:{' '}
              <a 
                href="https://www.argentina.gob.ar/aaip" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                www.argentina.gob.ar/aaip
              </a>
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">14. Contacto</h2>
            <p className="text-gray-600">
              Para consultas sobre esta política de privacidad o el tratamiento de tus datos:{' '}
              <a href="mailto:privacidad@potenciapp.com" className="text-blue-600 hover:underline">
                privacidad@potenciapp.com
              </a>
            </p>
          </section>

          <div className="mt-12 pt-8 border-t border-gray-200">
            <p className="text-sm text-gray-500 text-center">
              © {new Date().getFullYear()} POTENCIAPP. Todos los derechos reservados.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
