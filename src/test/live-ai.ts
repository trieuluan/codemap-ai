import * as vscode from 'vscode';
import { writeFileSync } from 'node:fs';
import { AiSession } from '../ai/session';
import type { AiHostMessage } from '../shared/ai';

/** Opt-in live check. The only transmitted prompt is a constant connection check. */
export async function run() {
  const events: AiHostMessage[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    sourceSent: false,
    isolatedProfile: true,
  };
  try {
    const models = await Promise.race([
      vscode.lm.selectChatModels(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Model discovery timed out; authentication may be required.')),
          15000,
        );
      }),
    ]);
    report.models = models.map((m) => ({ id: m.id, name: m.name, vendor: m.vendor }));
    const requested = process.env.CODEMAP_TEST_MODEL_ID;
    const model = requested ? models.find((m) => m.id === requested) : models[0];
    if (!model) {
      report.status = 'unavailable';
      report.reason =
        'No accessible model in this profile. Enable a compatible provider and sign in, then use CodeMap: Test AI Connection in your normal VS Code window.';
    } else {
      const session = new AiSession({
        post: (event) => events.push(event),
        context: () => {
          throw new Error('Live connection check must not read source.');
        },
        graph: () => undefined,
        afterApply: async () => {},
        configuredModel: () => model.id,
      });
      try {
        report.status = (await session.testConnection()) ? 'passed' : 'failed';
        report.events = events;
      } finally {
        session.dispose();
      }
    }
  } catch (error) {
    report.status = 'unavailable';
    report.reason = String(error);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
  writeFileSync(process.env.CODEMAP_LIVE_REPORT!, JSON.stringify(report, null, 2));
  console.log('CodeMap live model check:', report.status);
}
