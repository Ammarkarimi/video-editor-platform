import clsx from 'clsx';
import { ArrowLeftRight, FolderOpen, Shapes, Type } from 'lucide-react';
import { useEditor, type LeftTab } from '../store/editorStore';
import { ElementsPanel } from './ElementsPanel';
import { MediaPanel } from './MediaPanel';
import { TextPanel } from './TextPanel';
import { TransitionsPanel } from './TransitionsPanel';

const TABS: Array<{ id: LeftTab; label: string; icon: typeof FolderOpen }> = [
  { id: 'media', label: 'Media', icon: FolderOpen },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'transitions', label: 'Transitions', icon: ArrowLeftRight },
  { id: 'elements', label: 'Elements', icon: Shapes },
];

export function LeftPanel() {
  const tab = useEditor((s) => s.leftTab);
  return (
    <aside className="flex w-[330px] shrink-0 border-r border-line bg-panel">
      <nav
        className="flex w-[62px] shrink-0 flex-col gap-1 border-r border-line py-2"
        aria-label="Library"
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => useEditor.setState({ leftTab: id })}
            aria-pressed={tab === id}
            className={clsx(
              'mx-1.5 flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-colors',
              tab === id
                ? 'bg-accent-soft text-accent-hover'
                : 'text-muted hover:bg-panel-3 hover:text-fg',
            )}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {tab === 'media' && <MediaPanel />}
        {tab === 'text' && <TextPanel />}
        {tab === 'transitions' && <TransitionsPanel />}
        {tab === 'elements' && <ElementsPanel />}
      </div>
    </aside>
  );
}

export function PanelHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex h-11 items-center justify-between border-b border-line bg-panel px-3">
      <h2 className="text-[13px] font-semibold">{title}</h2>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}
