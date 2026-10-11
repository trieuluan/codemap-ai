import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'node:child_process';
import type { TestResult } from '../shared/verification';

/** Executes only a package test script explicitly selected by the user. */
export class TestRunner implements vscode.Disposable {
  private cancel?: () => void;
  private disposed = false;
  private choosing?: vscode.CancellationTokenSource;
  async choose(root: vscode.Uri) {
    if (!vscode.workspace.isTrusted || root.scheme !== 'file') {
      throw new Error('Trust a filesystem workspace before running tests.');
    }
    const text = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, 'package.json'));
    const pkg = JSON.parse(Buffer.from(text).toString('utf8'));
    const scripts = Object.entries(pkg.scripts ?? {}).filter(
      ([name, value]) => /^test(?::|$)/.test(name) && typeof value === 'string',
    );
    if (!scripts.length) {
      throw new Error('No test or test:* scripts in the root package.json.');
    }
    this.choosing?.cancel();
    const cancellation = new vscode.CancellationTokenSource();
    this.choosing = cancellation;
    const selected = await vscode.window.showQuickPick(
      scripts.map(([name, command]) => ({ label: name, description: String(command), name })),
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
    const manager =
      typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : 'npm';
    if (!['npm', 'pnpm', 'yarn', 'bun'].includes(manager)) {
      throw new Error('Unsupported package manager.');
    }
    return { manager, name: selected.name };
  }
  async run(
    root: vscode.Uri,
    choice: { manager: string; name: string },
    saved: boolean,
    publish: (result: TestResult) => void,
  ) {
    if (this.cancel || this.disposed) {
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
    const result: TestResult = {
      name: `${choice.manager} run ${choice.name}`,
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
          child = spawn(choice.manager, ['run', choice.name], {
            cwd: root.fsPath,
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
    this.choosing?.cancel();
    this.cancel?.();
  }
  dispose() {
    this.disposed = true;
    this.stop();
  }
}
