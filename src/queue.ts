import { english } from './i18n';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Engine } from './engine';
import { Job } from './domain';
import { LibraryStore } from './store';
import { Cancelled } from './process';
import { updateJobProgress } from './progress';

export class TranscriptionQueue {
  private jobs = new Map<string, Job>();
  private current?: { id: string; controller: AbortController };
  private draining = false;
  private disposed = false;
  constructor(private readonly store: LibraryStore, private readonly engine: Engine,
    private readonly changed: (completed?: string) => void, private readonly failed: (message: string) => void) {}
  snapshot(): Job[] { return [...this.jobs.values()].map(j => ({ ...j, stages: j.stages?.map(s => ({ ...s })) })); }
  has(id: string): boolean { return this.jobs.has(id); }
  async add(id: string): Promise<void> {
    if (this.disposed || this.has(id)) return;
    await this.store.video(id);
    if (this.disposed || this.has(id)) return;
    this.jobs.set(id, { id, state: 'queued', message: english.queued });
    this.changed();
    void this.drain();
  }
  cancel(id: string): void {
    if (this.current?.id === id) this.current.controller.abort();
    else { this.jobs.delete(id); this.changed(); }
  }
  private async drain(): Promise<void> {
    if (this.draining || this.disposed) return;
    this.draining = true;
    try {
      while (this.jobs.size && !this.disposed) {
        const [id, job] = this.jobs.entries().next().value!;
        const controller = new AbortController();
        this.current = { id, controller };
        job.state = 'running'; job.message = english.queuePreparing;
        updateJobProgress(job, { stage: 'preparing', message: english.queuePreparing });
        this.changed();
        const temp = path.join(this.engine.root, `job-${randomUUID()}.json`);
        let completed = false;
        try {
          await fs.mkdir(this.engine.root, { recursive: true });
          const result = await this.engine.transcribe(await this.store.source(id), temp, controller.signal, e => {
            updateJobProgress(job, e);
            this.changed();
          });
          if (controller.signal.aborted) throw new Cancelled();
          updateJobProgress(job, { stage: 'saving', message: english.queueSaving });
          this.changed();
          await this.store.saveTranscript(id, result);
          completed = true;
        } catch (error) {
          if (!(error instanceof Cancelled) && !controller.signal.aborted) {
            const message = error instanceof Error ? error.message : String(error);
            await this.store.updateVideo(id, { error: message.slice(-2000) }).catch(() => {});
            this.failed(message);
          }
        } finally {
          await fs.rm(temp, { force: true }).catch(() => {});
          await fs.rm(temp.replace(/\.json$/, '.partial'), { force: true }).catch(() => {});
          this.current = undefined;
          this.jobs.delete(id);
          this.changed(completed ? id : undefined);
        }
      }
    } finally { this.draining = false; }
  }
  dispose(): void { this.disposed = true; this.current?.controller.abort(); this.jobs.clear(); }
}
