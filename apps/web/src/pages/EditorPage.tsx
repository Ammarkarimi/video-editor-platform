import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { uploadFiles } from '../editor/actions';
import { ExportDialog } from '../editor/ExportDialog';
import { saveNow, useAutosave } from '../editor/hooks/useAutosave';
import { useKeyboardShortcuts } from '../editor/hooks/useKeyboardShortcuts';
import { useProjectEvents } from '../editor/hooks/useProjectEvents';
import { Inspector } from '../editor/inspector/Inspector';
import { LeftPanel } from '../editor/panels/LeftPanel';
import { PreviewPanel } from '../editor/preview/PreviewPanel';
import { ShortcutsDialog } from '../editor/ShortcutsDialog';
import { editor, setUpdateErrorHandler, useEditor } from '../editor/store/editorStore';
import { Timeline } from '../editor/timeline/Timeline';
import { TopBar } from '../editor/TopBar';
import { Link } from '../router';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/misc';
import { errorMessage, toast } from '../ui/toast';
import '../editor/panels/transitions.css';

const TIMELINE_KEY = 'cutroom.timelineHeight';

function readTimelineHeight(): number {
  try {
    const stored = Number(localStorage.getItem(TIMELINE_KEY));
    if (stored >= 160 && stored <= 900) return stored;
  } catch {
    // Storage may be unavailable (private mode); fall back to the default.
  }
  return 300;
}

function EditorWorkspace({ projectId }: { projectId: string }) {
  useEffect(() => {
    setUpdateErrorHandler((err) =>
      toast.error(`That edit could not be applied: ${errorMessage(err)}`),
    );
    return () => setUpdateErrorHandler(null);
  }, []);
  useAutosave();
  useProjectEvents(projectId);
  useKeyboardShortcuts();
  const [timelineHeight, setTimelineHeight] = useState(readTimelineHeight);
  const resizing = useRef<{ y: number; height: number } | null>(null);

  const onResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    resizing.current = { y: event.clientY, height: timelineHeight };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizing.current) return;
    const max = window.innerHeight - 260;
    const next = Math.min(
      max,
      Math.max(160, resizing.current.height + resizing.current.y - event.clientY),
    );
    setTimelineHeight(next);
  };
  const onResizeEnd = () => {
    resizing.current = null;
    try {
      localStorage.setItem(TIMELINE_KEY, String(timelineHeight));
    } catch {
      // Ignore storage failures.
    }
  };

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        // Files dropped outside the timeline/library land in the media library.
        if (event.defaultPrevented) return;
        event.preventDefault();
        if (event.dataTransfer.files.length > 0) {
          uploadFiles(Array.from(event.dataTransfer.files));
          useEditor.setState({ leftTab: 'media' });
        }
      }}
    >
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <PreviewPanel />
        <Inspector />
      </div>
      <div
        className="h-1 shrink-0 cursor-row-resize bg-line transition-colors hover:bg-accent"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize timeline"
      />
      <Timeline height={timelineHeight} />
      <ExportDialog />
      <ShortcutsDialog />
    </div>
  );
}

export function EditorPage({ projectId }: { projectId: string }) {
  const loaded = useEditor((s) => s.loaded && s.projectId === projectId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([api.getProject(projectId), api.listAssets(projectId), api.listRenders(projectId)])
      .then(([project, assets, renders]) => {
        if (cancelled) return;
        editor.load(project, assets, renders);
        document.title = `${project.name} — Cutroom`;
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
      void saveNow();
      editor.reset();
      document.title = 'Cutroom — Video Editor';
    };
  }, [projectId]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <AlertTriangle size={28} className="text-danger" />
        <div>
          <p className="text-[15px] font-semibold">Could not open this project</p>
          <p className="mt-1 text-sm text-muted">{error}</p>
        </div>
        <Link href="/">
          <Button>Back to projects</Button>
        </Link>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center gap-3 text-muted">
        <Spinner /> Opening project…
      </div>
    );
  }
  return <EditorWorkspace projectId={projectId} />;
}
