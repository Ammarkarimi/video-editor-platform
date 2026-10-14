import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export type MenuEntry = MenuItem | 'separator';

export interface MenuProps {
  /** Viewport coordinates of the anchor point. */
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

/** A floating menu used for context menus and overflow buttons. */
export function Menu({ x, y, items, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[60] min-w-[190px] animate-pop-in rounded-lg border border-line bg-panel-2 p-1 shadow-xl shadow-black/50"
      style={position}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        item === 'separator' ? (
          <div key={`sep-${index}`} className="my-1 h-px bg-line" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={clsx(
              'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] disabled:opacity-40',
              item.danger ? 'text-red-400 hover:bg-danger/15' : 'text-fg hover:bg-panel-3',
            )}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span className="flex w-4 justify-center text-muted">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.shortcut && <span className="text-[11px] text-dim">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** Small helper hook for context menus: `open(event, items)` and render `{menu}`. */
export function useContextMenu() {
  const [state, setState] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const open = (
    event: { clientX: number; clientY: number; preventDefault?: () => void },
    items: MenuEntry[],
  ) => {
    event.preventDefault?.();
    setState({ x: event.clientX, y: event.clientY, items });
  };
  const menu = state ? (
    <Menu x={state.x} y={state.y} items={state.items} onClose={() => setState(null)} />
  ) : null;
  return { open, menu, close: () => setState(null) };
}
