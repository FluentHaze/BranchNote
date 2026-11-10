import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  lang?: string;
}

interface Props<T extends string> {
  options: readonly SelectOption<T>[];
  value: T;
  onChange(value: T): void;
  label: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  icon?: ReactNode;
}

// Uses the desktop app's popover/listbox pattern, with website-specific styling.
export default function Select<T extends string>({ options, value, onChange, label, id, disabled, className = "", icon }: Props<T>) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function dismiss(event: Event) {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      menu.current?.hidePopover();
    }
    window.addEventListener("wheel", dismiss, { capture: true, passive: true });
    window.addEventListener("touchmove", dismiss, { capture: true, passive: true });
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("wheel", dismiss, true);
      window.removeEventListener("touchmove", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  function close() {
    menu.current?.hidePopover();
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  function show(last = false) {
    const button = trigger.current!;
    const panel = menu.current!;
    const rect = button.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, className === "language" ? 180 : 190), window.innerWidth - 24);
    const left = className === "language" ? rect.right - width : rect.left;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const useAbove = below < 180 && above > below;
    Object.assign(panel.style, {
      width: `${width}px`,
      left: `${Math.max(12, Math.min(left, window.innerWidth - width - 12))}px`,
      top: useAbove ? "auto" : `${rect.bottom + 7}px`,
      bottom: useAbove ? `${window.innerHeight - rect.top + 7}px` : "auto",
      maxHeight: `${Math.min(320, (useAbove ? above : below) - 7)}px`,
    });
    panel.showPopover();
    setOpen(true);
    const buttons = panel.querySelectorAll<HTMLButtonElement>('[role="option"]');
    const selectedIndex = options.findIndex(option => option.value === value);
    buttons[last ? buttons.length - 1 : selectedIndex]?.focus({ preventScroll: true });
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    const index = buttons.findIndex(button => button === document.activeElement);
    let next: number;
    switch (event.key) {
      case "ArrowDown": next = (index + 1) % buttons.length; break;
      case "ArrowUp": next = (index + buttons.length - 1) % buttons.length; break;
      case "Home": next = 0; break;
      case "End": next = buttons.length - 1; break;
      case "Escape": event.preventDefault(); close(); return;
      case "Tab": close(); return;
      default: return;
    }
    event.preventDefault();
    buttons[next]?.focus();
  }

  return (
    <span className={`custom-select ${className}`}>
      <button
        id={id}
        ref={trigger}
        type="button"
        className="select-trigger"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => open ? close() : show()}
        onKeyDown={event => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          show(event.key === "ArrowUp");
        }}
      >
        {icon && <span className="select-leading-icon" aria-hidden="true">{icon}</span>}
        <span className="select-value">{options.find(option => option.value === value)?.label}</span>
        <ChevronDown className="select-chevron" size={14} strokeWidth={1.6} aria-hidden="true" />
      </button>
      <div ref={menu} className={`select-menu ${className ? `${className}-menu` : ""}`} popover="auto" onToggle={event => setOpen(event.newState === "open")} onKeyDown={navigate}>
        <div id={listId} role="listbox" aria-label={label}>
          {options.map(option => (
            <button
              type="button"
              role="option"
              key={option.value}
              aria-selected={option.value === value}
              tabIndex={-1}
              lang={option.lang}
              onClick={() => { onChange(option.value); close(); }}
            >
              <span>{option.label}</span>
              {option.value === value && <Check className="option-check" size={15} strokeWidth={1.7} aria-hidden="true" />}
            </button>
          ))}
        </div>
      </div>
    </span>
  );
}
