import { spawn, ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

export class Cancelled extends Error { constructor() { super('Operación cancelada.'); } }
export interface ProcessOptions {
  signal?: AbortSignal; env?: NodeJS.ProcessEnv;
  log?: (text: string) => void; line?: (line: string) => void;
  started?: (child: ChildProcess) => void;
}
export function runProcess(command: string, args: string[], options: ProcessOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Cancelled()); return; }
    const child = spawn(command, args, { windowsHide: true, shell: false, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    options.started?.(child);
    let output = '';
    let errors = '';
    const stdout = createInterface({ input: child.stdout! });
    stdout.on('line', line => {
      output = (output + line + '\n').slice(-64000);
      options.line?.(line);
      options.log?.(line);
    });
    child.stderr!.on('data', (chunk: Buffer) => { const text = chunk.toString(); errors = (errors + text).slice(-6000); options.log?.(text); });
    let forceKill: NodeJS.Timeout | undefined;
    const abort = () => {
      child.kill('SIGTERM');
      forceKill = setTimeout(() => child.kill('SIGKILL'), 3000);
      forceKill.unref();
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const cleanup = () => { options.signal?.removeEventListener('abort', abort); if (forceKill) clearTimeout(forceKill); stdout.close(); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', (code, signal) => {
      cleanup();
      if (options.signal?.aborted) reject(new Cancelled());
      else if (code === 0) resolve(output);
      else reject(new Error(`${command} terminó (${code ?? signal}). ${errors || output}`));
    });
  });
}
