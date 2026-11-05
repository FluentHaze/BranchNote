import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";

interface Option {
  value: string;
  label: string;
}
interface Props {
  options: Option[];
  value?: string;
  defaultValue?: string;
  onChange?(value: string): void;
  name?: string;
  label: string;
  disabled?: boolean;
  className?: string;
}

export default function Select({
  options,
  value,
  defaultValue,
  onChange,
  name,
  label,
  disabled,
  className = "",
}: Props) {
  const [internal, setInternal] = useState(
    defaultValue ?? options[0]?.value ?? "",
  );
  const selected = value ?? internal;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const listId = useId();
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target))
        return;
      panel.current?.hidePopover();
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);
  function close(focus = true) {
    panel.current?.hidePopover();
    if (focus) trigger.current?.focus();
  }
  function show(last = false) {
    const button = trigger.current!;
    const menu = panel.current!;
    const rect = button.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 210), window.innerWidth - 24);
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const useAbove = below < 180 && above > below;
    menu.style.maxHeight = `${Math.min(300, useAbove ? above - 6 : below - 6)}px`;
    menu.style.top = useAbove ? "auto" : `${rect.bottom + 6}px`;
    menu.style.bottom = useAbove
      ? `${window.innerHeight - rect.top + 6}px`
      : "auto";
    menu.showPopover();
    const buttons = menu.querySelectorAll<HTMLButtonElement>('[role="option"]');
    const index = options.findIndex((option) => option.value === selected);
    buttons[last ? buttons.length - 1 : Math.max(index, 0)]?.focus();
  }
  function keydown(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = [
      ...panel.current!.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = index;
    if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowUp")
      next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    } else if (event.key === "Tab") {
      close();
      return;
    } else if (event.key === " ") {
      return;
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const found = options.findIndex(
        (option, i) =>
          i > index &&
          option.label.toLowerCase().startsWith(event.key.toLowerCase()),
      );
      next =
        found >= 0
          ? found
          : options.findIndex((option) =>
              option.label.toLowerCase().startsWith(event.key.toLowerCase()),
            );
    } else return;
    event.preventDefault();
    buttons[next]?.focus();
  }
  return (
    <span className={`custom-select ${className}`}>
      {name && <input type="hidden" name={name} value={selected} />}
      <button
        ref={trigger}
        type="button"
        className="select-trigger"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        disabled={disabled || !options.length}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show(event.key === "ArrowUp");
          }
        }}
      >
        <span>
          {options.find((option) => option.value === selected)?.label ||
            "请选择"}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div
        ref={panel}
        id={listId}
        popover="auto"
        role="listbox"
        aria-label={label}
        className="select-menu"
        onToggle={(event) => setOpen(event.newState === "open")}
        onKeyDown={keydown}
      >
        {options.map((option) => (
          <button
            type="button"
            role="option"
            key={option.value}
            aria-selected={option.value === selected}
            tabIndex={-1}
            onClick={() => {
              setInternal(option.value);
              onChange?.(option.value);
              close();
            }}
          >
            <span>{option.label}</span>
            {option.value === selected && (
              <Check size={15} aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
    </span>
  );
}
