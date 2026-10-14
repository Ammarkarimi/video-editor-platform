import { AlertTriangle, Check, CloudOff, Download, Keyboard, Loader2 } from 'lucide-react';
import { Button, IconButton } from '../ui/Button';
import { Logo } from '../ui/misc';
import { Link } from '../router';
import { saveNow } from './hooks/useAutosave';
import { useEditor } from './store/editorStore';

function SaveIndicator() {
  const saveState = useEditor((s) => s.saveState);
  const saveError = useEditor((s) => s.saveError);
  switch (saveState) {
    case 'saved':
      return (
        <span className="flex items-center gap-1.5 text-xs text-dim" data-testid="save-state">
          <Check size={13} /> Saved
        </span>
      );
    case 'saving':
      return (
        <span className="flex items-center gap-1.5 text-xs text-dim" data-testid="save-state">
          <Loader2 size={13} className="animate-spin" /> Saving…
        </span>
      );
    case 'dirty':
      return (
        <span className="text-xs text-dim" data-testid="save-state">
          Unsaved changes
        </span>
      );
    case 'error':
      return (
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300"
          title={saveError ?? undefined}
          onClick={() => void saveNow(false)}
        >
          <CloudOff size={13} /> Offline — retry
        </button>
      );
    case 'conflict':
      return (
        <span
          className="flex items-center gap-2 text-xs text-amber-400"
          title={saveError ?? undefined}
        >
          <AlertTriangle size={13} /> Changed elsewhere
          <button
            type="button"
            className="underline hover:text-amber-300"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          <button
            type="button"
            className="underline hover:text-amber-300"
            onClick={() => void saveNow(true)}
          >
            Overwrite
          </button>
        </span>
      );
  }
}

export function TopBar() {
  const projectName = useEditor((s) => s.projectName);
  const activeRenders = useEditor(
    (s) =>
      s.renders.filter(
        (r) => r.status === 'queued' || r.status === 'rendering' || r.status === 'finalizing',
      ).length,
  );
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <Link
        href="/"
        className="flex items-center gap-2 rounded-md pr-1 hover:opacity-90"
        title="Back to projects"
      >
        <Logo size={26} />
        <span className="text-[14px] font-bold tracking-tight">Cutroom</span>
      </Link>
      <span className="text-dim">/</span>
      <h1 className="max-w-[320px] truncate text-[13px] font-medium" data-testid="project-title">
        {projectName}
      </h1>
      <SaveIndicator />
      <div className="flex-1" />
      <IconButton
        label="Keyboard shortcuts (?)"
        onClick={() => useEditor.setState({ shortcutsOpen: true })}
      >
        <Keyboard size={16} />
      </IconButton>
      <Button
        variant="primary"
        icon={
          activeRenders > 0 ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Download size={14} />
          )
        }
        onClick={() => useEditor.setState({ exportOpen: true })}
        data-testid="open-export"
      >
        {activeRenders > 0 ? `Exporting (${activeRenders})` : 'Export'}
      </Button>
    </header>
  );
}
