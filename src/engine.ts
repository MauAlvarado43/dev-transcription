import { t, english, localizeMessage } from './i18n';
import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { runProcess } from './process';
import { parseTranscript, Transcript } from './domain';
import type { ProgressEvent } from './progress';

export interface EngineOptions { model: string; device: string; language: string; prompt: string; offline: boolean; diarization: boolean; numSpeakers: number; speakerThreshold: number }
export interface EngineEvent extends ProgressEvent { type: string; cuda?: number }
export class Engine implements vscode.Disposable {
  private operations = new Set<AbortController>();
  private installing?: Promise<void>;
  readonly python: string;
  readonly cache: string;
  constructor(private readonly extensionPath: string, readonly root: string, private readonly output: vscode.OutputChannel) {
    this.python = path.join(root, 'runtime', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    this.cache = path.join(root, 'models');
  }
  options(): EngineOptions {
    const c = vscode.workspace.getConfiguration('devTranscription');
    return { model: c.get('model', 'large-v3'), device: c.get('device', 'auto'), language: c.get('language', 'auto'), prompt: c.get('initialPrompt', ''), offline: c.get('offline', false), diarization: c.get('diarization', true), numSpeakers: c.get('numSpeakers', 0), speakerThreshold: c.get('speakerThreshold', 0.5) };
  }
  private async worker(args: string[], signal: AbortSignal, event: (e: EngineEvent) => void = () => {}): Promise<string> {
    let failure: string | undefined;
    try {
      return await runProcess(this.python, ['-u', path.join(this.extensionPath, 'python', 'transcribe.py'), '--cache', this.cache, ...args], {
        signal, log: text => this.output.appendLine(text), line: line => {
          let parsed: EngineEvent;
          try { parsed = JSON.parse(line) as EngineEvent; } catch { return; }
          if (parsed.type === 'error') failure = parsed.message;
          event(parsed);
        }
      });
    } catch (error) {
      if (signal.aborted || !failure) throw error;
      throw new Error(failure);
    }
  }
  async ready(): Promise<boolean> {
    try { await fs.access(this.python); return (await fs.readFile(path.join(this.root, 'engine-ready'), 'utf8')).trim() === '0.2.0-speakers'; } catch { return false; }
  }
  async setup(): Promise<void> {
    if (this.installing) return this.installing;
    this.installing = this.install();
    try { await this.installing; } finally { this.installing = undefined; }
  }
  private async install(): Promise<void> {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('preparingEngine'), cancellable: true }, async (progress, token) => {
      const controller = new AbortController();
      this.operations.add(controller);
      const listener = token.onCancellationRequested(() => controller.abort());
      const execute = (cmd: string, args: string[]) => runProcess(cmd, args, { signal: controller.signal, log: text => this.output.appendLine(text) });
      try {
        await fs.mkdir(this.root, { recursive: true });
        let hasPython = false;
        try { await fs.access(this.python); hasPython = true; } catch { /* Not installed yet. */ }
        if (!hasPython) {
          const configured = vscode.workspace.getConfiguration('devTranscription').get<string>('pythonPath', '').trim();
          progress.report({ message: t('creatingPython') });
          if (configured) await execute(configured, ['-m', 'venv', path.join(this.root, 'runtime')]);
          else {
            let useUv = true;
            try { await execute('uv', ['--version']); } catch (error) { if (controller.signal.aborted) throw error; useUv = false; }
            if (useUv) await execute('uv', ['venv', '--python', '3.12', '--seed', path.join(this.root, 'runtime')]);
            else await execute(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'venv', path.join(this.root, 'runtime')]);
          }
        }
        progress.report({ message: t('installingDecoder') });
        await execute(this.python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', path.join(this.extensionPath, 'python', 'requirements.txt')]);
        if (process.platform === 'linux' && this.options().device !== 'cpu') {
          let nvidia = false;
          try { await execute('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader']); nvidia = true; } catch (error) { if (controller.signal.aborted) throw error; }
          if (nvidia) {
            progress.report({ message: t('installingCuda') });
            await execute(this.python, ['-m', 'pip', 'install', '--disable-pip-version-check', 'nvidia-cublas-cu12>=12,<13', 'nvidia-cudnn-cu12>=9,<10']);
          }
        }
        await this.worker(['--check'], controller.signal);
        await fs.writeFile(path.join(this.root, 'engine-ready'), '0.2.0-speakers\n');
        void vscode.window.showInformationMessage(t('engineReadyNotice'));
      } finally { listener.dispose(); this.operations.delete(controller); }
    });
  }
  async transcribe(input: string, output: string, signal: AbortSignal, event: (e: EngineEvent) => void): Promise<Transcript> {
    const options = this.options();
    const args = ['--model', options.model, '--language', options.language, '--prompt', options.prompt, '--input', input, '--output', output, '--num-speakers', String(options.numSpeakers), '--speaker-threshold', String(options.speakerThreshold), ...(options.diarization ? [] : ['--no-speakers']), ...(options.offline ? ['--offline'] : [])];
    if (options.device === 'auto') {
      let cuda = false;
      await this.worker(['--check'], signal, e => { if (e.type === 'ready') cuda = (e.cuda ?? 0) > 0; });
      if (cuda) {
        try { await this.worker([...args, '--device', 'cuda'], signal, event); }
        catch (error) {
          if (signal.aborted) throw error;
          event({ type: 'status', stage: 'preparing', restart: true, message: english.cpuRetry });
          await this.worker([...args, '--device', 'cpu'], signal, event);
        }
      } else await this.worker([...args, '--device', 'cpu'], signal, event);
    } else await this.worker([...args, '--device', options.device], signal, event);
    return parseTranscript(JSON.parse(await fs.readFile(output, 'utf8')));
  }
  async downloadModel(): Promise<void> {
    if (!await this.ready()) await this.setup();
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('downloadingModel', { model: this.options().model }), cancellable: true }, async (progress, token) => {
      const controller = new AbortController();
      this.operations.add(controller);
      const listener = token.onCancellationRequested(() => controller.abort());
      try { await this.worker(['--download', '--model', this.options().model, '--device', 'cpu', ...(this.options().diarization ? [] : ['--no-speakers'])], controller.signal, e => progress.report({ message: e.message ? localizeMessage(e.message) : undefined })); }
      finally { listener.dispose(); this.operations.delete(controller); }
    });
    void vscode.window.showInformationMessage(t('modelDownloaded'));
  }
  dispose(): void { for (const controller of this.operations) controller.abort(); }
}
