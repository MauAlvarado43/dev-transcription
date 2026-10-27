import { LocalizedError } from './i18n';
export const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'mpeg', 'mpg', 'wmv', 'flv', 'mts', 'm2ts', 'ogv'];
export interface Collection { id: string; name: string }
export interface Video {
  id: string; collectionId: string; title: string; fileName: string; originalName: string;
  bytes: number; importedAt: string; transcribedAt?: string; error?: string;
}
export interface Speaker { id: string; name: string }
export interface Segment { id?: string; start: number; end: number; text: string; speakerId?: string; language?: string }
export interface Transcript {
  version: 1; language: string; duration: number; model: string; device: string;
  segments: Segment[];
  speakers?: Speaker[];
  multilingual?: boolean;
  languages?: string[];
}
export type JobStageId = 'preparing' | 'audio' | 'speakers' | 'speech' | 'transcription' | 'saving';
export interface StageProgress { id: JobStageId; state: 'running' | 'done'; percent?: number }
export interface Job { id: string; state: 'queued' | 'running'; message: string; percent?: number; stage?: JobStageId; stages?: StageProgress[] }
export interface LibraryState { collections: Collection[]; videos: Video[]; jobs: Job[] }
export function validName(input: string): string {
  const name = input.trim();
  if (!name || name.length > 160 || /[\x00-\x1f]/.test(name)) throw new LocalizedError('invalidName');
  return name;
}
export function validId(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new LocalizedError('invalidId');
  return id;
}
export function timestamp(seconds: number, milliseconds = false, separator = '.'): string {
  const value = Math.max(0, Math.round(seconds * 1000));
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(Math.floor(value / 3600000))}:${pad(Math.floor(value / 60000) % 60)}:${pad(Math.floor(value / 1000) % 60)}${milliseconds ? separator + pad(value % 1000, 3) : ''}`;
}
export function markdown(title: string, transcript: Transcript): string {
  return `# ${title.replace(/[\r\n]/g, ' ')}\n\n` + transcript.segments.map(s => `**[${timestamp(s.start)}]${s.id ? `(#${s.id})` : ''}** ${s.speakerId ? `**[${s.speakerId}]** ` : ''}${s.text.trim()}\n`).join('\n');
}
export function speakerName(transcript: Transcript, id: string): string {
  return transcript.speakers?.find(s => s.id === id)?.name ?? id;
}
export function speakerText(transcript: Transcript, segment: Segment): string {
  return segment.speakerId ? `${speakerName(transcript, segment.speakerId)} [${segment.speakerId}]: ${segment.text}` : segment.text;
}
export function exportMarkdown(text: string, transcript?: Transcript): string {
  const annotated = text.replace(/(\*\*\[[^\n]*?\])\(#(segment-\d{6,})\)(\*\*)[ \t]*(?:\*\*\[actor-(?:\d{3,}|unknown)\]\*\*[ \t]*)?/g, (_, time: string, id: string, end: string) => {
    const speaker = transcript?.segments.find(s => s.id === id)?.speakerId;
    return `${time}${end} ${speaker ? `**[${speaker}]** ` : ''}`;
  });
  return annotated.replace(/\*\*\[(actor-(?:\d{3,}|unknown))\]\*\*/g, (_, id: string) => {
    const name = transcript ? speakerName(transcript, id).replace(/[\\`*_[\]<>]/g, '\\$&') : id;
    return `**${name} [${id}]:**`;
  });
}
export function requireSpeakerId(id: string): string {
  if (!/^actor-(?:\d{3,}|unknown)$/.test(id)) throw new LocalizedError('invalidSpeakerId');
  return id;
}
export function subtitles(transcript: Transcript, format: 'srt' | 'vtt'): string {
  return (format === 'vtt' ? 'WEBVTT\n\n' : '') + transcript.segments.map((s, i) =>
    `${format === 'srt' ? `${i + 1}\n` : ''}${timestamp(s.start, true, format === 'srt' ? ',' : '.')} --> ${timestamp(s.end, true, format === 'srt' ? ',' : '.')}\n${speakerText(transcript, s).replace(/[<>]/g, '').replace(/\r?\n/g, ' ').trim()}\n\n`
  ).join('');
}
export function parseTranscript(value: unknown): Transcript {
  const t = value as Transcript;
  if (!t || t.version !== 1 || typeof t.language !== 'string' || typeof t.model !== 'string' || typeof t.device !== 'string' || !Number.isFinite(t.duration) || t.duration < 0 || !Array.isArray(t.segments)) throw new LocalizedError('invalidTranscript');
  if (t.multilingual !== undefined && typeof t.multilingual !== 'boolean') throw new LocalizedError('invalidMultilingual');
  if (t.languages !== undefined && (!Array.isArray(t.languages) || t.languages.some(l => typeof l !== 'string' || !/^[a-z]{2,3}$/.test(l)))) throw new LocalizedError('invalidLanguages');
  let previous = 0;
  const speakerIds = new Set<string>();
  if (t.speakers !== undefined) {
    if (!Array.isArray(t.speakers)) throw new LocalizedError('invalidSpeakers');
    for (const speaker of t.speakers) {
      if (!speaker || typeof speaker.id !== 'string' || typeof speaker.name !== 'string' || speakerIds.has(speaker.id)) throw new LocalizedError('duplicateSpeaker');
      requireSpeakerId(speaker.id); validName(speaker.name); speakerIds.add(speaker.id);
    }
  }
  const segmentIds = new Set<string>();
  for (const s of t.segments) {
    if (!s || typeof s.text !== 'string' || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < previous || s.end < s.start) throw new LocalizedError('invalidSegment');
    previous = s.start;
    if (s.id !== undefined) {
      if (typeof s.id !== 'string' || !/^segment-\d{6,}$/.test(s.id) || segmentIds.has(s.id)) throw new LocalizedError('duplicateSegment');
      segmentIds.add(s.id);
    }
    if (s.speakerId !== undefined && (typeof s.speakerId !== 'string' || !speakerIds.has(s.speakerId))) throw new LocalizedError('missingSpeakerReference');
    if (s.language !== undefined && (typeof s.language !== 'string' || !/^[a-z]{2,3}$/.test(s.language))) throw new LocalizedError('invalidSegmentLanguage');
  }
  return t;
}
