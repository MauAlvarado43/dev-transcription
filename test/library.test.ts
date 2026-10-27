import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LibraryStore } from '../src/store';
import { markdown, parseTranscript, subtitles, timestamp, validId, validName, type Transcript } from '../src/domain';

const transcript: Transcript = { version: 1, model: 'large-v3', device: 'cpu', language: 'es', duration: 5, segments: [{ start: 0.125, end: 2.99, text: 'Hola mundo.' }, { start: 3, end: 5, text: 'Una prueba local.' }] };
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-transcription-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new LibraryStore(path.join(dir, 'library')); await store.init();
  const source = path.join(dir, 'un video con espacios.MP4'); await fs.writeFile(source, 'original video bytes');
  const collection = await store.createCollection('Cursos');
  return { dir, store, source, collection };
}
test('import, edit, restart, move and rename keep the original and the transcription', async t => {
  const { store, source, collection } = await fixture(t);
  const video = await store.importVideo(collection.id, source);
  await fs.unlink(source);
  assert.equal(await fs.readFile(await store.source(video.id), 'utf8'), 'original video bytes');
  await store.saveTranscript(video.id, transcript);
  assert.equal(await store.text(video.id), markdown(video.title, transcript));
  await store.saveText(video.id, '# Mi edición\n\nTexto corregido.');
  const other = await store.createCollection('Trabajo');
  await store.updateVideo(video.id, { title: 'Otro título', collectionId: other.id });
  await store.renameCollection(other.id, 'Reuniones');
  const reopened = new LibraryStore(store.root);
  assert.equal((await reopened.video(video.id)).title, 'Otro título');
  assert.equal((await reopened.video(video.id)).collectionId, other.id);
  assert.match(await reopened.text(video.id), /Texto corregido/);
  assert.deepEqual(await reopened.transcript(video.id), transcript);
  assert.deepEqual(await reopened.search('corregido'), [video.id]);
  await assert.rejects(store.removeEmptyCollection(other.id), /Mueve o elimina/);
  await store.removeEmptyCollection(collection.id);
  assert.equal((await store.collections()).length, 1);
});
test('explicit retranscription backs up the edited Markdown', async t => {
  const { store, source, collection } = await fixture(t);
  const video = await store.importVideo(collection.id, source);
  await store.saveTranscript(video.id, transcript);
  await store.saveText(video.id, 'Corrección manual importante');
  await store.saveTranscript(video.id, { ...transcript, segments: [] });
  assert.equal(await fs.readFile(path.join(store.videoDir(video.id), 'transcript.previous.md'), 'utf8'), 'Corrección manual importante');
  assert.deepEqual((await store.transcript(video.id))?.segments, []);
});
test('serial mutations preserve updates and reject duplicate collections even concurrently', async t => {
  const { store, source, collection } = await fixture(t);
  const results = await Promise.allSettled([store.createCollection('Igual'), store.createCollection('igual')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const video = await store.importVideo(collection.id, source);
  await Promise.all([store.updateVideo(video.id, { title: 'Nuevo' }), store.updateVideo(video.id, { error: 'Prueba' })]);
  assert.equal((await store.video(video.id)).title, 'Nuevo');
  assert.equal((await store.video(video.id)).error, 'Prueba');
});
test('paths cannot escape storage and imports do not leave partial entries', async t => {
  const { store, collection } = await fixture(t);
  for (const id of ['../outside', '/tmp/file', '', '..', `${randomUUID()}/..`]) assert.throws(() => store.videoDir(id));
  assert.throws(() => validId('bad'));
  await assert.rejects(store.importVideo(collection.id, '/missing/video.mp4'));
  await assert.rejects(store.importVideo(collection.id, '/missing/script.sh'), /no admitido/);
  assert.deepEqual(await store.videos(), []);
  assert.deepEqual(await fs.readdir(path.join(store.root, 'videos')), []);
  assert.throws(() => validName('  '));
  assert.throws(() => validName('x\nfoo'));
  // Display names are metadata, never filesystem paths.
  const c = await store.createCollection('../es solo un nombre');
  assert.equal((await store.collection(c.id)).name, '../es solo un nombre');
});
test('SRT and VTT use millisecond timestamps with proper rollover', () => {
  assert.equal(timestamp(3599.9996, true), '01:00:00.000');
  assert.match(subtitles(transcript, 'srt'), /^1\n00:00:00,125 --> 00:00:02,990\nHola mundo\.\n\n2\n/);
  assert.match(subtitles(transcript, 'vtt'), /^WEBVTT\n\n00:00:00.125 --> 00:00:02.990/);
  assert.equal(parseTranscript(transcript), transcript);
  assert.throws(() => parseTranscript({ ...transcript, segments: [{ start: -1, end: 0, text: 'bad' }] }));
  assert.throws(() => parseTranscript({ ...transcript, segments: [{ start: 1, end: 0, text: 'bad' }] }));
});
