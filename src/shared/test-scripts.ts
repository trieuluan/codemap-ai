/** Package metadata only: discovering tests never executes workspace code. */
export interface TestScriptChoice {
  manager: string;
  name: string;
  directory?: string;
}
export interface PackageTests {
  directory: string;
  manifest: unknown;
}
export function packageTestScripts(packages: PackageTests[], changedPaths: string[] = []) {
  const root = packages.find((p) => p.directory === '');
  const manager = (value: unknown, fallback: string): string => {
    if (!value || typeof value !== 'object') {
      return fallback;
    }
    const declared = (value as { packageManager?: unknown }).packageManager;
    return typeof declared === 'string' ? declared.split('@')[0] : fallback;
  };
  const fallback = manager(root?.manifest, 'npm');
  return packages
    .flatMap(({ directory, manifest }) => {
      if (!manifest || typeof manifest !== 'object') {
        return [];
      }
      const scripts = (manifest as { scripts?: unknown }).scripts;
      if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
        return [];
      }
      const selectedManager = manager(manifest, fallback);
      if (!['npm', 'pnpm', 'yarn', 'bun'].includes(selectedManager)) {
        return [];
      }
      return Object.entries(scripts)
        .filter(([name, command]) => /^test(?::|$)/.test(name) && typeof command === 'string')
        .map(([name, command]) => ({
          manager: selectedManager,
          name,
          directory,
          label: `${directory || 'Workspace root'} · ${name}`,
          description: String(command),
          detail: `${selectedManager} run ${name} · cwd: ${directory || '.'}`,
          related: !!directory && changedPaths.some((path) => path.startsWith(directory + '/')),
        }));
    })
    .sort(
      (a, b) =>
        Number(b.related) - Number(a.related) ||
        a.directory.localeCompare(b.directory) ||
        a.name.localeCompare(b.name),
    );
}
