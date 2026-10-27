import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DIALOGUE_OPTIONS, readingBlocks } from '../src/dialogues';
import { markdown, type Transcript } from '../src/domain';

function transcript(): Transcript {
  return { version: 1, model: 'test', language: 'mul', device: 'cpu', duration: 45,
    speakers: [{ id: 'actor-001', name: 'Mau' }, { id: 'actor-002', name: 'Ana' }], segments: [
      { id: 'segment-000001', speakerId: 'actor-001', start: 0, end: 2, text: 'Hello.' },
      { id: 'segment-000002', speakerId: 'actor-001', start: 3, end: 5, text: 'Seguimos en español.' },
      { id: 'segment-000003', speakerId: 'actor-002', start: 6, end: 8, text: 'De acuerdo.' },
      { id: 'segment-000004', speakerId: 'actor-001', start: 9, end: 11, text: 'Otra intervención.' },
      { id: 'segment-000005', speakerId: 'actor-001', start: 17, end: 19, text: 'Después de una pausa.' },
      { id: 'segment-000006', speakerId: 'actor-001', start: 20, end: 45, text: 'Una explicación larga.' }
    ] };
}
test('grouping respects speaker turns, pauses and maximum duration', () => {
  const t = transcript();
  const blocks = readingBlocks(markdown('Reunión', t), t, { ...DEFAULT_DIALOGUE_OPTIONS, dialogueMaxSeconds: 20 });
  const dialogues = blocks.filter(b => b.kind === 'dialogue');
  assert.deepEqual(dialogues.map(d => d.lines.length), [2, 1, 1, 1, 1]);
  assert.deepEqual(dialogues[0]?.lines.map(l => l.segmentId), ['segment-000001', 'segment-000002']);
  assert.equal(dialogues[0]?.start, 0); assert.equal(dialogues[0]?.end, 5);
  assert.equal(dialogues[1]?.speakerId, 'actor-002');
});
test('reading uses edited prose, stable speaker IDs and configurable limits without mutating data', () => {
  const t = transcript(); const original = structuredClone(t);
  const text = markdown('Reunión', t).replace('Hello.', 'Texto corregido manualmente.');
  const blocks = readingBlocks(text, t, { ...DEFAULT_DIALOGUE_OPTIONS, dialogueGapSeconds: 10 });
  const dialogues = blocks.filter(b => b.kind === 'dialogue');
  assert.deepEqual(dialogues.map(d => d.lines.length), [2, 1, 3]);
  assert.equal(dialogues[0]!.lines[0]!.text, 'Texto corregido manualmente.');
  assert.deepEqual(t, original);
  const fragments = readingBlocks(text, t, { ...DEFAULT_DIALOGUE_OPTIONS, groupDialogues: false }).filter(b => b.kind === 'dialogue');
  assert.equal(fragments.length, t.segments.length);
  assert.ok(fragments.every(b => b.lines.length === 1));
});
test('legacy timestamps group by time, notes break groups, and reordered times are not merged', () => {
  const text = '# Notas\n\n**[00:00:01]** Primera frase.\n\n**[00:00:03]** Continuación.\n\nUna nota manual.\n\n**[00:00:04]** Otra intervención.\n\n**[00:00:02]** Fragmento reordenado.';
  const blocks = readingBlocks(text);
  assert.deepEqual(blocks.map(b => b.kind), ['heading', 'dialogue', 'text', 'dialogue', 'dialogue']);
  assert.equal(blocks[1]?.kind === 'dialogue' && blocks[1].lines.length, 2);
  assert.equal(blocks[2]?.kind === 'text' && blocks[2].text, 'Una nota manual.');
});
test('speaker reassignment metadata overrides stale Markdown labels when grouping', () => {
  const t = transcript(); const text = markdown('Reunión', t);
  t.segments[1]!.speakerId = 'actor-002';
  const blocks = readingBlocks(text, t).filter(b => b.kind === 'dialogue');
  assert.equal(blocks[0]!.lines.length, 1);
  assert.equal(blocks[1]!.speakerId, 'actor-002');
  assert.equal(blocks[1]!.lines.length, 2);
});
