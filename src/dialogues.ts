import { timestamp, type Segment, type Transcript } from './domain';

export interface DialogueOptions { groupDialogues: boolean; dialogueGapSeconds: number; dialogueMaxSeconds: number }
export const DEFAULT_DIALOGUE_OPTIONS: DialogueOptions = { groupDialogues: true, dialogueGapSeconds: 3, dialogueMaxSeconds: 60 };
export interface DialogueLine { start: number; end: number; text: string; speakerId?: string; segmentId?: string }
export type ReadingBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'dialogue'; start: number; end: number; speakerId?: string; lines: DialogueLine[] };

/** Parse the edited Markdown while resolving speaker identities from stable IDs. */
export function readingBlocks(text: string, transcript?: Transcript, options = DEFAULT_DIALOGUE_OPTIONS): ReadingBlock[] {
  const byId = new Map<string, Segment>();
  const byTime = new Map<string, Segment[]>();
  for (const segment of transcript?.segments ?? []) {
    if (segment.id) byId.set(segment.id, segment);
    const key = timestamp(segment.start);
    const matches = byTime.get(key) ?? []; matches.push(segment); byTime.set(key, matches);
  }
  const blocks: ReadingBlock[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const heading = /^(#{1,3})\s+(.*)/.exec(line);
    if (heading) { blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! }); continue; }
    const time = /^\*\*\[(\d+):(\d{2}):(\d{2})\](?:\(#(segment-\d{6,})\))?\*\*\s*(.*)/.exec(line);
    if (!time) { blocks.push({ kind: 'text', text: line }); continue; }
    const content = time[5] ?? '';
    const label = /^\*\*\[(actor-(?:\d{3,}|unknown))\]\*\*\s*/.exec(content);
    const matches = byTime.get(`${time[1]}:${time[2]}:${time[3]}`) ?? [];
    const segment = time[4] ? byId.get(time[4]) : matches.length === 1 ? matches[0] : undefined;
    const start = segment?.start ?? Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]);
    const entry: DialogueLine = { start, end: segment?.end ?? start, speakerId: segment?.speakerId ?? label?.[1], segmentId: segment?.id ?? time[4], text: label ? content.slice(label[0].length) : content };
    const previous = blocks.at(-1);
    const last = previous?.kind === 'dialogue' ? previous.lines.at(-1) : undefined;
    if (options.groupDialogues && previous?.kind === 'dialogue' && last && previous.speakerId === entry.speakerId && entry.start >= last.start && entry.start - last.end <= options.dialogueGapSeconds && Math.max(previous.end, entry.end) - previous.start <= options.dialogueMaxSeconds) {
      previous.lines.push(entry); previous.end = Math.max(previous.end, entry.end);
    } else blocks.push({ kind: 'dialogue', start: entry.start, end: entry.end, speakerId: entry.speakerId, lines: [entry] });
  }
  return blocks;
}
