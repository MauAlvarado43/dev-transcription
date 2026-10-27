import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runProcess, Cancelled } from '../src/process';
import { LibraryStore } from '../src/store';
import { TranscriptionQueue } from '../src/queue';
import type { Engine } from '../src/engine';
import type { Transcript } from '../src/domain';

test('process arguments remain literal and cancellation stops a running child', async () => {
  const literal = 'a path with spaces; $(no-command) "quoted"';
  assert.equal((await runProcess(process.execPath, ['-e', 'console.log(process.argv[1])', literal])).trim(), literal);
  const controller = new AbortController();
  const work = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal, line: () => {} });
  controller.abort();
  await assert.rejects(work, Cancelled);
});
test('queue runs one job at a time, skips cancelled jobs and preserves previous edits on failure', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'transcription-queue-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new LibraryStore(path.join(root, 'library')); await store.init();
  const c = await store.createCollection('Pruebas');
  const source = path.join(root, 'source.mp4'); await fs.writeFile(source, 'video');
  const videos = await Promise.all([1,2,3,4].map(() => store.importVideo(c.id, source)));
  const result: Transcript = { version: 1, model: 'test', device: 'cpu', language: 'es', duration: 1, segments: [{ start: 0, end: 1, text: 'Hola.' }] };
  await store.saveText(videos[2]!.id, 'Ediciones anteriores');
  let active = 0; let maximum = 0; const calls: string[] = [];
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fakeEngine = { root,
    async transcribe(input: string, _output: string, signal: AbortSignal) {
      const id = path.basename(path.dirname(input)); calls.push(id); maximum = Math.max(maximum, ++active);
      try {
        if (id === videos[0]!.id) await gate;
        if (signal.aborted) throw new Cancelled();
        if (id === videos[2]!.id) throw new Error('Simulated error');
        return result;
      } finally { active--; }
    }
  } as unknown as Engine;
  const failures: string[] = [];
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const queue = new TranscriptionQueue(store, fakeEngine, completed => { if (completed === videos[3]!.id) finish(); }, message => failures.push(message));
  t.after(() => queue.dispose());
  for (const v of videos) await queue.add(v.id);
  await queue.add(videos[0]!.id);
  queue.cancel(videos[1]!.id);
  release!();
  await finished;
  assert.equal(maximum, 1);
  assert.deepEqual(calls, [videos[0]!.id, videos[2]!.id, videos[3]!.id]);
  assert.equal(failures.length, 1);
  assert.equal(await store.text(videos[2]!.id), 'Ediciones anteriores');
  assert.match((await store.video(videos[2]!.id)).error!, /Simulated error/);
  assert.ok((await store.video(videos[3]!.id)).transcribedAt);
  assert.equal(queue.snapshot().length, 0);
});
test('cancelling an active transcription cannot replace saved text', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'transcription-cancel-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new LibraryStore(path.join(root, 'library')); await store.init();
  const c = await store.createCollection('Test'); const source = path.join(root, 'source.mp4'); await fs.writeFile(source, 'video');
  const v = await store.importVideo(c.id, source); await store.saveText(v.id, 'Conservar');
  let started!: () => void; const starting = new Promise<void>(r => { started = r; });
  let finished!: () => void; const ending = new Promise<void>(r => { finished = r; });
  const engine = { root, async transcribe(_input: string, _output: string, signal: AbortSignal) {
    started(); await new Promise<void>(r => signal.addEventListener('abort', () => r(), { once: true }));
    return { version: 1, model: 'test', language: 'es', device: 'cpu', duration: 1, segments: [] };
  } } as unknown as Engine;
  const queue = new TranscriptionQueue(store, engine, () => { if (!queue.has(v.id)) finished(); }, () => assert.fail('Cancellation should not report a failure'));
  t.after(() => queue.dispose());
  await queue.add(v.id); await starting; queue.cancel(v.id); await ending;
  assert.equal(await store.text(v.id), 'Conservar'); assert.equal(await store.transcript(v.id), undefined);
});
