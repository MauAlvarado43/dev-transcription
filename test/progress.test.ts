import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Job } from '../src/domain';
import { jobProgressLabel, updateJobProgress } from '../src/progress';

test('each stage starts with its own percentage and retains completed stages', () => {
  const job: Job = { id: 'video', state: 'running', message: 'Preparing' };
  updateJobProgress(job, { stage: 'preparing' });
  assert.equal(job.percent, undefined);
  updateJobProgress(job, { stage: 'speakers', percent: 0 });
  updateJobProgress(job, { stage: 'speakers', percent: 65.8 });
  assert.equal(jobProgressLabel(job), 'Identifying voices · 65%');
  updateJobProgress(job, { stage: 'speakers', percent: 100 });
  updateJobProgress(job, { stage: 'speech' });
  assert.equal(job.percent, undefined, 'indeterminate stage must not keep the preceding percentage');
  updateJobProgress(job, { stage: 'transcription', percent: 0 });
  assert.equal(job.percent, 0);
  assert.deepEqual(job.stages?.find(s => s.id === 'speakers'), { id: 'speakers', state: 'done', percent: 100 });
  updateJobProgress(job, { stage: 'transcription', percent: 42.5 });
  assert.equal(jobProgressLabel(job), 'Transcribing · 42%');
  updateJobProgress(job, { stage: 'saving' });
  assert.equal(job.percent, undefined);
  assert.equal(job.stages?.find(s => s.id === 'transcription')?.percent, 100);
  assert.equal(job.stages?.find(s => s.id === 'preparing')?.percent, undefined, 'no estimated percentage for loading');
});
test('a CPU retry discards previous-attempt progress and invalid values do not pollute the UI', () => {
  const job: Job = { id: 'video', state: 'running', message: 'Starting' };
  updateJobProgress(job, { stage: 'speakers', percent: 90 });
  updateJobProgress(job, { stage: 'preparing', restart: true, message: 'Retrying on CPU' });
  assert.equal(job.percent, undefined);
  assert.deepEqual(job.stages, [{ id: 'preparing', state: 'running' }]);
  updateJobProgress(job, { stage: 'transcription', percent: NaN });
  assert.equal(job.percent, undefined);
  updateJobProgress(job, { percent: 150 }); assert.equal(job.percent, 100);
  updateJobProgress(job, { percent: -10 }); assert.equal(job.percent, 0);
});
