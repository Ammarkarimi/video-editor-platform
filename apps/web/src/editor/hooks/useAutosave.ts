import { useEffect } from 'react';
import { ApiError, api } from '../../api/client';
import { useEditor } from '../store/editorStore';

const SAVE_DELAY_MS = 800;
const RETRY_DELAY_MS = 5000;

let saving = false;

/** Saves the document to the server; `force` overwrites a conflicting server version. */
export async function saveNow(force = false): Promise<void> {
  const state = useEditor.getState();
  if (!state.loaded || state.txBase || saving) return;
  if (!force && (state.saveState === 'saved' || state.saveState === 'conflict')) return;
  saving = true;
  const doc = state.doc;
  useEditor.setState({ saveState: 'saving', saveError: null });
  try {
    const summary = await api.saveDocument(state.projectId, doc, force ? null : state.version);
    const current = useEditor.getState();
    useEditor.setState({
      version: summary.version,
      saveState: current.doc === doc ? 'saved' : 'dirty',
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      useEditor.setState({ saveState: 'conflict', saveError: err.message });
    } else {
      useEditor.setState({
        saveState: 'error',
        saveError: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    saving = false;
  }
}

/** Debounced autosave whenever the document changes (outside of drag gestures). */
export function useAutosave(): void {
  useEffect(() => {
    let timer: number | undefined;
    const schedule = (delay = SAVE_DELAY_MS) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void saveNow().then(() => {
          const state = useEditor.getState();
          if (state.saveState === 'dirty') schedule();
          else if (state.saveState === 'error') schedule(RETRY_DELAY_MS);
        });
      }, delay);
    };
    const unsubscribe = useEditor.subscribe((state, prev) => {
      if (!state.loaded || state.txBase) return;
      const changed = state.doc !== prev.doc || (prev.txBase !== null && state.txBase === null);
      if (changed && state.saveState === 'dirty') schedule();
    });
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const { saveState, projectId, doc, version, loaded } = useEditor.getState();
      if (!loaded || saveState === 'saved') return;
      // Best-effort save that survives page unload, plus the browser's "leave site?" prompt.
      void fetch(`/api/projects/${projectId}/document`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: doc, baseVersion: version }),
        keepalive: true,
      }).catch(() => undefined);
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Flush pending edits when leaving the editor.
      void saveNow();
    };
  }, []);
}
