import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Términos y Condiciones | CuotaPro',
  description: 'Términos y condiciones de uso de CuotaPro by POTENCIAPP',
};

export default function TermsPage() {
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
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Términos y Condiciones</h1>
          <p className="text-sm text-gray-500 mb-8">Última actualización: Octubre 2026</p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">1. Aceptación de los Términos</h2>
            <p className="text-gray-600">
              Al acceder y utilizar CuotaPro (&ldquo;el Servicio&rdquo;), operado por POTENCIAPP (&ldquo;nosotros&rdquo;, &ldquo;nuestro&rdquo;), 
              aceptás estar sujeto a estos Términos y Condiciones. Si no estás de acuerdo con alguna parte de 
              estos términos, no podrás utilizar el Servicio.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">2. Descripción del Servicio</h2>
            <p className="text-gray-600">
              CuotaPro es una plataforma de gestión de cobros en cuotas que permite a comercios y negocios:
            </p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li>Crear y administrar planes de financiación para sus clientes</li>
              <li>Registrar pagos y controlar el estado de las cuotas</li>
              <li>Generar comprobantes y recibos de pago</li>
              <li>Enviar recordatorios de vencimiento</li>
            </ul>
            <p className="text-gray-600 mt-4 font-medium">
              IMPORTANTE: POTENCIAPP no recibe ni distribuye fondos. No somos una entidad financiera 
              ni otorgamos préstamos. El Servicio es únicamente una herramienta de gestión administrativa.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">3. Registro y Cuenta</h2>
            <p className="text-gray-600">
              Para utilizar el Servicio debés crear una cuenta proporcionando información veraz y actualizada. 
              Sos responsable de mantener la confidencialidad de tu contraseña y de todas las actividades 
              que ocurran bajo tu cuenta.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">4. Uso Aceptable</h2>
            <p className="text-gray-600">Te comprometés a:</p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li>Utilizar el Servicio solo para fines legales y de acuerdo con las leyes argentinas</li>
              <li>No utilizar el Servicio para actividades fraudulentas o ilegales</li>
              <li>Cumplir con la Ley 24.240 de Defensa del Consumidor en tus operaciones</li>
              <li>Respetar los derechos de tus clientes y proporcionar información clara sobre financiación</li>
              <li>Obtener el consentimiento adecuado para el envío de comunicaciones vía WhatsApp</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">5. Propiedad Intelectual</h2>
            <p className="text-gray-600">
              El Servicio y su contenido original, características y funcionalidad son propiedad de 
              POTENCIAPP y están protegidos por leyes de propiedad intelectual de Argentina y tratados internacionales.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">6. Limitación de Responsabilidad</h2>
            <p className="text-gray-600">
              POTENCIAPP no será responsable por daños indirectos, incidentales, especiales, consecuentes 
              o punitivos que resulten del uso o la imposibilidad de usar el Servicio. El Servicio se 
              proporciona &ldquo;tal cual&rdquo; sin garantías de ningún tipo.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">7. Modificaciones</h2>
            <p className="text-gray-600">
              Nos reservamos el derecho de modificar estos términos en cualquier momento. Te notificaremos 
              de cualquier cambio publicando los nuevos términos en esta página y actualizando la fecha de 
              &ldquo;última actualización&rdquo;.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">8. Ley Aplicable</h2>
            <p className="text-gray-600">
              Estos términos se regirán e interpretarán de acuerdo con las leyes de la República Argentina, 
              sin tener en cuenta sus disposiciones sobre conflictos de leyes. Cualquier disputa será 
              sometida a la jurisdicción de los tribunales ordinarios de la Ciudad Autónoma de Buenos Aires.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900">9. Contacto</h2>
            <p className="text-gray-600">
              Para consultas sobre estos términos, podés contactarnos en:{' '}
              <a href="mailto:legal@potenciapp.com" className="text-blue-600 hover:underline">
                legal@potenciapp.com
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
