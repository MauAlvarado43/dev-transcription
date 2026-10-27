import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Collection, Video, Transcript, Speaker, validId, validName, requireSpeakerId, VIDEO_EXTENSIONS, markdown, parseTranscript, timestamp } from './domain';

export async function atomicWrite(file: string, text: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, text, { flag: 'wx' });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}
async function optionalText(file: string): Promise<string | undefined> {
  try { return await fs.readFile(file, 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
}
export class LibraryStore {
  private serial: Promise<unknown> = Promise.resolve();
  constructor(readonly root: string) {}
  private mutate<T>(action: () => Promise<T>): Promise<T> {
    const result = this.serial.then(action);
    this.serial = result.catch(() => {});
    return result;
  }
  async init(): Promise<void> {
    await fs.mkdir(path.join(this.root, 'collections'), { recursive: true });
    await fs.mkdir(path.join(this.root, 'videos'), { recursive: true });
  }
  videoDir(id: string): string { return path.join(this.root, 'videos', validId(id)); }
  private collectionFile(id: string): string { return path.join(this.root, 'collections', `${validId(id)}.json`); }
  async collections(): Promise<Collection[]> {
    await this.init();
    const files = (await fs.readdir(path.join(this.root, 'collections'))).filter(f => /^[\da-f-]+\.json$/i.test(f));
    return (await Promise.all(files.map(async f => JSON.parse(await fs.readFile(path.join(this.root, 'collections', f), 'utf8')) as Collection))).sort((a,b) => a.name.localeCompare(b.name));
  }
  async videos(): Promise<Video[]> {
    await this.init();
    const entries = await fs.readdir(path.join(this.root, 'videos'), { withFileTypes: true });
    const result: Video[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      result.push(await this.video(entry.name));
    }
    return result.sort((a,b) => b.importedAt.localeCompare(a.importedAt));
  }
  async video(id: string): Promise<Video> {
    const video = JSON.parse(await fs.readFile(path.join(this.videoDir(id), 'video.json'), 'utf8')) as Video;
    if (video.id !== id || typeof video.title !== 'string' || typeof video.fileName !== 'string' || !/^source\.[a-z0-9]+$/.test(video.fileName)) throw new Error('Metadatos de video inválidos.');
    validId(video.collectionId);
    return video;
  }
  async collection(id: string): Promise<Collection> {
    const c = JSON.parse(await fs.readFile(this.collectionFile(id), 'utf8')) as Collection;
    if (c.id !== id || typeof c.name !== 'string') throw new Error('Colección inválida.');
    return c;
  }
  createCollection(name: string): Promise<Collection> {
    return this.mutate(async () => {
      name = validName(name);
      if ((await this.collections()).some(c => c.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('Ya existe una colección con ese nombre.');
      const collection = { id: randomUUID(), name };
      await atomicWrite(this.collectionFile(collection.id), JSON.stringify(collection, null, 2));
      return collection;
    });
  }
  renameCollection(id: string, name: string): Promise<void> {
    return this.mutate(async () => {
      name = validName(name);
      const c = await this.collection(id);
      if ((await this.collections()).some(x => x.id !== id && x.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('Ya existe una colección con ese nombre.');
      await atomicWrite(this.collectionFile(id), JSON.stringify({ ...c, name }, null, 2));
    });
  }
  removeEmptyCollection(id: string): Promise<void> {
    return this.mutate(async () => {
      await this.collection(id);
      if ((await this.videos()).some(v => v.collectionId === id)) throw new Error('Mueve o elimina los videos antes de borrar la colección.');
      await fs.unlink(this.collectionFile(id));
    });
  }
  importVideo(collectionId: string, source: string): Promise<Video> {
    return this.mutate(async () => {
      await this.collection(collectionId);
      const ext = path.extname(source).slice(1).toLowerCase();
      if (!VIDEO_EXTENSIONS.includes(ext)) throw new Error('Formato de video no admitido.');
      const stat = await fs.stat(source);
      if (!stat.isFile()) throw new Error('Selecciona un archivo de video.');
      const id = randomUUID();
      const staging = path.join(this.root, 'videos', `.import-${id}`);
      const video: Video = { id, collectionId, title: path.basename(source, path.extname(source)), fileName: `source.${ext}`, originalName: path.basename(source), bytes: stat.size, importedAt: new Date().toISOString() };
      await fs.mkdir(staging);
      try {
        await fs.copyFile(source, path.join(staging, video.fileName));
        await fs.writeFile(path.join(staging, 'video.json'), JSON.stringify(video, null, 2));
        await fs.rename(staging, this.videoDir(id));
      } finally { await fs.rm(staging, { recursive: true, force: true }); }
      return video;
    });
  }
  updateVideo(id: string, fields: Partial<Pick<Video, 'title' | 'collectionId' | 'transcribedAt' | 'error'>>): Promise<Video> {
    return this.mutate(async () => {
      if (fields.title !== undefined) fields.title = validName(fields.title);
      if (fields.collectionId) await this.collection(fields.collectionId);
      const video = { ...await this.video(id), ...fields };
      await atomicWrite(path.join(this.videoDir(id), 'video.json'), JSON.stringify(video, null, 2));
      return video;
    });
  }
  async source(id: string): Promise<string> { const v = await this.video(id); return path.join(this.videoDir(id), v.fileName); }
  async transcript(id: string): Promise<Transcript | undefined> {
    const text = await optionalText(path.join(this.videoDir(id), 'transcript.json'));
    return text ? parseTranscript(JSON.parse(text)) : undefined;
  }
  async text(id: string): Promise<string> { return await optionalText(path.join(this.videoDir(id), 'transcript.md')) ?? ''; }
  saveText(id: string, text: string): Promise<void> {
    return this.mutate(async () => {
      await this.video(id);
      if (text.length > 20_000_000) throw new Error('La transcripción es demasiado grande.');
      await atomicWrite(path.join(this.videoDir(id), 'transcript.md'), text);
    });
  }
  renameSpeaker(id: string, speakerId: string, name: string): Promise<Transcript> {
    return this.mutate(async () => {
      requireSpeakerId(speakerId); name = validName(name);
      const transcript = await this.transcript(id);
      const speaker = transcript?.speakers?.find(s => s.id === speakerId);
      if (!transcript || !speaker) throw new Error('No se encontró el hablante.');
      speaker.name = name;
      await atomicWrite(path.join(this.videoDir(id), 'transcript.json'), JSON.stringify(transcript, null, 2));
      return transcript;
    });
  }
  addSpeaker(id: string, name: string): Promise<Speaker> {
    return this.mutate(async () => {
      name = validName(name);
      const transcript = await this.transcript(id);
      if (!transcript) throw new Error('Primero genera una transcripción.');
      const speakers = transcript.speakers ??= [];
      const next = Math.max(0, ...speakers.map(s => Number(s.id.split('-')[1]) || 0)) + 1;
      const speaker = { id: `actor-${String(next).padStart(3, '0')}`, name };
      speakers.push(speaker);
      await atomicWrite(path.join(this.videoDir(id), 'transcript.json'), JSON.stringify(transcript, null, 2));
      return speaker;
    });
  }
  assignSpeaker(id: string, segmentId: string, speakerId: string): Promise<Transcript> {
    return this.mutate(async () => {
      requireSpeakerId(speakerId);
      const transcript = await this.transcript(id);
      if (!transcript || !transcript.speakers?.some(s => s.id === speakerId)) throw new Error('No se encontró el hablante.');
      // Legacy transcripts gain stable segment IDs on the first correction.
      transcript.segments.forEach((s, i) => { s.id ??= `segment-${String(i + 1).padStart(6, '0')}`; });
      const segment = transcript.segments.find(s => s.id === segmentId);
      if (!segment) throw new Error('No se encontró el fragmento.');
      segment.speakerId = speakerId;
      const dir = this.videoDir(id);
      let text = await this.text(id);
      // Upgrade an unambiguous legacy timestamp without changing its edited prose.
      const legacy = `**[${timestamp(segment.start)}]** `;
      if (text.split(legacy).length === 2) text = text.replace(legacy, legacy.replace(']** ', `](#${segmentId})** `));
      const prefix = new RegExp(`(\\*\\*\\[[^\\n]*?\\]\\(#${segmentId}\\)\\*\\*)[ \\t]*(?:\\*\\*\\[actor-(?:\\d{3,}|unknown)\\]\\*\\*[ \\t]*)?`, 'm');
      // Change only the label of the matching ID; preserve all manually edited prose.
      const patched = text.replace(prefix, `$1 **[${speakerId}]** `);
      if (patched !== text) await atomicWrite(path.join(dir, 'transcript.md'), patched);
      await atomicWrite(path.join(dir, 'transcript.json'), JSON.stringify(transcript, null, 2));
      return transcript;
    });
  }
  saveTranscript(id: string, transcript: Transcript): Promise<void> {
    return this.mutate(async () => {
      const video = await this.video(id);
      parseTranscript(transcript);
      const dir = this.videoDir(id);
      // Keep edited text recoverable when explicitly regenerating a transcription.
      const old = await optionalText(path.join(dir, 'transcript.md'));
      if (old !== undefined) await atomicWrite(path.join(dir, 'transcript.previous.md'), old);
      const oldJson = await optionalText(path.join(dir, 'transcript.json'));
      if (oldJson !== undefined) await atomicWrite(path.join(dir, 'transcript.previous.json'), oldJson);
      await atomicWrite(path.join(dir, 'transcript.json'), JSON.stringify(transcript, null, 2));
      await atomicWrite(path.join(dir, 'transcript.md'), markdown(video.title, transcript));
      await atomicWrite(path.join(dir, 'video.json'), JSON.stringify({ ...video, transcribedAt: new Date().toISOString(), error: undefined }, null, 2));
    });
  }
  async search(query: string): Promise<string[]> {
    const q = query.toLocaleLowerCase();
    const matches: string[] = [];
    for (const v of await this.videos()) if (v.title.toLocaleLowerCase().includes(q) || (await this.text(v.id)).toLocaleLowerCase().includes(q) || (await this.transcript(v.id))?.speakers?.some(s => s.name.toLocaleLowerCase().includes(q))) matches.push(v.id);
    return matches;
  }
}
