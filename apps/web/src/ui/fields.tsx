import clsx from 'clsx';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

const clampValue = (v: number, min?: number, max?: number) =>
  Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, v));

export interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Multiplier applied for display (e.g. 100 to show 0..1 as a percentage). */
  displayScale?: number;
  precision?: number;
  suffix?: string;
  /** Text/icon shown to the left; dragging it scrubs the value. */
  label?: ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
  testId?: string;
}

/** Numeric input with drag-to-scrub label, arrow-key stepping and validation on commit. */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  displayScale = 1,
  precision = 0,
  suffix,
  label,
  className,
  disabled,
  title,
  testId,
}: NumberFieldProps) {
  const format = (v: number) => {
    const shown = v * displayScale;
    return Number.isFinite(shown) ? String(Number(shown.toFixed(precision))) : '';
  };
  const [text, setText] = useState(format(value));
  const [focused, setFocused] = useState(false);
  const scrub = useRef<{ x: number; start: number } | null>(null);

  useEffect(() => {
    if (!focused) setText(format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused, displayScale, precision]);

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw.replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      setText(format(value));
      return;
    }
    const next = clampValue(parsed / displayScale, min, max);
    if (next !== value) onChange(next);
    setText(format(next));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commit(text);
      (event.target as HTMLInputElement).blur();
    } else if (event.key === 'Escape') {
      setText(format(value));
      (event.target as HTMLInputElement).blur();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const delta = (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1);
      const next = clampValue(value + delta, min, max);
      onChange(next);
      setText(format(next));
    }
    event.stopPropagation();
  };

  const onScrubDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    scrub.current = { x: event.clientX, start: value };
  };
  const onScrubMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!scrub.current) return;
    const factor = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
    const delta = ((event.clientX - scrub.current.x) / 2) * step * factor;
    const raw = scrub.current.start + delta;
    const snapped =
      Math.round(raw / (step * (event.altKey ? 0.1 : 1))) * step * (event.altKey ? 0.1 : 1);
    const next = clampValue(Number(snapped.toFixed(6)), min, max);
    if (next !== value) onChange(next);
  };
  const onScrubUp = () => {
    scrub.current = null;
  };

  return (
    <div
      className={clsx(
        'flex h-7 min-w-0 items-center rounded-md border border-line bg-panel-2 focus-within:border-accent',
        disabled && 'opacity-50',
        className,
      )}
      title={title}
    >
      {label !== undefined && (
        <span
          className="flex h-full shrink-0 cursor-ew-resize items-center pr-1 pl-2 text-[11px] text-dim select-none hover:text-muted"
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
        >
          {label}
        </span>
      )}
      <input
        className="h-full w-full min-w-0 bg-transparent px-2 text-right text-xs text-fg tabular-nums outline-none"
        value={text}
        disabled={disabled}
        data-testid={testId}
        inputMode="decimal"
        onChange={(event) => setText(event.target.value)}
        onFocus={(event) => {
          setFocused(true);
          event.target.select();
        }}
        onBlur={() => {
          setFocused(false);
          commit(text);
        }}
        onKeyDown={onKeyDown}
      />
      {suffix && <span className="pr-2 text-[11px] text-dim select-none">{suffix}</span>}
    </div>
  );
}

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 0.01,
  disabled,
  className,
  ...rest
}: SliderProps) {
  const fill = ((clampValue(value, min, max) - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className={clsx('slider', className)}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={rest['aria-label']}
      style={{ ['--fill' as string]: `${fill}%` }}
      onChange={(event) => onChange(Number(event.target.value))}
      onKeyDown={(event) => event.stopPropagation()}
    />
  );
}

/** Slider with a compact numeric readout. */
export function SliderField(
  props: SliderProps & { displayScale?: number; precision?: number; suffix?: string },
) {
  const { displayScale = 1, precision = 0, suffix, ...slider } = props;
  return (
    <div className="flex items-center gap-2">
      <Slider {...slider} className="flex-1" />
      <NumberField
        className="w-16"
        value={slider.value}
        onChange={slider.onChange}
        min={slider.min}
        max={slider.max}
        step={slider.step}
        displayScale={displayScale}
        precision={precision}
        suffix={suffix}
        disabled={slider.disabled}
      />
    </div>
  );
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export interface ColorFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Show an opacity control (stores #RRGGBBAA). */
  alpha?: boolean;
}

export function ColorField({ value, onChange, alpha }: ColorFieldProps) {
  const hex6 = value.slice(0, 7);
  const a = value.length === 9 ? parseInt(value.slice(7, 9), 16) / 255 : 1;
  const [text, setText] = useState(hex6);
  useEffect(() => setText(hex6), [hex6]);

  const emit = (nextHex6: string, nextAlpha: number) => {
    if (!alpha) {
      onChange(nextHex6.toLowerCase());
      return;
    }
    const aa = Math.round(Math.min(1, Math.max(0, nextAlpha)) * 255)
      .toString(16)
      .padStart(2, '0');
    onChange(`${nextHex6.toLowerCase()}${aa}`);
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        type="color"
        className="swatch shrink-0"
        value={hex6}
        onChange={(event) => emit(event.target.value, a)}
        aria-label="Pick color"
      />
      <input
        className="h-7 w-[76px] min-w-0 rounded-md border border-line bg-panel-2 px-2 font-mono text-[11px] text-fg uppercase outline-none focus:border-accent"
        value={text}
        maxLength={7}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => (HEX6.test(text) ? emit(text, a) : setText(hex6))}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
      />
      {alpha && (
        <NumberField
          className="w-[68px]"
          value={a}
          onChange={(next) => emit(hex6, next)}
          min={0}
          max={1}
          step={0.01}
          displayScale={100}
          suffix="%"
          title="Opacity"
        />
      )}
    </div>
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={clsx('relative min-w-0', className)}>
      <select
        className="h-7 w-full min-w-0 appearance-none rounded-md border border-line bg-panel-2 pr-7 pl-2 text-xs text-fg outline-none focus:border-accent"
        onKeyDown={(event) => event.stopPropagation()}
        {...props}
      >
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute top-1.5 right-2 text-dim" />
    </div>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        'h-8 w-full min-w-0 rounded-md border border-line bg-panel-2 px-2.5 text-[13px] text-fg outline-none placeholder:text-dim focus:border-accent',
        className,
      )}
      onKeyDown={(event) => {
        event.stopPropagation();
        props.onKeyDown?.(event);
      }}
      {...props}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-[18px] w-8 shrink-0 rounded-full transition-colors',
        checked ? 'bg-accent' : 'bg-line-2',
      )}
    >
      <span
        className={clsx(
          'absolute top-[2px] left-0 h-[14px] w-[14px] rounded-full bg-white transition-transform',
          checked ? 'translate-x-[16px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={clsx('flex h-7 rounded-md border border-line bg-panel-2 p-0.5', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={clsx(
            'flex flex-1 items-center justify-center rounded-[5px] px-2 text-xs transition-colors',
            option.value === value ? 'bg-panel-3 text-fg shadow-sm' : 'text-muted hover:text-fg',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A labelled row in the inspector. */
export function Field({
  label,
  children,
  hint,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="grid min-h-7 grid-cols-[84px_minmax(0,1fr)] items-center gap-2" title={hint}>
      <span className="truncate text-xs text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Section({
  title,
  children,
  actions,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line">
      <div className="flex h-9 items-center gap-1 px-3">
        <button
          type="button"
          className="flex flex-1 items-center gap-1.5 text-left text-[11px] font-semibold tracking-wide text-muted uppercase hover:text-fg"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {title}
        </button>
        {actions}
      </div>
      {open && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </section>
  );
}
