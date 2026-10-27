import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { LibraryStore } from '../src/store';
import { exportMarkdown, markdown, parseTranscript, speakerText, subtitles, type Transcript } from '../src/domain';

function conversation(): Transcript {
  return { version: 1, language: 'en', multilingual: true, duration: 12, model: 'large-v3', device: 'cuda',
    speakers: [{ id: 'actor-001', name: 'Hablante 1' }, { id: 'actor-002', name: 'Hablante 2' }],
    segments: [
      { id: 'segment-000001', speakerId: 'actor-001', start: 0, end: 3, text: 'Hello, how are you?' },
      { id: 'segment-000002', speakerId: 'actor-002', start: 4, end: 7, text: 'Muy bien, gracias.' },
      { id: 'segment-000003', speakerId: 'actor-001', start: 8, end: 12, text: 'Great, seguimos en español.' },
    ] };
}
test('speaker names resolve in Markdown, text and subtitles without changing stable IDs', () => {
  const transcript = conversation();
  const text = markdown('Conversación', transcript);
  transcript.speakers![0]!.name = 'Mauricio';
  const exported = exportMarkdown(text, transcript);
  assert.equal((exported.match(/Mauricio \[actor-001\]/g) ?? []).length, 2);
  assert.ok(!exported.includes('#segment-'));
  assert.match(subtitles(transcript, 'srt'), /Mauricio \[actor-001\]: Hello/);
  assert.match(subtitles(transcript, 'vtt'), /Hablante 2 \[actor-002\]: Muy bien/);
  assert.match(speakerText(transcript, transcript.segments[0]!), /^Mauricio \[actor-001\]/);
  assert.deepEqual(transcript.segments.map(s => s.speakerId), ['actor-001', 'actor-002', 'actor-001']);
});
test('rename, correction, manual actor and restart preserve edited prose and speaker identity', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'transcription-speakers-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new LibraryStore(path.join(root, 'library')); await store.init();
  const collection = await store.createCollection('Conversaciones');
  const source = path.join(root, 'source.mp4'); await fs.writeFile(source, 'video');
  const video = await store.importVideo(collection.id, source);
  await store.saveTranscript(video.id, conversation());
  await store.saveText(video.id, (await store.text(video.id)).replace('Hello, how are you?', 'Hello, edited manually!'));
  const edited = await store.text(video.id);
  await store.renameSpeaker(video.id, 'actor-001', 'Mauricio');
  assert.equal(await store.text(video.id), edited);
  const added = await store.addSpeaker(video.id, 'Ana'); assert.equal(added.id, 'actor-003');
  await store.assignSpeaker(video.id, 'segment-000001', added.id);
  const reopened = new LibraryStore(store.root);
  const result = (await reopened.transcript(video.id))!;
  assert.equal(result.segments[0]!.speakerId, 'actor-003');
  assert.equal(result.segments[2]!.speakerId, 'actor-001');
  assert.equal(result.speakers![0]!.name, 'Mauricio');
  assert.match(await reopened.text(video.id), /\*\*\[actor-003\]\*\* Hello, edited manually!/);
  assert.match(exportMarkdown(await reopened.text(video.id), result), /Ana \[actor-003\]/);
  assert.deepEqual(await reopened.search('mauricio'), [video.id]);
  await assert.rejects(store.renameSpeaker(video.id, '../escape', 'Invalid'));
  await assert.rejects(store.assignSpeaker(video.id, 'segment-000001', 'actor-999'), /No se encontró/);
  await store.saveTranscript(video.id, conversation());
  const previous = JSON.parse(await fs.readFile(path.join(store.videoDir(video.id), 'transcript.previous.json'), 'utf8')) as Transcript;
  assert.equal(previous.speakers![0]!.name, 'Mauricio');
});
test('legacy transcripts can receive a speaker without losing text edits', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-speakers-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new LibraryStore(path.join(root, 'library')); await store.init();
  const c = await store.createCollection('Legacy'); const source = path.join(root, 'v.mp4'); await fs.writeFile(source, 'v');
  const v = await store.importVideo(c.id, source);
  const old: Transcript = { version: 1, language: 'es', model: 'test', device: 'cpu', duration: 3, segments: [{ start: 0, end: 3, text: 'Texto original' }] };
  await store.saveTranscript(v.id, old); await store.saveText(v.id, '# Notas\n\n**[00:00:00]** Texto corregido');
  const actor = await store.addSpeaker(v.id, 'Yo'); await store.assignSpeaker(v.id, 'segment-000001', actor.id);
  assert.match(await store.text(v.id), /Texto corregido/);
  assert.match(exportMarkdown(await store.text(v.id), await store.transcript(v.id)), /Yo \[actor-001\]/);
});
test('invalid references and duplicate segment or actor IDs are rejected', () => {
  const t = conversation(); t.segments[0]!.speakerId = 'actor-999'; assert.throws(() => parseTranscript(t));
  const t2 = conversation(); t2.segments[1]!.id = t2.segments[0]!.id; assert.throws(() => parseTranscript(t2));
  const t3 = conversation(); t3.speakers!.push({ ...t3.speakers![0]! }); assert.throws(() => parseTranscript(t3));
  const t4 = conversation(); t4.speakers![0]!.name = 'Bad\nname'; assert.throws(() => parseTranscript(t4));
});
