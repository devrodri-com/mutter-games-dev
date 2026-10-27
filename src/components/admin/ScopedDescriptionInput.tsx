import { useState } from 'react';
import { inertDescription } from '../../../api/_lib/catalog-edit-fields';
import TiptapEditor from './TiptapEditor';
import { publicationDescriptionEditable, publicationDescriptionText } from './publication-description';

/** Legacy unsupported HTML stays visible and byte-preserved until deliberately
 * edited. It must not pass through Tiptap's schema normalization implicitly. */
export default function ScopedDescriptionInput({ initial, value, label, disabled, onChange }: {
  initial: string; value: string; label: string; disabled: boolean; onChange: (value: string) => void;
}) {
  const legacyFormat = !inertDescription(initial);
  const [editingLegacy, setEditingLegacy] = useState(false);
  return <div>
    <p className="mb-2 text-sm font-medium">{label}</p>
    {disabled || (legacyFormat && !editingLegacy)
      ? <div role="region" aria-label={`${label} guardada`} className="min-h-[100px] whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm leading-6 text-gray-700">{publicationDescriptionText(value) || 'Sin descripción'}</div>
      : <TiptapEditor label={label} content={legacyFormat && value === initial ? publicationDescriptionEditable(value) : value} onChange={onChange} withDefaultStyles basicFormatting />}
    {legacyFormat && !editingLegacy && !disabled && <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => setEditingLegacy(true)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium">Editar {label.toLocaleLowerCase()}</button>
      <p className="max-w-xl text-xs text-gray-500">El formato original se conserva al guardar otros campos. Si cambiás esta descripción, se guardará con formato básico.</p>
    </div>}
  </div>;
}
