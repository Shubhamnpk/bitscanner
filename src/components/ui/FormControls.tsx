import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface SelectFieldProps<T extends string> {
  value: T;
  options: Array<SelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  id?: string;
  className?: string;
}

interface MenuPlacement {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

/**
 * Styled listbox that replaces the browser-native <select> so the control looks
 * and feels identical on Android, iOS and desktop. The menu renders in a portal
 * with the highest stacking order, so card overflow and page sections can never
 * clip it.
 */
export function SelectField<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  id,
  className = '',
}: SelectFieldProps<T>) {
  const autoId = useId();
  const fieldId = id || autoId;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menu, setMenu] = useState<MenuPlacement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex >= 0 ? selectedIndex : 0];

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const margin = 6;
    const viewportPadding = 8;
    const spaceBelow = window.innerHeight - rect.bottom - margin - viewportPadding;
    const spaceAbove = rect.top - margin - viewportPadding;
    const openUpwards = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(280, openUpwards ? spaceAbove : spaceBelow));
    const width = Math.min(Math.max(rect.width, 180), window.innerWidth - viewportPadding * 2);
    const left = Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - width - viewportPadding);

    setMenu({
      left,
      width,
      maxHeight,
      ...(openUpwards
        ? { bottom: window.innerHeight - rect.top + margin }
        : { top: rect.bottom + margin }),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const handleReflow = () => updatePosition();
    window.addEventListener('resize', handleReflow);
    window.addEventListener('scroll', handleReflow, true);
    return () => {
      window.removeEventListener('resize', handleReflow);
      window.removeEventListener('scroll', handleReflow, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const openList = () => {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    updatePosition();
    setOpen(true);
  };

  const closeList = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  const choose = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    closeList(true);
  };

  const handleButtonKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => Math.min(options.length - 1, index + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => Math.max(0, index - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(activeIndex);
        break;
      case 'Escape':
        event.preventDefault();
        closeList();
        break;
      case 'Tab':
        closeList();
        break;
      default:
        break;
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        ref={buttonRef}
        id={fieldId}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${fieldId}-listbox`}
        aria-activedescendant={open ? `${fieldId}-option-${activeIndex}` : undefined}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={handleButtonKeyDown}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-left text-sm font-medium text-slate-800 transition-colors hover:border-slate-300 focus:border-teal-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/20 cursor-pointer"
      >
        <span className="truncate">{selected?.label}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {open &&
        menu &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            id={`${fieldId}-listbox`}
            aria-label={ariaLabel}
            style={{
              position: 'fixed',
              left: menu.left,
              width: menu.width,
              maxHeight: menu.maxHeight,
              ...(menu.top !== undefined ? { top: menu.top } : { bottom: menu.bottom }),
            }}
            className="z-[9999] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-2xl shadow-slate-900/20"
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <button
                  key={option.value}
                  type="button"
                  id={`${fieldId}-option-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  data-index={index}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(index)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm cursor-pointer ${
                    isActive ? 'bg-teal-50 text-teal-950' : 'text-slate-700'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{option.label}</span>
                    {option.hint && (
                      <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                        {option.hint}
                      </span>
                    )}
                  </span>
                  {isSelected && (
                    <Check className="h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  testId?: string;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  ariaLabel,
  testId,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    data-testid={testId}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-[26px] w-[46px] shrink-0 items-center rounded-full border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${
      checked ? 'border-teal-600 bg-teal-600' : 'border-slate-300 bg-slate-200'
    }`}
  >
    <span
      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
        checked ? 'translate-x-[23px]' : 'translate-x-[2px]'
      }`}
      aria-hidden="true"
    />
  </button>
);
