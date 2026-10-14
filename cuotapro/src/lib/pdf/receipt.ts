import { jsPDF } from 'jspdf';
import { formatCurrency, formatPercentage } from '@/lib/amortization/engine';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Plan, Client, Installment, Payment, Tenant } from '@/types/database';

interface ReceiptData {
  tenant: Tenant;
  client: Client;
  plan: Plan;
  installment: Installment;
  payment: Payment;
}

export function generatePaymentReceipt(data: ReceiptData): jsPDF {
  const { tenant, client, plan, installment, payment } = data;
  const doc = new jsPDF();

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 20;

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(tenant.name, pageWidth / 2, y, { align: 'center' });

  y += 10;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  if (tenant.cuit) {
    doc.text(`CUIT: ${tenant.cuit}`, pageWidth / 2, y, { align: 'center' });
    y += 6;
  }
  if (tenant.address) {
    doc.text(tenant.address, pageWidth / 2, y, { align: 'center' });
    y += 6;
  }

  y += 10;
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('RECIBO DE PAGO', pageWidth / 2, y, { align: 'center' });

  y += 15;
  doc.setDrawColor(200);
  doc.line(20, y, pageWidth - 20, y);

  y += 15;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  doc.text(`Fecha: ${format(new Date(payment.created_at), 'dd/MM/yyyy HH:mm', { locale: es })}`, 20, y);
  doc.text(`Recibo N°: ${payment.id.slice(0, 8).toUpperCase()}`, pageWidth - 70, y);

  y += 15;
  doc.setFont('helvetica', 'bold');
  doc.text('CLIENTE', 20, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.text(`Nombre: ${client.full_name}`, 20, y);
  y += 6;
  doc.text(`DNI/CUIT: ${client.dni_cuit}`, 20, y);
  if (client.address) {
    y += 6;
    doc.text(`Domicilio: ${client.address}`, 20, y);
  }

  y += 15;
  doc.setFont('helvetica', 'bold');
  doc.text('DETALLE DEL PAGO', 20, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.text(`Descripción: ${plan.description}`, 20, y);
  y += 6;
  doc.text(`Cuota N°: ${installment.number} de ${plan.num_installments}`, 20, y);
  y += 6;
  doc.text(`Vencimiento: ${format(new Date(installment.due_date), 'dd/MM/yyyy', { locale: es })}`, 20, y);

  y += 15;
  doc.setDrawColor(200);
  doc.line(20, y, pageWidth - 20, y);
  y += 10;

  const leftCol = 20;
  const rightCol = pageWidth - 70;

  doc.text('Monto de la Cuota:', leftCol, y);
  doc.text(formatCurrency(installment.total_cents), rightCol, y, { align: 'right' });

  y += 8;
  if (payment.penalty_paid_cents > 0) {
    doc.text('Punitorios:', leftCol, y);
    doc.text(formatCurrency(payment.penalty_paid_cents), rightCol, y, { align: 'right' });
    y += 8;
  }

  doc.setFont('helvetica', 'bold');
  doc.text('IMPORTE RECIBIDO:', leftCol, y);
  doc.setFontSize(14);
  doc.text(formatCurrency(payment.amount_cents + payment.penalty_paid_cents), rightCol, y, { align: 'right' });

  y += 15;
  doc.setFontSize(10);
  doc.setDrawColor(200);
  doc.line(20, y, pageWidth - 20, y);

  y += 15;
  doc.setFont('helvetica', 'normal');
  if (payment.payment_method) {
    doc.text(`Forma de Pago: ${payment.payment_method}`, 20, y);
    y += 6;
  }
  if (payment.reference) {
    doc.text(`Referencia: ${payment.reference}`, 20, y);
    y += 6;
  }

  y += 20;
  doc.setFontSize(8);
  doc.setTextColor(128);
  doc.text(
    'Este recibo es válido como comprobante de pago. Conserve este documento.',
    pageWidth / 2,
    y,
    { align: 'center' }
  );

  y += 15;
  doc.text(
    `Generado por CuotaPro - ${format(new Date(), 'dd/MM/yyyy HH:mm', { locale: es })}`,
    pageWidth / 2,
    y,
    { align: 'center' }
  );

  return doc;
}

interface Art36DisclosureData {
  tenant: Tenant;
  client: Client;
  plan: Plan;
  installments: { number: number; dueDate: Date; totalCents: number }[];
}

export function generateArt36Disclosure(data: Art36DisclosureData): jsPDF {
  const { tenant, client, plan, installments } = data;
  const doc = new jsPDF();

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 20;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('INFORMACIÓN AL CONSUMIDOR', pageWidth / 2, y, { align: 'center' });
  y += 6;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Ley 24.240 - Artículo 36', pageWidth / 2, y, { align: 'center' });

  y += 15;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(tenant.name, pageWidth / 2, y, { align: 'center' });

  y += 15;
  doc.setDrawColor(0);
  doc.line(20, y, pageWidth - 20, y);

  y += 12;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('DATOS DEL PROVEEDOR', 20, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  if (tenant.cuit) { doc.text(`CUIT: ${tenant.cuit}`, 20, y); y += 5; }
  if (tenant.address) { doc.text(`Domicilio: ${tenant.address}`, 20, y); y += 5; }
  if (tenant.phone) { doc.text(`Teléfono: ${tenant.phone}`, 20, y); y += 5; }

  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.text('DATOS DEL CONSUMIDOR', 20, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.text(`Nombre: ${client.full_name}`, 20, y); y += 5;
  doc.text(`DNI/CUIT: ${client.dni_cuit}`, 20, y); y += 5;
  if (client.address) { doc.text(`Domicilio: ${client.address}`, 20, y); y += 5; }

  y += 10;
  doc.setDrawColor(0);
  doc.line(20, y, pageWidth - 20, y);

  y += 10;
  doc.setFont('helvetica', 'bold');
  doc.text('CONDICIONES DE LA FINANCIACIÓN', 20, y);

  y += 10;
  doc.setFont('helvetica', 'normal');

  const col1 = 20;
  const col2 = 110;

  doc.text(`Descripción: ${plan.description}`, col1, y);
  y += 8;

  doc.text('Precio de Contado:', col1, y);
  doc.text(formatCurrency(plan.cash_price_cents), col2, y);
  y += 6;

  if (plan.admin_fee_cents > 0) {
    doc.text('Cargo Administrativo:', col1, y);
    doc.text(formatCurrency(plan.admin_fee_cents), col2, y);
    y += 6;
  }

  doc.text('Saldo Financiado:', col1, y);
  doc.text(formatCurrency(plan.financed_amount_cents), col2, y);
  y += 6;

  doc.text('Total de Intereses:', col1, y);
  doc.text(formatCurrency(plan.total_amount_cents - plan.cash_price_cents - plan.admin_fee_cents), col2, y);
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.text('Monto Total a Pagar:', col1, y);
  doc.text(formatCurrency(plan.total_amount_cents), col2, y);
  y += 10;

  doc.setFont('helvetica', 'normal');
  doc.text('Cantidad de Cuotas:', col1, y);
  doc.text(plan.num_installments.toString(), col2, y);
  y += 6;

  doc.text('Sistema de Amortización:', col1, y);
  const systemLabels: Record<string, string> = {
    fixed_surcharge: 'Recargo Fijo',
    direct_rate: 'Tasa Directa',
    french: 'Sistema Francés',
    zero_interest: 'Sin Interés',
  };
  doc.text(systemLabels[plan.interest_type] || plan.interest_type, col2, y);
  y += 10;

  doc.setFont('helvetica', 'bold');
  doc.setFillColor(255, 255, 200);
  doc.rect(20, y - 3, pageWidth - 40, 25, 'F');
  doc.text('TASAS E INDICADORES', 25, y + 5);
  y += 12;
  doc.setFont('helvetica', 'normal');
  doc.text(`TNA (Tasa Nominal Anual): ${formatPercentage(plan.tna)}`, 25, y);
  y += 5;
  doc.text(`TEA (Tasa Efectiva Anual): ${formatPercentage(plan.tea)}`, 25, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text(`CFT (Costo Financiero Total): ${formatPercentage(plan.cft)}`, 25, y);

  y += 15;
  doc.setFont('helvetica', 'bold');
  doc.text('CRONOGRAMA DE PAGOS', 20, y);

  y += 8;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('N°', 25, y);
  doc.text('Vencimiento', 45, y);
  doc.text('Importe', 100, y);

  y += 5;
  doc.line(20, y, pageWidth - 20, y);

  y += 5;
  doc.setFont('helvetica', 'normal');

  const maxRows = Math.min(installments.length, 12);
  for (let i = 0; i < maxRows; i++) {
    const inst = installments[i];
    doc.text(inst.number.toString(), 25, y);
    doc.text(format(inst.dueDate, 'dd/MM/yyyy', { locale: es }), 45, y);
    doc.text(formatCurrency(inst.totalCents), 100, y);
    y += 5;
  }

  if (installments.length > maxRows) {
    doc.text(`... y ${installments.length - maxRows} cuotas más`, 25, y);
    y += 5;
  }

  y += 10;
  doc.setFontSize(8);
  doc.text(`Días de gracia: ${plan.grace_days}`, 20, y);
  y += 4;
  doc.text(`Interés punitorio: ${formatPercentage(plan.penalty_rate * 100)} diario (máx. ${formatPercentage(plan.penalty_cap * 100)})`, 20, y);

  y += 15;
  doc.setFontSize(7);
  doc.setTextColor(100);
  const disclaimer = 
    'El presente documento se emite en cumplimiento del Art. 36 de la Ley 24.240 de Defensa del Consumidor. ' +
    'El consumidor tiene derecho a solicitar aclaraciones y a recibir una copia de este documento. ' +
    'Ante cualquier incumplimiento, puede presentar su reclamo ante la autoridad de aplicación.';
  
  const lines = doc.splitTextToSize(disclaimer, pageWidth - 40);
  doc.text(lines, 20, y);

  y += lines.length * 4 + 15;

  doc.setFontSize(9);
  doc.setTextColor(0);
  doc.text('_______________________________', 40, y);
  doc.text('_______________________________', pageWidth - 90, y);
  y += 5;
  doc.text('Firma del Proveedor', 50, y);
  doc.text('Firma del Consumidor', pageWidth - 80, y);

  y += 10;
  doc.setFontSize(8);
  doc.text(`Fecha: ${format(new Date(), 'dd/MM/yyyy', { locale: es })}`, 20, y);

  return doc;
}
