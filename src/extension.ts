import * as vscode from 'vscode';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { LibraryStore } from './store';
import { Engine } from './engine';
import { TranscriptionQueue } from './queue';
import { Cancelled } from './process';
import { VIDEO_EXTENSIONS, subtitles, exportMarkdown, speakerText } from './domain';
import { jobProgressLabel } from './progress';
import { DEFAULT_DIALOGUE_OPTIONS, type DialogueOptions } from './dialogues';

type Message = { type: string; id?: string; name?: string; collectionId?: string; query?: string; text?: string; revision?: number; format?: string; speakerId?: string; segmentId?: string; key?: string; value?: unknown };
interface Editor { panel: vscode.WebviewPanel; revision: number }

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const root = context.globalStorageUri.fsPath;
  const store = new LibraryStore(path.join(root, 'library'));
  await store.init();
  const output = vscode.window.createOutputChannel('Dev Transcription');
  const engine = new Engine(context.extensionPath, root, output);
  const editors = new Map<string, Editor>();
  const closing = new Map<string, Promise<void>>();
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'devTranscription.library.focus';
  const report = (error: unknown) => {
    if (error instanceof Cancelled) return;
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(message);
    void vscode.window.showErrorMessage(`Dev Transcription: ${message.slice(-650)}`, 'Ver registro').then(choice => { if (choice) output.show(); });
  };
  let sidebar: vscode.WebviewView | undefined;
  let settingsPanel: vscode.WebviewPanel | undefined;
  let disposed = false;
  let refreshTimer: NodeJS.Timeout | undefined;
  let searchVersion = 0;
  const queue = new TranscriptionQueue(store, engine, completed => {
    if (disposed) return;
    if (completed) void detail(completed).catch(report);
    scheduleRefresh();
  }, report);
  async function library(): Promise<void> {
    if (disposed) return;
    const state = { collections: await store.collections(), videos: await store.videos(), jobs: queue.snapshot() };
    await sidebar?.webview.postMessage({ type: 'library', state, options: engine.options(), ready: await engine.ready() });
    for (const [id, editor] of editors) void editor.panel.webview.postMessage({ type: 'job', job: state.jobs.find(j => j.id === id) ?? null });
    if (state.jobs.length) {
      const active = state.jobs.find(j => j.state === 'running');
      status.text = `$(sync~spin) ${active ? jobProgressLabel(active) : 'Transcripción'} · ${state.jobs.length}`;
      status.tooltip = active?.message;
      status.show();
    } else status.hide();
  }
  function scheduleRefresh(): void {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => { refreshTimer = undefined; void library().catch(report); }, 150);
  }
  function readingOptions(): DialogueOptions {
    const c = vscode.workspace.getConfiguration('devTranscription');
    return { groupDialogues: c.get('groupDialogues', DEFAULT_DIALOGUE_OPTIONS.groupDialogues), dialogueGapSeconds: c.get('dialogueGapSeconds', DEFAULT_DIALOGUE_OPTIONS.dialogueGapSeconds), dialogueMaxSeconds: c.get('dialogueMaxSeconds', DEFAULT_DIALOGUE_OPTIONS.dialogueMaxSeconds) };
  }
  async function detail(id: string): Promise<void> {
    const editor = editors.get(id);
    if (!editor) return;
    const video = await store.video(id);
    editor.panel.title = video.title;
    await editor.panel.webview.postMessage({ type: 'detail', video, transcript: await store.transcript(id), text: await store.text(id), revision: editor.revision, job: queue.snapshot().find(j => j.id === id) ?? null, readingOptions: readingOptions(), media: editor.panel.webview.asWebviewUri(vscode.Uri.file(await store.source(id))).toString() });
  }
  function bind(webview: vscode.Webview, handler: (m: Message) => Promise<void>, local: vscode.Disposable[]): () => Promise<void> {
    let chain: Promise<void> = Promise.resolve();
    local.push(webview.onDidReceiveMessage((raw: unknown) => {
      if (!raw || typeof raw !== 'object' || typeof (raw as Message).type !== 'string') return;
      const m = raw as Message;
      if (['id', 'name', 'collectionId', 'query', 'text', 'format', 'speakerId', 'segmentId'].some(key => (m as unknown as Record<string, unknown>)[key] !== undefined && typeof (m as unknown as Record<string, unknown>)[key] !== 'string')) return;
      chain = chain.then(() => handler(m)).catch(error => {
        void webview.postMessage({ type: 'error', message: error instanceof Error ? error.message.slice(-1200) : String(error) });
        report(error);
      });
    }));
    return () => chain;
  }
  function html(webview: vscode.Webview, page: 'library' | 'editor' | 'settings'): string {
    const nonce = randomBytes(20).toString('hex');
    const uri = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', name)).toString();
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; media-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${uri('webview.css')}"><title>Dev Transcription</title></head><body data-page="${page}"><div id="app"></div><script nonce="${nonce}" src="${uri('webview.js')}"></script></body></html>`;
  }
  async function settingsData(): Promise<void> {
    await settingsPanel?.webview.postMessage({ type: 'settings', options: engine.options(), readingOptions: readingOptions(), ready: await engine.ready(), pythonPath: vscode.workspace.getConfiguration('devTranscription').get('pythonPath', '') });
  }
  async function showSettings(): Promise<void> {
    if (settingsPanel) { settingsPanel.reveal(); await settingsData(); return; }
    const panel = vscode.window.createWebviewPanel('devTranscription.settings', 'Dev Transcription · Configuración', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')] });
    settingsPanel = panel;
    const local: vscode.Disposable[] = [];
    bind(panel.webview, async m => {
      switch (m.type) {
        case 'ready': await settingsData(); break;
        case 'setting': {
          const allowed: Record<string, (v: unknown) => boolean> = {
            model: v => ['large-v3', 'turbo', 'medium', 'small', 'base', 'tiny'].includes(String(v)),
            device: v => ['auto', 'cpu', 'cuda'].includes(String(v)),
            language: v => typeof v === 'string' && /^(auto|[a-z]{2,3})$/.test(v),
            initialPrompt: v => typeof v === 'string' && v.length <= 4000,
            pythonPath: v => typeof v === 'string' && v.length <= 4096,
            offline: v => typeof v === 'boolean', diarization: v => typeof v === 'boolean',
            numSpeakers: v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 30,
            speakerThreshold: v => typeof v === 'number' && Number.isFinite(v) && v >= 0.1 && v <= 0.95,
            groupDialogues: v => typeof v === 'boolean',
            dialogueGapSeconds: v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 30,
            dialogueMaxSeconds: v => typeof v === 'number' && Number.isFinite(v) && v >= 5 && v <= 300,
          };
          if (!m.key || !Object.hasOwn(allowed, m.key) || !allowed[m.key]!(m.value)) throw new Error('Valor de configuración inválido.');
          await vscode.workspace.getConfiguration('devTranscription').update(m.key, m.value, vscode.ConfigurationTarget.Global);
          await settingsData();
          break;
        }
        case 'setup': await engine.setup(); await settingsData(); await library(); break;
        case 'download': await engine.downloadModel(); await settingsData(); break;
        case 'storage': await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(store.root)); break;
        case 'logs': output.show(); break;
        case 'nativeSettings': await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:raide.dev-transcription'); break;
      }
    }, local);
    panel.onDidDispose(() => { settingsPanel = undefined; for (const d of local) d.dispose(); });
    panel.webview.html = html(panel.webview, 'settings');
  }
  async function openVideo(id: string): Promise<void> {
    await closing.get(id);
    const existing = editors.get(id);
    if (existing) { existing.panel.reveal(); return; }
    const video = await store.video(id);
    const panel = vscode.window.createWebviewPanel('devTranscription.video', video.title, vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist'), vscode.Uri.file(store.videoDir(id))]
    });
    const editor: Editor = { panel, revision: 0 };
    editors.set(id, editor);
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'dev-transcription.svg');
    const local: vscode.Disposable[] = [];
    const drainMessages = bind(panel.webview, async m => {
      switch (m.type) {
        case 'ready': await detail(id); break;
        case 'save': {
          if (typeof m.text !== 'string' || !Number.isSafeInteger(m.revision) || m.revision! < 1) return;
          if (queue.has(id)) throw new Error('Espera a que termine la transcripción para editarla.');
          // Accepted saves finish even if the panel closes before disk IO completes.
          if (m.revision! <= editor.revision) return;
          await store.saveText(id, m.text);
          editor.revision = m.revision!;
          await panel.webview.postMessage({ type: 'saved', revision: m.revision });
          break;
        }
        case 'transcribe': await transcribe(id); break;
        case 'groupDialogues': {
          if (typeof m.value !== 'boolean') return;
          await vscode.workspace.getConfiguration('devTranscription').update('groupDialogues', m.value, vscode.ConfigurationTarget.Global);
          break;
        }
        case 'renameSpeaker': case 'addSpeaker': case 'assignSpeaker': {
          if (queue.has(id)) throw new Error('Espera a que termine la transcripción para modificar hablantes.');
          if (m.type === 'renameSpeaker' && m.speakerId && m.name) await store.renameSpeaker(id, m.speakerId, m.name);
          if (m.type === 'addSpeaker' && m.name) await store.addSpeaker(id, m.name);
          if (m.type === 'assignSpeaker' && m.speakerId && m.segmentId) await store.assignSpeaker(id, m.segmentId, m.speakerId);
          await detail(id);
          break;
        }
        case 'cancel': queue.cancel(id); break;
        case 'export': await exportVideo(id, m.format ?? 'md'); break;
        case 'external': {
          const source = vscode.Uri.file(await store.source(id));
          if (!await vscode.env.openExternal(source)) throw new Error('No se pudo abrir el reproductor del sistema.');
          break;
        }
        case 'reveal': await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(store.videoDir(id))); break;
        case 'logs': output.show(); break;
      }
    }, local);
    panel.onDidDispose(() => {
      editors.delete(id);
      for (const item of local) item.dispose();
      const pending = drainMessages();
      closing.set(id, pending);
      void pending.finally(() => { if (closing.get(id) === pending) closing.delete(id); });
    });
    panel.webview.html = html(panel.webview, 'editor');
  }
  async function chooseCollection(id?: string): Promise<string | undefined> {
    if (id) { await store.collection(id); return id; }
    const collections = await store.collections();
    if (!collections.length) return (await store.createCollection('General')).id;
    if (collections.length === 1) return collections[0]!.id;
    return (await vscode.window.showQuickPick(collections.map(c => ({ label: c.name, id: c.id })), { title: 'Importar en colección' }))?.id;
  }
  async function importVideos(id?: string): Promise<void> {
    const collectionId = await chooseCollection(id);
    if (!collectionId) return;
    const files = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFiles: true, canSelectFolders: false, title: 'Importar videos a la biblioteca local', filters: { Videos: VIDEO_EXTENSIONS } });
    if (!files?.length) return;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Copiando videos a tu biblioteca', cancellable: true }, async (progress, token) => {
      const errors: string[] = [];
      for (const [index, file] of files.entries()) {
        if (token.isCancellationRequested) break;
        progress.report({ message: `${index + 1}/${files.length} · ${path.basename(file.fsPath)}`, increment: 100 / files.length });
        try { await store.importVideo(collectionId, file.fsPath); } catch (error) { errors.push(`${path.basename(file.fsPath)}: ${String(error)}`); }
        scheduleRefresh();
      }
      if (errors.length) throw new Error(errors.join('\n'));
    });
    await library();
  }
  let preparing: Promise<void> | undefined;
  async function ensureEngine(): Promise<void> {
    if (preparing) return preparing;
    if (await engine.ready()) return;
    preparing = engine.setup();
    try { await preparing; } finally { preparing = undefined; await library(); }
  }
  async function transcribe(id: string): Promise<void> {
    if (queue.has(id)) return;
    if (await store.text(id)) {
      const answer = await vscode.window.showWarningMessage('Se regenerará la transcripción. El texto actual quedará guardado en transcript.previous.md.', { modal: true }, 'Regenerar');
      if (!answer) return;
    }
    await ensureEngine();
    await queue.add(id);
  }
  async function exportVideo(id: string, format: string): Promise<void> {
    const video = await store.video(id);
    let text: string;
    if (format === 'md') text = exportMarkdown(await store.text(id), await store.transcript(id));
    else {
      const transcript = await store.transcript(id);
      if (!transcript) throw new Error('Primero genera una transcripción.');
      if (format === 'srt' || format === 'vtt') text = subtitles(transcript, format);
      else if (format === 'txt') text = transcript.segments.map(s => speakerText(transcript, s)).join('\n') + '\n';
      else if (format === 'json') text = JSON.stringify(transcript, null, 2);
      else throw new Error('Formato de exportación inválido.');
    }
    if (!text) throw new Error('Todavía no hay una transcripción para exportar.');
    const name = video.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || 'transcripcion';
    const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(homedir(), `${name}.${format}`)), filters: { [format.toUpperCase()]: [format] }, title: format === 'md' ? 'Exportar texto editado' : 'Exportar reconocimiento original (sin ediciones Markdown)' });
    if (!target) return;
    const resolved = path.resolve(target.fsPath);
    const relative = path.relative(path.resolve(root), resolved);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Exporta fuera del almacenamiento interno para evitar sobrescribir tu biblioteca.');
    await vscode.workspace.fs.writeFile(target, Buffer.from(text, 'utf8'));
    void vscode.window.showInformationMessage(`Exportado: ${path.basename(target.fsPath)}`);
  }
  async function sidebarMessage(m: Message): Promise<void> {
    switch (m.type) {
      case 'ready': case 'refresh': await library(); break;
      case 'import': await importVideos(m.collectionId); break;
      case 'createCollection': if (m.name) { await store.createCollection(m.name); await library(); } break;
      case 'renameCollection': if (m.id && m.name) { await store.renameCollection(m.id, m.name); await library(); } break;
      case 'deleteCollection': if (m.id) { await store.removeEmptyCollection(m.id); await library(); } break;
      case 'open': if (m.id) await openVideo(m.id); break;
      case 'rename': if (m.id && m.name) { await store.updateVideo(m.id, { title: m.name }); await detail(m.id); await library(); } break;
      case 'move': if (m.id && m.collectionId) { await store.updateVideo(m.id, { collectionId: m.collectionId }); await library(); } break;
      case 'delete': if (m.id) {
        if (queue.has(m.id)) throw new Error('Cancela la transcripción antes de eliminar el video.');
        const video = await store.video(m.id);
        const answer = await vscode.window.showWarningMessage(`¿Enviar «${video.title}» y su transcripción a la papelera? El archivo original se conserva.`, { modal: true }, 'Eliminar');
        if (!answer) return;
        editors.get(m.id)?.panel.dispose();
        await closing.get(m.id);
        await vscode.workspace.fs.delete(vscode.Uri.file(store.videoDir(m.id)), { recursive: true, useTrash: true });
        await library();
        break;
      } break;
      case 'transcribe': if (m.id) await transcribe(m.id); break;
      case 'transcribeCollection': if (m.id) {
        const videos = (await store.videos()).filter(v => v.collectionId === m.id && !v.transcribedAt && !queue.has(v.id));
        if (!videos.length) { void vscode.window.showInformationMessage('Esta colección no tiene videos pendientes.'); return; }
        await ensureEngine();
        for (const v of videos) {
          if (!await store.text(v.id)) await queue.add(v.id);
        }
        break;
      } break;
      case 'cancel': if (m.id) queue.cancel(m.id); break;
      case 'search': {
        const version = ++searchVersion;
        const matches = await store.search((m.query ?? '').slice(0, 1000));
        if (version === searchVersion) await sidebar?.webview.postMessage({ type: 'search', query: m.query, matches });
        break;
      }
      case 'setup': await engine.setup(); await library(); break;
      case 'download': await engine.downloadModel(); break;
      case 'storage': await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(store.root)); break;
      case 'settings': await showSettings(); break;
      case 'logs': output.show(); break;
    }
  }
  context.subscriptions.push(output, engine, queue, status,
    vscode.window.registerWebviewViewProvider('devTranscription.library', {
      resolveWebviewView(view) {
        sidebar = view;
        view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')] };
        const local: vscode.Disposable[] = [];
        bind(view.webview, sidebarMessage, local);
        view.onDidDispose(() => { if (sidebar === view) sidebar = undefined; for (const item of local) item.dispose(); });
        view.webview.html = html(view.webview, 'library');
      }
    }, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('devTranscription')) {
      scheduleRefresh(); void settingsData().catch(report);
      for (const editor of editors.values()) void editor.panel.webview.postMessage({ type: 'readingOptions', options: readingOptions() });
    } }),
    { dispose() { disposed = true; if (refreshTimer) clearTimeout(refreshTimer); settingsPanel?.dispose(); for (const e of editors.values()) e.panel.dispose(); } }
  );
  const command = (name: string, action: () => Promise<unknown> | unknown) => context.subscriptions.push(vscode.commands.registerCommand(`devTranscription.${name}`, async () => { try { await action(); } catch (e) { report(e); } }));
  command('import', () => importVideos());
  command('collection', async () => {
    await vscode.commands.executeCommand('devTranscription.library.focus');
    await sidebar?.webview.postMessage({ type: 'composeCollection' });
  });
  command('refresh', library);
  command('setup', async () => { await engine.setup(); await library(); });
  command('downloadModel', () => engine.downloadModel());
  command('storage', () => vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(store.root)));
  command('settings', showSettings);
  command('logs', () => output.show());
}
