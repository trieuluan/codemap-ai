import type { UiMessage } from '../shared/model';

declare function acquireVsCodeApi(): { postMessage(message: UiMessage): void };

const vscode = acquireVsCodeApi();

export function send(message: UiMessage): void {
  vscode.postMessage(message);
}
