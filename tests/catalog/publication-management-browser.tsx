import { createRoot } from 'react-dom/client';
import PublicationList from '../../src/components/admin/publication-list';
import Sidebar from '../../src/components/admin/Sidebar';
import '../../src/index.css';

// The components and clients are production code. The runner supplies only
// synthetic identity, Firestore SDK and HTTP boundaries and forbids real network.
export function Fixture() {
  return <div className="flex min-h-screen flex-col bg-gray-50 md:flex-row">
    <Sidebar activeView="productList" onChangeView={() => {}} />
    <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
      <p className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Las compras siguen cerradas. Podés abrir, editar y crear publicaciones; guardar cambios conserva el estado de las publicaciones existentes.</p>
      <PublicationList />
    </main>
  </div>;
}
const container = document.getElementById('root');
if (!container) throw new Error('Missing local fixture root');
createRoot(container).render(<Fixture />);
