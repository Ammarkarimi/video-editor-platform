import {
  createProjectDoc,
  createTextClip,
  findClip,
  type ProjectDTO,
  type TextClip,
} from '@vep/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { editor, setAnimatedProp, useEditor } from './editorStore';

function load(): string {
  const doc = createProjectDoc();
  const clip = createTextClip(0, { text: 'Hello' });
  doc.tracks[0]!.clips.push(clip);
  const project: ProjectDTO = {
    id: 'prj_test',
    name: 'Test',
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 5,
    version: 1,
    createdAt: '',
    updatedAt: '',
    thumbnailUrl: '',
    document: doc,
  };
  editor.load(project, [], []);
  return clip.id;
}

const textOf = (id: string) => (findClip(useEditor.getState().doc, id)!.clip as TextClip).text;

describe('editor store history', () => {
  let clipId: string;
  beforeEach(() => {
    clipId = load();
  });

  it('records edits and undoes/redoes them', () => {
    editor.update((d) => {
      (findClip(d, clipId)!.clip as TextClip).text = 'One';
    });
    editor.update((d) => {
      (findClip(d, clipId)!.clip as TextClip).text = 'Two';
    });
    expect(useEditor.getState().saveState).toBe('dirty');
    editor.undo();
    expect(textOf(clipId)).toBe('One');
    editor.undo();
    expect(textOf(clipId)).toBe('Hello');
    editor.redo();
    expect(textOf(clipId)).toBe('One');
  });

  it('merges rapid edits with the same history key', () => {
    for (const text of ['a', 'ab', 'abc']) {
      editor.update(
        (d) => {
          (findClip(d, clipId)!.clip as TextClip).text = text;
        },
        { history: 'typing' },
      );
    }
    expect(useEditor.getState().past).toHaveLength(1);
    editor.undo();
    expect(textOf(clipId)).toBe('Hello');
  });

  it('collapses a drag transaction into one undo step', () => {
    editor.beginTransaction();
    for (const x of [10, 20, 30]) {
      editor.updateFromBase((d) => setAnimatedProp(d, clipId, 'x', x, 0));
    }
    editor.commitTransaction();
    expect(useEditor.getState().past).toHaveLength(1);
    expect((findClip(useEditor.getState().doc, clipId)!.clip as TextClip).transform.x).toBe(30);
    editor.undo();
    expect((findClip(useEditor.getState().doc, clipId)!.clip as TextClip).transform.x).toBe(0);
  });

  it('cancels a transaction back to its starting state', () => {
    editor.beginTransaction();
    editor.updateFromBase((d) => setAnimatedProp(d, clipId, 'y', 99, 0));
    editor.cancelTransaction();
    expect(useEditor.getState().past).toHaveLength(0);
    expect((findClip(useEditor.getState().doc, clipId)!.clip as TextClip).transform.y).toBe(0);
  });

  it('auto-keys animated properties at the playhead', () => {
    editor.update((d) => {
      const clip = findClip(d, clipId)!.clip as TextClip;
      clip.keyframes.opacity = [{ time: 0, value: 0, easing: 'linear' }];
    });
    editor.update((d) => setAnimatedProp(d, clipId, 'opacity', 1, 2));
    const clip = findClip(useEditor.getState().doc, clipId)!.clip as TextClip;
    expect(clip.keyframes.opacity).toEqual([
      { time: 0, value: 0, easing: 'linear' },
      { time: 2, value: 1, easing: 'easeInOut' },
    ]);
    expect(clip.transform.opacity).toBe(1); // static value untouched while animated
  });

  it('drops selections of clips that no longer exist', () => {
    editor.select([clipId]);
    editor.update((d) => {
      d.tracks[0]!.clips = [];
    });
    expect(useEditor.getState().selection).toEqual([]);
  });

  it('reports failing edits without changing the document', () => {
    const before = useEditor.getState().doc;
    editor.update(() => {
      throw new Error('boom');
    });
    expect(useEditor.getState().doc).toBe(before);
  });
});
