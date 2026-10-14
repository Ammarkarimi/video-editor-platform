import { useEffect } from 'react';
import { subscribeToProject } from '../../api/client';
import { toast } from '../../ui/toast';
import { upsertAsset } from '../actions';
import { useEditor } from '../store/editorStore';

/** Applies live server events (media processing, export progress) to the editor state. */
export function useProjectEvents(projectId: string): void {
  useEffect(() => {
    if (!projectId) return;
    return subscribeToProject(projectId, (event) => {
      const state = useEditor.getState();
      switch (event.type) {
        case 'asset.updated': {
          const previous = state.assets.find((a) => a.id === event.asset.id);
          upsertAsset(event.asset);
          if (previous?.status === 'processing' && event.asset.status === 'error') {
            toast.error(`${event.asset.name}: ${event.asset.error ?? 'processing failed'}`);
          }
          break;
        }
        case 'asset.deleted':
          useEditor.setState({ assets: state.assets.filter((a) => a.id !== event.assetId) });
          break;
        case 'render.updated': {
          const exists = state.renders.some((r) => r.id === event.render.id);
          const previous = state.renders.find((r) => r.id === event.render.id);
          useEditor.setState({
            renders: exists
              ? state.renders.map((r) => (r.id === event.render.id ? event.render : r))
              : [event.render, ...state.renders],
          });
          if (previous && previous.status !== 'completed' && event.render.status === 'completed') {
            toast.success(`Export ready: ${event.render.fileName}`);
          } else if (previous && previous.status !== 'failed' && event.render.status === 'failed') {
            toast.error(`Export failed: ${event.render.error ?? 'unknown error'}`);
          }
          break;
        }
        case 'render.deleted':
          useEditor.setState({ renders: state.renders.filter((r) => r.id !== event.renderId) });
          break;
        case 'project.updated':
          if (event.project.name !== state.projectName)
            useEditor.setState({ projectName: event.project.name });
          break;
      }
    });
  }, [projectId]);
}
