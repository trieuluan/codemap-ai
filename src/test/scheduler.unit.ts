import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { UpdateScheduler } from '../scheduler';
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
test('coalesces edits and keeps changes pending while disabled', async () => {
  const jobs: string[][] = [];
  const published: number[] = [];
  const scheduler = new UpdateScheduler(
    async (batch) => {
      jobs.push([...batch.ids]);
      return batch.revision;
    },
    (value) => published.push(value),
    () => {},
    15,
  );
  try {
    scheduler.mark(['a']);
    scheduler.mark(['b']);
    scheduler.mark(['a']);
    await wait(45);
    assert.deepEqual(jobs, [['a', 'b']]);
    assert.equal(published.length, 1);
    scheduler.setAutoUpdate(false);
    scheduler.mark(['c']);
    await wait(30);
    assert.equal(jobs.length, 1);
    scheduler.setAutoUpdate(true);
    await wait(35);
    assert.equal(jobs.length, 2);
  } finally {
    scheduler.dispose();
  }
});
test('suppresses stale results, serializes jobs and processes edits arriving during a run', async () => {
  let release!: () => void;
  let started!: () => void;
  let calls = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  const firstStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const published: number[] = [];
  const scheduler = new UpdateScheduler(
    async (batch) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      calls++;
      if (calls === 1) {
        started();
        await gate;
      }
      concurrent--;
      return batch.revision;
    },
    (value) => published.push(value),
    () => {},
    10,
  );
  try {
    const refresh = scheduler.refresh();
    await firstStarted;
    scheduler.mark(['new-edit']);
    release();
    await refresh;
    await wait(40);
    assert.equal(calls, 2);
    assert.equal(maxConcurrent, 1);
    assert.deepEqual(published, [2]);
  } finally {
    scheduler.dispose();
  }
});
test('cancellation disables automatic updates and errors do not cause retry loops', async () => {
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const published: number[] = [];
  const scheduler = new UpdateScheduler(
    async (_batch, signal) => {
      calls++;
      started();
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('cancelled'))),
      );
      return 1;
    },
    (value) => published.push(value),
    () => {},
    10,
  );
  const refresh = scheduler.refresh();
  await began;
  scheduler.cancel();
  await refresh;
  assert.equal(scheduler.autoUpdate, false);
  assert.equal(published.length, 0);
  scheduler.dispose();
  const failed = new UpdateScheduler(
    async () => {
      calls++;
      throw new Error('failure');
    },
    () => {},
    () => {},
    10,
  );
  await failed.refresh();
  const count = calls;
  await wait(45);
  assert.equal(calls, count);
  failed.dispose();
});
test('dispose prevents in-flight publication and pending jobs', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let published = false;
  const scheduler = new UpdateScheduler(
    async () => {
      await gate;
      return 1;
    },
    () => {
      published = true;
    },
    () => {},
    10,
  );
  const refresh = scheduler.refresh();
  scheduler.mark(['pending']);
  scheduler.dispose();
  release();
  await refresh;
  await wait(25);
  assert.equal(published, false);
});
test('manual Refresh bounds immediate follow-up scans when every scan triggers another event', async () => {
  let calls = 0;
  const scheduler = new UpdateScheduler(
    async (batch) => {
      if (++calls > 3) {
        throw new Error('Unbounded refresh loop');
      }
      scheduler.mark(['notification-during-scan']);
      return batch.revision;
    },
    () => {},
    () => {},
    10,
  );
  try {
    scheduler.setAutoUpdate(false);
    await scheduler.refresh();
    assert.equal(calls, 2);
    await wait(35);
    assert.equal(calls, 2);
  } finally {
    scheduler.dispose();
  }
});
