// Local browser fixture imports actual consumers; no editor, carousel or PDF library is mocked.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import TiptapEditor from '../../../src/components/admin/TiptapEditor';
import PromoSlider from '../../../src/components/PromoSlider';
import { OrderDetail } from '../../../src/components/admin/orders/OrderDetail';
import type { AdminOrderDetail } from '../../../src/domain/adminOrders';
import '../../../src/index.css';
import '../../../src/i18n-config';

const content = '<h2>Edición sintética ñ</h2><p><strong>Consola</strong> <em>clásica</em> <u>garantía</u> <span style="color: #ff0000">Rojo</span><br>línea</p><ul><li><p>Accesorio</p></li></ul><ol><li><p>Manual</p></li></ol><blockquote><p>Cita</p></blockquote><pre><code>const x = 1</code></pre><p><code>código</code></p><p><s>Tachado</s></p><hr><p>Final</p>';
const order: AdminOrderDetail = {
  id: 'DEPENDENCY-SYNTHETIC-1', historical: false,
  customer: { name: 'José Pérez', email: 'synthetic@example.invalid', phone: '00000000' },
  createdAt: 1, createdAtState: 'verified', total: 100, currency: 'UYU', paymentStatus: 'pending',
  inventoryState: 'reserved', reservedUntil: 2, releasedAt: null, committedAt: null,
  lastVerifiedAt: null, nextCheckAt: null, attention: null, delivery: 'shipping',
  shipping: { address: 'Av. Ñandú 123', address2: 'Apto. 4', city: 'Montevideo', department: 'Montevideo', postalCode: '11000' },
  shippingCost: 0, items: [{ title: 'Consola sintética', variant: '', quantity: 1, unitPrice: 100 }],
  itemsTruncated: false, paymentId: null, paymentDeadline: 2, lastVerificationFailedAt: null,
  reconciliation: { state: null, lastProgressAt: null, lastError: null, coverageUntil: null },
};

export function EditorFixture({ styled }: { styled: boolean }) {
  const [serialized, setSerialized] = useState('');
  const [remounted, setRemounted] = useState(false);
  return <main className="bg-white text-black p-4">
    <TiptapEditor key={String(remounted)} content={remounted ? serialized : content} onChange={setSerialized} withDefaultStyles={styled} />
    <output data-testid="editor-output" hidden>{serialized}</output>
    <button type="button" onClick={() => setRemounted(true)}>Reload serialized content</button>
  </main>;
}

const parameters = new URLSearchParams(window.location.search);
const mode = parameters.get('mode');
const container = document.getElementById('dependency-fixture');
if (!container) throw new Error('Local dependency fixture container missing');
createRoot(container).render(mode === 'editor'
  ? <EditorFixture styled={parameters.get('styled') === 'true'} />
  : mode === 'promo'
    ? <BrowserRouter><PromoSlider /></BrowserRouter>
    : mode === 'label'
      ? <OrderDetail id={order.id} order={order} loading={false} error={null} onClose={() => undefined} onRetry={() => undefined} />
      : <p>Unknown synthetic fixture</p>);
