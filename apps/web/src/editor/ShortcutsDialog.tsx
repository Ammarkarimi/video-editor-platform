import { Dialog } from '../ui/Dialog';
import { Kbd } from '../ui/misc';
import { SHORTCUTS } from './hooks/useKeyboardShortcuts';
import { useEditor } from './store/editorStore';

export function ShortcutsDialog() {
  const open = useEditor((s) => s.shortcutsOpen);
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  return (
    <Dialog
      open={open}
      onClose={() => useEditor.setState({ shortcutsOpen: false })}
      title="Keyboard shortcuts"
      width="max-w-2xl"
    >
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        {groups.map((group) => (
          <div key={group}>
            <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-dim uppercase">
              {group}
            </h3>
            <ul className="space-y-1.5">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <li key={s.description} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted">{s.description}</span>
                  <span className="flex shrink-0 gap-1">
                    {s.keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
