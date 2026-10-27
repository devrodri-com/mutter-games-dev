import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import MutterSelect, { type MutterSelectOption } from '../../src/components/admin/MutterSelect';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

async function mount(element: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(element));
}
function button(): HTMLButtonElement {
  const label = [...document.querySelectorAll<HTMLLabelElement>('label')].find(element => element.textContent === 'Categoría');
  const element = label?.closest('.mutter-select')?.querySelector<HTMLButtonElement>('button');
  if (!element) throw new Error('Missing labeled selection button');
  return element;
}
function option(label: string): HTMLElement {
  const element = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === label);
  if (!element) throw new Error(`Missing option: ${label}`);
  return element;
}
async function open() {
  await act(async () => button().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })));
  for (let count = 0; count < 30 && !document.querySelector('[role="listbox"]'); count++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  expect(document.querySelector('[role="listbox"]')).not.toBeNull();
}
const choices: MutterSelectOption[] = [
  { value: '', label: 'Elegir categoría', disabled: true },
  { value: 'consolas', label: 'Consolas' },
  { value: 'juegos', label: 'Juegos' },
];

test('mount preserves a controlled historical value without emitting a change', async () => {
  const onChange = vi.fn();
  await mount(<MutterSelect label="Categoría" value="legado" options={[{ value: 'legado', label: 'Categoría actual conservada' }, ...choices]}
    onChange={onChange} />);
  expect(button().textContent).toBe('Categoría actual conservada');
  expect(onChange).not.toHaveBeenCalled();
  expect(document.querySelector('select')).toBeNull();
  await act(async () => root?.render(<MutterSelect label="Categoría" value="legado" options={choices} onChange={onChange} />));
  expect(button().textContent).toBe('legado');
  expect(onChange).not.toHaveBeenCalled();
});

test('a real enabled selection emits its exact value once and reflects the controlled result', async () => {
  const onChange = vi.fn();
  function Owner() {
    const [value, setValue] = useState('consolas');
    return <MutterSelect label="Categoría" hideLabel value={value} options={choices}
      onChange={next => { onChange(next); setValue(next); }} />;
  }
  await mount(<Owner />);
  expect(button().textContent).toBe('Consolas');
  expect(onChange).not.toHaveBeenCalled();
  await open();
  await act(async () => option('Juegos').click());
  expect(onChange.mock.calls).toEqual([['juegos']]);
  expect(button().textContent).toBe('Juegos');
  expect(document.querySelector('[role="listbox"]')).toBeNull();
});

test('disabled selection cannot open or emit even inside a disabled fieldset', async () => {
  const onChange = vi.fn();
  await mount(<fieldset disabled><MutterSelect label="Categoría" value="consolas" options={choices} disabled onChange={onChange} /></fieldset>);
  expect(button().disabled).toBe(true);
  await act(async () => button().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })));
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  expect(button().textContent).toBe('Consolas');
});

test('the disabled placeholder remains visible and cannot replace a deliberate selection', async () => {
  const onChange = vi.fn();
  await mount(<MutterSelect label="Categoría" value="" options={choices} onChange={onChange} />);
  expect(button().textContent).toBe('Elegir categoría');
  expect(onChange).not.toHaveBeenCalled();
  await open();
  const placeholder = option('Elegir categoría');
  expect(placeholder.getAttribute('aria-disabled')).toBe('true');
  await act(async () => placeholder.click());
  expect(onChange).not.toHaveBeenCalled();
  expect(button().textContent).toBe('Elegir categoría');
  await act(async () => option('Consolas').click());
  expect(onChange.mock.calls).toEqual([['consolas']]);
  // The owner has not changed its value; the component cannot select implicitly.
  expect(button().textContent).toBe('Elegir categoría');
});

 test('choosing the current value is a no-op, matching native selection semantics', async () => {
  const changed = vi.fn();
  await mount(<MutterSelect label="Categoría" value="cat" options={[{value:'cat',label:'Consolas'},{value:'other',label:'Accesorios'}]} onChange={changed} />);
  await open();
  const current = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent?.trim() === 'Consolas');
  if (!current) throw new Error('Missing current option');
  await act(async () => current.click());
  expect(changed).not.toHaveBeenCalled();
 });
