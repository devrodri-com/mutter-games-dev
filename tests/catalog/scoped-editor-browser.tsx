import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ScopedCatalogEditor from '../../src/components/admin/ScopedCatalogEditor';
import { openCatalogEdit, reopenSupersededCatalogEdit, saveCatalogEdit, type CatalogEditOpen } from '../../src/utils/catalogEditClient';
import '../../src/index.css';

function Fixture() {
  const [opened, setOpened] = useState<CatalogEditOpen | null>(null);
  const [result, setResult] = useState('');
  return <main className="min-h-screen bg-gray-100 p-6">
    <h1 className="mb-4 text-xl">Publicaciones — prueba local</h1>
    <button onClick={() => { void openCatalogEdit('publication').then(setOpened); }} className="rounded bg-white px-4 py-2">Editar</button>
    <p role="status">{result}</p>
    {opened && <ScopedCatalogEditor key={opened.document.version} mode="scoped" initial={opened}
      categories={[{ id: 'cat', name: 'Juegos', subcategories: [{ id: 'sub', name: 'Consolas', categoryId: 'cat' }] }]}
      onClose={() => setOpened(null)} onReopen={async () => { setOpened(await reopenSupersededCatalogEdit('publication')); }}
      onSave={async (document, changes) => { await saveCatalogEdit(document, changes); setResult('Guardado y comprobado'); setOpened(null); }} />}
  </main>;
}
const container = document.getElementById('root');
if (!container) throw new Error('Missing local fixture root');
createRoot(container).render(<Fixture />);
