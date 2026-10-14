import { useEffect } from 'react';
import {
  addMarkerAtPlayhead,
  clearRange,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  goToEdge,
  pasteClipboard,
  selectAll,
  setRangeEdge,
  splitAtPlayhead,
} from '../actions';
import { editor, timelineDuration, useEditor } from '../store/editorStore';

export interface ShortcutInfo {
  keys: string[];
  description: string;
  group: 'Playback' | 'Editing' | 'Timeline' | 'General';
}

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

export const SHORTCUTS: ShortcutInfo[] = [
  { keys: ['Space'], description: 'Play / pause', group: 'Playback' },
  { keys: ['←', '→'], description: 'Previous / next frame', group: 'Playback' },
  { keys: ['Shift', '← →'], description: 'Jump 1 second', group: 'Playback' },
  { keys: ['↑', '↓'], description: 'Previous / next edit point', group: 'Playback' },
  { keys: ['Home', 'End'], description: 'Go to start / end', group: 'Playback' },
  { keys: ['L'], description: 'Toggle loop playback', group: 'Playback' },
  { keys: ['S'], description: 'Split at playhead', group: 'Editing' },
  { keys: ['Delete'], description: 'Delete selection', group: 'Editing' },
  { keys: ['Shift', 'Delete'], description: 'Ripple delete (close the gap)', group: 'Editing' },
  { keys: [mod, 'D'], description: 'Duplicate', group: 'Editing' },
  { keys: [mod, 'C / X / V'], description: 'Copy / cut / paste at playhead', group: 'Editing' },
  { keys: [mod, 'A'], description: 'Select all clips', group: 'Editing' },
  { keys: [mod, 'Z'], description: 'Undo', group: 'Editing' },
  { keys: [mod, 'Shift', 'Z'], description: 'Redo', group: 'Editing' },
  { keys: ['M'], description: 'Add marker', group: 'Timeline' },
  { keys: ['I', 'O'], description: 'Set in / out point', group: 'Timeline' },
  { keys: ['X'], description: 'Clear in / out range', group: 'Timeline' },
  { keys: ['N'], description: 'Toggle snapping', group: 'Timeline' },
  { keys: ['+', '−'], description: 'Zoom timeline in / out', group: 'Timeline' },
  { keys: ['Esc'], description: 'Clear selection', group: 'General' },
  { keys: ['?'], description: 'Show keyboard shortcuts', group: 'General' },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      const state = useEditor.getState();
      if (!state.loaded || state.exportOpen) return;
      const primary = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      let handled = true;

      if (primary) {
        if (key === 'z' && event.shiftKey) editor.redo();
        else if (key === 'z') editor.undo();
        else if (key === 'y') editor.redo();
        else if (key === 'd') duplicateSelection();
        else if (key === 'c') copySelection();
        else if (key === 'x') cutSelection();
        else if (key === 'v') pasteClipboard();
        else if (key === 'a') selectAll();
        else if (key === 'b') splitAtPlayhead();
        else handled = false;
      } else {
        switch (event.key) {
          case ' ':
            editor.togglePlay();
            break;
          case 'ArrowLeft':
            if (event.shiftKey) editor.seek(state.currentTime - 1);
            else editor.stepFrames(-1);
            break;
          case 'ArrowRight':
            if (event.shiftKey) editor.seek(state.currentTime + 1);
            else editor.stepFrames(1);
            break;
          case 'ArrowUp':
            goToEdge(-1);
            break;
          case 'ArrowDown':
            goToEdge(1);
            break;
          case 'Home':
            editor.seek(0);
            break;
          case 'End':
            editor.seek(timelineDuration());
            break;
          case 'Delete':
          case 'Backspace':
            deleteSelection(event.shiftKey);
            break;
          case 'Escape':
            editor.clearSelection();
            break;
          case '?':
            useEditor.setState({ shortcutsOpen: true });
            break;
          case '+':
          case '=':
            editor.setZoom(state.zoom * 1.25);
            break;
          case '-':
          case '_':
            editor.setZoom(state.zoom / 1.25);
            break;
          default:
            switch (key) {
              case 's':
                splitAtPlayhead();
                break;
              case 'm':
                addMarkerAtPlayhead();
                break;
              case 'i':
                setRangeEdge('in');
                break;
              case 'o':
                setRangeEdge('out');
                break;
              case 'x':
                clearRange();
                break;
              case 'n':
                useEditor.setState({ snapping: !state.snapping });
                break;
              case 'l':
                useEditor.setState({ loopPlayback: !state.loopPlayback });
                break;
              default:
                handled = false;
            }
        }
      }
      if (handled) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
