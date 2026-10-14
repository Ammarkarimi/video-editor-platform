import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { create } from 'zustand';

type ToastKind = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(kind, message) {
    const id = nextId++;
    set({ toasts: [...get().toasts.slice(-3), { id, kind, message }] });
    window.setTimeout(() => get().dismiss(id), kind === 'error' ? 7000 : 3500);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export const toast = {
  info: (message: string) => useToasts.getState().push('info', message),
  success: (message: string) => useToasts.getState().push('success', message),
  error: (message: string) => useToasts.getState().push('error', message),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const ICONS = {
  info: <Info size={16} className="text-sky-400" />,
  success: <CheckCircle2 size={16} className="text-success" />,
  error: <AlertTriangle size={16} className="text-danger" />,
};

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-[70] flex w-[340px] flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={clsx(
            'pointer-events-auto flex animate-pop-in items-start gap-2.5 rounded-lg border bg-panel-2 px-3 py-2.5 text-[13px] shadow-xl shadow-black/40',
            t.kind === 'error' ? 'border-danger/40' : 'border-line',
          )}
        >
          <span className="mt-0.5">{ICONS[t.kind]}</span>
          <span className="flex-1 leading-snug text-fg">{t.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="text-dim hover:text-fg"
            onClick={() => dismiss(t.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
