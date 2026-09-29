import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import type { AdminOrderDetail } from '../../../domain/adminOrders';

async function logo(): Promise<string> {
  const response = await fetch('/logo-etiqueta.png');
  if (!response.ok) throw new Error('No pudimos cargar el logo de la etiqueta.');
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('El logo de la etiqueta no es válido.'));
    reader.onerror = () => reject(new Error('No pudimos leer el logo de la etiqueta.'));
    reader.readAsDataURL(blob);
  });
}
/** Labels reproduce shipping details only; printing never changes payment or stock. */
export async function printOrderLabel(order: AdminOrderDetail): Promise<void> {
  const [image, qr] = await Promise.all([logo(), QRCode.toDataURL(`ID-${order.id}`)]);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'in', format: [4, 6] });
  pdf.setDrawColor(200); pdf.rect(0.2, 0.2, 5.6, 3.6);
  pdf.setFontSize(14); pdf.setFont('helvetica', 'bold'); pdf.text('Etiqueta de Envío', 3, 0.6, { align: 'center' });
  pdf.addImage(image, 'PNG', 0.4, 1.0, 1.6, 1.6);
  pdf.setFontSize(10);
  let y = 1;
  for (const [label, value] of [
    ['Orden', order.id], ['Nombre', order.customer.name], ['Teléfono', order.customer.phone],
    ['Dirección', [order.shipping.address, order.shipping.address2].filter(Boolean).join(', ')],
    ['Ciudad', order.shipping.city], ['Departamento', order.shipping.department], ['Código Postal', order.shipping.postalCode],
  ]) {
    pdf.setFont('helvetica', 'bold'); pdf.text(`${label}:`, 2.15, y);
    pdf.setFont('helvetica', 'normal'); pdf.text(value || '-', 3.05, y, { maxWidth: 2.45 }); y += 0.35;
  }
  pdf.addImage(qr, 'PNG', 5.0, 2.8, 0.8, 0.8);
  pdf.save(`Etiqueta-${order.id}.pdf`);
}
