import { Field, Label, Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import { Check, ChevronDown } from 'lucide-react';
import './admin-visual.css';

export type MutterSelectOption = { value: string; label: string; disabled?: boolean };
export type MutterSelectProps = {
  label: string;
  value: string;
  options: readonly MutterSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  className?: string;
};

/** Presentation only: the owner retains the value and decides what a selection changes. */
export default function MutterSelect({ label, value, options, onChange, disabled = false,
  hideLabel = false, className = '' }: MutterSelectProps) {
  const selected = options.find(option => option.value === value);
  return <Field disabled={disabled} className={`mutter-select ${className}`}>
    <Label className={`mutter-select__label${hideLabel ? ' sr-only' : ''}`}>{label}</Label>
    <Listbox value={value} disabled={disabled} onChange={next => { if (!disabled && next !== value) onChange(next); }}>
      <ListboxButton type="button" className="mutter-select__button">
        <span className="mutter-select__value">{selected?.label ?? value}</span>
        <ChevronDown className="mutter-select__chevron" aria-hidden="true" />
      </ListboxButton>
      <ListboxOptions anchor="bottom start" portal className="mutter-select__options">
        {options.map((option, index) => <ListboxOption key={`${option.value}:${index}`} value={option.value}
          disabled={option.disabled} className="mutter-select__option">
          {({ selected: isSelected }) => <><span>{option.label}</span>
            {isSelected && <Check className="mutter-select__check" aria-hidden="true" />}</>}
        </ListboxOption>)}
      </ListboxOptions>
    </Listbox>
  </Field>;
}
