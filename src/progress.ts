import { t, english } from './i18n';
import type { Job, JobStageId } from './domain';

export const STAGE_LABELS: Record<JobStageId, string> = {
  preparing: english.stagePreparing, audio: english.stageAudio, speakers: english.stageSpeakers,
  speech: english.stageSpeech, transcription: english.stageTranscription, saving: english.stageSaving
};
export interface ProgressEvent { stage?: JobStageId; message?: string; percent?: number; restart?: boolean }
export function updateJobProgress(job: Job, event: ProgressEvent): void {
  if (event.restart) { job.stages = []; delete job.stage; delete job.percent; }
  const stage = event.stage && Object.hasOwn(STAGE_LABELS, event.stage) ? event.stage : undefined;
  if (stage && stage !== job.stage) {
    const previous = job.stages?.find(s => s.id === job.stage);
    if (previous) { previous.state = 'done'; if (previous.percent !== undefined) previous.percent = 100; }
    job.stage = stage;
    delete job.percent;
    const stages = job.stages ??= [];
    const existing = stages.find(s => s.id === stage);
    if (existing) { existing.state = 'running'; delete existing.percent; }
    else stages.push({ id: stage, state: 'running' });
    job.message = STAGE_LABELS[stage];
  }
  if (event.message) job.message = event.message;
  if (event.percent !== undefined && Number.isFinite(event.percent)) {
    job.percent = Math.max(0, Math.min(100, event.percent));
    const current = job.stages?.find(s => s.id === job.stage);
    if (current) current.percent = job.percent;
  }
}
export function jobProgressLabel(job: Job): string {
  const label = job.stage ? stageLabel(job.stage) : job.state === 'queued' ? t('queued') : t('preparing');
  return `${label}${job.percent !== undefined ? ` · ${Math.floor(job.percent)}%` : '…'}`;
}

export function stageLabel(stage: JobStageId): string {
  const keys = { preparing: 'stagePreparing', audio: 'stageAudio', speakers: 'stageSpeakers', speech: 'stageSpeech', transcription: 'stageTranscription', saving: 'stageSaving' } as const;
  return t(keys[stage]);
}
