import * as vscode from 'vscode';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import {
  packageTestScripts,
  type TestScriptChoice,
  type PackageTests,
} from '../shared/test-scripts';
import { spawn, type ChildProcess } from 'node:child_process';
import type { TestResult } from '../shared/verification';

/** Executes only a package test script explicitly selected by the user. */
export class TestRunner implements vscode.Disposable {
  private cancel?: () => void;
  private disposed = false;
  private preparing = false;
  private generation = 0;
  private choosing?: vscode.CancellationTokenSource;
  async choices(root: vscode.Uri, changedPaths: string[] = []) {
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, '**/package.json'),
      '**/{node_modules,.git,dist,build,out,coverage,.next,.vscode-test}/**',
    );
    const packages: PackageTests[] = [];
    for (const uri of files) {
      const directory = relative(root.fsPath, uri.fsPath)
        .split('\\')
        .join('/')
        .replace(/(^|\/)package\.json$/, '');
      try {
        const manifest = JSON.parse(
          Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'),
        );
        packages.push({ directory, manifest });
      } catch {
        /* Invalid manifests cannot offer executable scripts. */
      }
    }
    return packageTestScripts(packages, changedPaths);
  }
  async choose(
    root: vscode.Uri,
    changedPaths: string[] = [],
  ): Promise<TestScriptChoice | undefined> {
    if (!vscode.workspace.isTrusted || root.scheme !== 'file') {
      throw new Error('Trust a filesystem workspace before running tests.');
    }
    const scripts = await this.choices(root, changedPaths);
    if (!scripts.length) {
      throw new Error('No test or test:* scripts found in workspace packages.');
    }
    this.choosing?.cancel();
    const cancellation = new vscode.CancellationTokenSource();
    this.choosing = cancellation;
    const selected = await vscode.window.showQuickPick(
      scripts.map((script) => ({
        ...script,
        detail: `${script.related ? 'Changed files in this package · ' : ''}${script.detail}`,
      })),
      {
        title: 'CodeMap · Choose test script',
        placeHolder: 'Runs project code on disk; review the script before choosing',
      },
      cancellation.token,
    );
    cancellation.dispose();
    if (this.choosing === cancellation) {
      this.choosing = undefined;
    }
    if (!selected || this.disposed) {
      return;
    }
    return { manager: selected.manager, name: selected.name, directory: selected.directory };
  }
  async run(
    root: vscode.Uri,
    choice: TestScriptChoice,
    saved: boolean,
    publish: (result: TestResult) => void,
    isCurrent: () => boolean = () => true,
  ) {
    if (this.cancel || this.disposed || this.preparing) {
      throw new Error('A test run is already active.');
    }
    if (
      !vscode.workspace.isTrusted ||
      root.scheme !== 'file' ||
      !['npm', 'pnpm', 'yarn', 'bun'].includes(choice.manager) ||
      !/^test(?::|$)/.test(choice.name)
    ) {
      throw new Error('Invalid test task.');
    }
    const directory = choice.directory ?? '';
    if (isAbsolute(directory) || directory.split(/[\\/]/).includes('..')) {
      throw new Error('Invalid package directory.');
    }
    const generation = this.generation;
    let cwd: string;
    this.preparing = true;
    try {
      cwd = await realpath(vscode.Uri.joinPath(root, directory).fsPath);
      const inside = relative(await realpath(root.fsPath), cwd);
      if (inside.startsWith('..') || isAbsolute(inside)) {
        throw new Error('Test package is outside the workspace.');
      }
      const manifest = JSON.parse(
        Buffer.from(
          await vscode.workspace.fs.readFile(vscode.Uri.file(cwd + '/package.json')),
        ).toString('utf8'),
      );
      if (typeof manifest.scripts?.[choice.name] !== 'string') {
        throw new Error('Selected test script no longer exists.');
      }

      if (this.disposed || generation !== this.generation || !isCurrent()) {
        throw new Error('Test start cancelled or source changed.');
      }
    } finally {
      this.preparing = false;
    }
    const result: TestResult = {
      name: `${directory || 'Workspace root'} · ${choice.manager} run ${choice.name}`,
      state: 'running',
      output: '',
      truncated: false,
      startedAt: new Date().toISOString(),
      saved,
    };
    let child: ChildProcess | undefined;
    let task: vscode.TaskExecution | undefined;
    let cancelled = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const write = new vscode.EventEmitter<string>();
    const close = new vscode.EventEmitter<number>();
    const append = (text: string) => {
      const room = Math.max(0, 32000 - result.output.length);
      result.output += text.slice(0, room);
      result.truncated ||= text.length > room;
      publish({ ...result });
    };
    const settle = (code?: number, error?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (error) {
        append('\n' + error);
      }
      result.state = cancelled ? 'cancelled' : code === 0 ? 'passed' : 'failed';
      result.exitCode = code;
      result.finishedAt = new Date().toISOString();
      this.cancel = undefined;
      publish({ ...result });
      close.fire(code ?? 1);
      finish();
    };
    const kill = (signal: NodeJS.Signals) => {
      if (!child?.pid) {
        return;
      }
      try {
        if (process.platform !== 'win32') {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch {
        /* Already exited. */
      }
    };
    this.cancel = () => {
      if (settled) {
        return;
      }
      cancelled = true;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 1000);
      killTimer.unref();
      settle();
      task?.terminate();
    };
    publish({ ...result });
    timer = setTimeout(() => this.stop(), 300000);
    const execution = new vscode.CustomExecution(async () => ({
      onDidWrite: write.event,
      onDidClose: close.event,
      open: () => {
        if (settled || this.disposed) {
          close.fire(1);
          return;
        }
        try {
          if (!isCurrent()) {
            throw new Error('Source changed before task execution.');
          }
          child = spawn(choice.manager, ['run', choice.name], {
            cwd,
            shell: false,
            detached: process.platform !== 'win32',
            env: process.env,
          });
          const output = (data: Buffer) => {
            if (settled) {
              return;
            }
            const chunk = data.toString();
            write.fire(chunk.replace(/\r?\n/g, '\r\n'));
            append(chunk);
          };
          child.stdout?.on('data', output);
          child.stderr?.on('data', output);
          child.on('error', (error) => settle(undefined, String(error)));
          child.on('close', (code) => {
            if (killTimer) {
              clearTimeout(killTimer);
            }
            settle(code ?? undefined);
          });
        } catch (error) {
          settle(undefined, String(error));
        }
      },
      close: () => {
        if (!settled) {
          this.stop();
        }
        write.dispose();
        close.dispose();
      },
    }));
    const folder = vscode.workspace.workspaceFolders?.find(
      (f) => f.uri.toString() === root.toString(),
    );
    const definition = new vscode.Task(
      { type: 'codemap-test', script: choice.name },
      folder ?? vscode.TaskScope.Workspace,
      `CodeMap · ${result.name}`,
      'CodeMap',
      execution,
    );
    definition.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      panel: vscode.TaskPanelKind.New,
    };
    try {
      task = await vscode.tasks.executeTask(definition);
      if (settled) {
        task.terminate();
      }
      await done;
    } catch (error) {
      settle(undefined, String(error));
    }
  }
  stop() {
    this.generation++;
    this.choosing?.cancel();
    this.cancel?.();
  }
  dispose() {
    this.disposed = true;
    this.stop();
  }
}
