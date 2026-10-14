import { ASPECT_PRESETS, formatDuration, FPS_PRESETS, type ProjectSummaryDTO } from '@vep/core';
import clsx from 'clsx';
import { Copy, Film, MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { navigate } from '../router';
import { Button, IconButton } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Select, TextInput } from '../ui/fields';
import { useContextMenu } from '../ui/Menu';
import { EmptyState, Logo, Spinner } from '../ui/misc';
import { errorMessage, toast } from '../ui/toast';

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 172_800) return 'yesterday';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function Dashboard() {
  const [projects, setProjects] = useState<ProjectSummaryDTO[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  const load = () =>
    api
      .listProjects()
      .then(setProjects)
      .catch((err: unknown) => {
        toast.error(errorMessage(err));
        setProjects([]);
      });

  useEffect(() => {
    void load();
  }, []);

  const createDemo = async () => {
    setDemoLoading(true);
    try {
      const project = await api.createDemoProject();
      navigate(`/projects/${project.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
      setDemoLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-6">
          <Logo size={30} />
          <div>
            <p className="text-[16px] leading-tight font-bold tracking-tight">Cutroom</p>
            <p className="text-[11px] text-muted">Video editor</p>
          </div>
          <div className="flex-1" />
          <Button
            variant="secondary"
            icon={demoLoading ? <Spinner size={14} /> : <Sparkles size={14} />}
            onClick={() => void createDemo()}
            disabled={demoLoading}
          >
            {demoLoading ? 'Building demo…' : 'Try a demo project'}
          </Button>
          <Button
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => setCreating(true)}
            data-testid="new-project"
          >
            New project
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="mb-5 text-xl font-semibold tracking-tight">Your projects</h1>
        {projects === null ? (
          <div className="flex items-center gap-2 text-muted">
            <Spinner /> Loading…
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line-2">
            <EmptyState icon={<Film size={22} />} title="No projects yet">
              <p className="mb-4">
                Create a project to start editing, or explore a ready-made demo.
              </p>
              <div className="flex justify-center gap-2">
                <Button
                  variant="primary"
                  icon={<Plus size={15} />}
                  onClick={() => setCreating(true)}
                >
                  New project
                </Button>
                <Button
                  icon={<Sparkles size={14} />}
                  onClick={() => void createDemo()}
                  disabled={demoLoading}
                >
                  Demo project
                </Button>
              </div>
            </EmptyState>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-2 text-muted transition-colors hover:border-accent hover:text-fg"
            >
              <Plus size={22} />
              <span className="text-[13px] font-medium">New project</span>
            </button>
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} onChanged={() => void load()} />
            ))}
          </div>
        )}
      </main>
      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function ProjectCard({
  project,
  onChanged,
}: {
  project: ProjectSummaryDTO;
  onChanged: () => void;
}) {
  const menu = useContextMenu();
  const [thumbFailed, setThumbFailed] = useState(false);
  const open = () => navigate(`/projects/${project.id}`);

  const rename = async () => {
    const name = window.prompt('Rename project', project.name);
    if (!name?.trim() || name === project.name) return;
    try {
      await api.renameProject(project.id, name.trim());
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const duplicate = async () => {
    try {
      await api.duplicateProject(project.id);
      toast.success('Project duplicated');
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const remove = async () => {
    if (
      !window.confirm(
        `Delete "${project.name}" and all of its media and exports? This cannot be undone.`,
      )
    )
      return;
    try {
      await api.deleteProject(project.id);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const openMenu = (event: {
    clientX: number;
    clientY: number;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }) => {
    event.stopPropagation?.();
    menu.open(event, [
      { label: 'Open', icon: <Film size={14} />, onSelect: open },
      { label: 'Rename', icon: <Pencil size={14} />, onSelect: () => void rename() },
      { label: 'Duplicate', icon: <Copy size={14} />, onSelect: () => void duplicate() },
      'separator',
      { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onSelect: () => void remove() },
    ]);
  };

  return (
    <div
      className="group cursor-pointer overflow-hidden rounded-xl border border-line bg-panel transition-colors hover:border-line-2"
      onClick={open}
      onContextMenu={openMenu}
      data-testid="project-card"
    >
      <div className="relative flex aspect-video items-center justify-center bg-black">
        {thumbFailed ? (
          <Film size={28} className="text-dim" />
        ) : (
          <img
            src={project.thumbnailUrl}
            alt=""
            className="h-full w-full object-contain"
            loading="lazy"
            onError={() => setThumbFailed(true)}
          />
        )}
        <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-fg tabular-nums">
          {formatDuration(project.duration)}
        </span>
      </div>
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{project.name}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {project.width}×{project.height} · {project.fps} fps · {relativeTime(project.updatedAt)}
          </p>
        </div>
        <IconButton
          label="Project options"
          onClick={(event) => openMenu(event)}
          className="opacity-60 group-hover:opacity-100"
        >
          <MoreHorizontal size={16} />
        </IconButton>
      </div>
      {menu.menu}
    </div>
  );
}

function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [presetId, setPresetId] = useState('16:9');
  const [fps, setFps] = useState(30);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(
        `Untitled ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
      );
      setBusy(false);
    }
  }, [open]);

  const create = async () => {
    const preset = ASPECT_PRESETS.find((p) => p.id === presetId)!;
    setBusy(true);
    try {
      const project = await api.createProject({
        name: name.trim() || 'Untitled',
        width: preset.width,
        height: preset.height,
        fps,
      });
      navigate(`/projects/${project.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New project"
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void create()}
            disabled={busy}
            data-testid="create-project"
          >
            {busy ? 'Creating…' : 'Create project'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <label className="block">
          <span className="mb-1.5 block text-xs text-muted">Name</span>
          <TextInput
            data-autofocus
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
            }}
            data-testid="project-name-input"
          />
        </label>
        <div>
          <span className="mb-1.5 block text-xs text-muted">Format</span>
          <div className="grid grid-cols-3 gap-2">
            {ASPECT_PRESETS.map((preset) => {
              const scale = 34 / Math.max(preset.width, preset.height);
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setPresetId(preset.id)}
                  aria-pressed={preset.id === presetId}
                  className={clsx(
                    'flex items-center gap-3 rounded-lg border p-2.5 text-left transition-colors',
                    preset.id === presetId
                      ? 'border-accent bg-accent-soft'
                      : 'border-line bg-panel-2 hover:border-line-2',
                  )}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center">
                    <div
                      className="rounded-[3px] border-2 border-current text-muted"
                      style={{ width: preset.width * scale, height: preset.height * scale }}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-semibold">{preset.label}</p>
                    <p className="truncate text-[10.5px] text-muted">{preset.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <Field label="Frame rate">
          <Select value={String(fps)} onChange={(event) => setFps(Number(event.target.value))}>
            {FPS_PRESETS.map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
