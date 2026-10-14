import { Dashboard } from './pages/Dashboard';
import { EditorPage } from './pages/EditorPage';
import { Link, matchPath, usePathname } from './router';
import { Button } from './ui/Button';
import { Toaster } from './ui/toast';

export function App() {
  const pathname = usePathname();
  const project = matchPath('/projects/:id', pathname);
  let page;
  if (project) page = <EditorPage key={project.id} projectId={project.id!} />;
  else if (pathname === '/') page = <Dashboard />;
  else {
    page = (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-lg font-semibold">Page not found</p>
        <Link href="/">
          <Button>Go to projects</Button>
        </Link>
      </div>
    );
  }
  return (
    <>
      {page}
      <Toaster />
    </>
  );
}
