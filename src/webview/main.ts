import './style.css';
import { timestamp, speakerName, type LibraryState, type Video, type Transcript, type Job } from '../domain';
import { STAGE_LABELS, jobProgressLabel } from '../progress';
import { readingBlocks, DEFAULT_DIALOGUE_OPTIONS, type DialogueOptions } from '../dialogues';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): any; setState(value: unknown): void };
const vscode = acquireVsCodeApi();
const send = (type: string, fields: Record<string, unknown> = {}) => vscode.postMessage({ type, ...fields });
const app = document.querySelector<HTMLDivElement>('#app')!;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); e.className = className; if (text !== undefined) e.textContent = text; return e;
}
function button(label: string, action: () => void, className = 'button subtle', title = label): HTMLButtonElement {
  const b = element('button', className, label); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', action); return b;
}
function error(message: string): void { $('error').textContent = message; $('error').hidden = !message; }
function size(bytes: number): string { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
function form(title: string, initial: string, submit: (name: string) => void): void {
  const host = $('composer'); host.replaceChildren(); host.hidden = false;
  const heading = element('label', 'form-label', title); heading.htmlFor = 'name';
  const input = element('input'); input.id = 'name'; input.value = initial; input.maxLength = 160; input.required = true; input.autocomplete = 'off';
  const f = element('form'); const actions = element('div', 'actions');
  const save = element('button', 'button primary', 'Guardar'); save.type = 'submit';
  actions.append(save, button('Cancelar', () => { host.hidden = true; }));
  f.append(heading, input, actions);
  f.addEventListener('submit', e => { e.preventDefault(); if (input.value.trim()) { submit(input.value.trim()); host.hidden = true; } });
  host.append(f); input.focus(); input.select();
}

if (document.body.dataset.page === 'library') libraryPage(); else if (document.body.dataset.page === 'settings') settingsPage(); else editorPage();

function libraryPage(): void {
  app.className = 'sidebar';
  app.innerHTML = `<header class="brand"><div class="brand-mark" aria-hidden="true">▷</div><div><h1>Dev Transcription</h1><p>Tus videos, en palabras.</p></div></header>
    <div class="controls"><input id="search" type="search" placeholder="Buscar videos y transcripciones…" aria-label="Buscar videos y transcripciones"><button id="new" class="square primary" title="Crear colección" aria-label="Crear colección">+</button></div>
    <div class="actions top-actions"><button id="import" class="button primary">Importar videos</button><button id="settings" class="button subtle">Configuración</button></div>
    <div id="composer" class="composer" hidden></div><p id="error" class="error" role="alert" hidden></p>
    <div id="summary" class="summary"></div><main id="collections" aria-label="Colecciones"></main>
`;
  const saved = vscode.getState() ?? {};
  const collapsed = new Set<string>(Array.isArray(saved.collapsed) ? saved.collapsed : []);
  let state: LibraryState = { collections: [], videos: [], jobs: [] };
  let query = typeof saved.query === 'string' ? saved.query : '';
  let matches = new Set<string>();
  let searchPending: ReturnType<typeof setTimeout> | undefined;
  const persist = () => vscode.setState({ collapsed: [...collapsed], query });
  const search = $<HTMLInputElement>('search'); search.value = query;
  search.addEventListener('input', () => {
    query = search.value.trim(); persist(); matches = new Set(); render();
    if (searchPending) clearTimeout(searchPending);
    searchPending = setTimeout(() => send('search', { query }), 200);
  });
  const create = () => form('Nueva colección', '', name => send('createCollection', { name }));
  $('new').onclick = create; $('import').onclick = () => send('import');
  $('settings').onclick = () => send('settings');
  function videoRow(video: Video): HTMLElement {
    const job = state.jobs.find(j => j.id === video.id);
    const row = element('div', 'video-row');
    const open = button('', () => send('open', { id: video.id }), 'video-open', `Abrir ${video.title}`);
    const icon = element('span', 'video-icon', job ? '◌' : video.transcribedAt ? '≡' : '▷'); icon.setAttribute('aria-hidden', 'true');
    const copy = element('span', 'video-copy'); const name = element('span', 'video-title', video.title);
    const subtitle = job?.message ?? (video.error ? 'Error · abre el registro para ver detalles' : video.transcribedAt ? 'Transcripción guardada' : 'Pendiente de transcribir');
    const meta = element('span', 'video-meta', `${size(video.bytes)} · ${subtitle}`);
    meta.title = meta.textContent ?? '';
    if (job) {
      meta.classList.add('job-meta');
      meta.replaceChildren(element('span', 'stage-name', job.stage ? STAGE_LABELS[job.stage] : job.message), element('span', 'stage-percent', job.percent !== undefined ? `${Math.floor(job.percent)}%` : job.state === 'queued' ? '' : 'En curso'));
    }
    if (video.error && !job) meta.classList.add('danger');
    copy.append(name, meta); open.append(icon, copy); row.append(open);
    const menu = element('details', 'menu'); const trigger = element('summary', 'menu-trigger', '⋯'); trigger.title = `Acciones de ${video.title}`; trigger.setAttribute('aria-label', trigger.title);
    const options = element('div', 'menu-options');
    options.append(button(job ? 'Cancelar trabajo' : video.transcribedAt ? 'Regenerar' : 'Transcribir', () => { send(job ? 'cancel' : 'transcribe', { id: video.id }); menu.open = false; }, 'menu-item'));
    options.append(button('Renombrar', () => form('Nombre del video', video.title, name => send('rename', { id: video.id, name })), 'menu-item'));
    options.append(button('Mover a colección…', () => moveForm(video), 'menu-item'));
    options.append(button('Eliminar', () => send('delete', { id: video.id }), 'menu-item danger'));
    menu.append(trigger, options); row.append(menu);
    if (job) { const progress = element('progress'); progress.max = 100; if (job.percent !== undefined) progress.value = job.percent; progress.setAttribute('aria-label', jobProgressLabel(job)); row.append(progress); }
    return row;
  }
  function moveForm(video: Video): void {
    const host = $('composer'); host.replaceChildren(); host.hidden = false;
    const label = element('label', 'form-label', 'Mover a colección'); label.htmlFor = 'destination';
    const select = element('select'); select.id = 'destination';
    for (const collection of state.collections) { const option = element('option', '', collection.name); option.value = collection.id; select.append(option); }
    select.value = video.collectionId;
    const actions = element('div', 'actions');
    actions.append(button('Mover', () => { send('move', { id: video.id, collectionId: select.value }); host.hidden = true; }, 'button primary'), button('Cancelar', () => { host.hidden = true; }));
    host.append(label, select, actions); select.focus();
  }
  function render(): void {
    const host = $('collections'); host.replaceChildren();
    const q = query.toLocaleLowerCase();
    let visible = 0;
    for (const [index, collection] of state.collections.entries()) {
      const videos = state.videos.filter(v => v.collectionId === collection.id);
      const filtered = videos.filter(v => !q || collection.name.toLocaleLowerCase().includes(q) || v.title.toLocaleLowerCase().includes(q) || matches.has(v.id));
      if (q && !filtered.length && !collection.name.toLocaleLowerCase().includes(q)) continue;
      visible += filtered.length;
      const card = element('section', `collection color-${index % 6}`);
      const head = element('div', 'collection-head');
      const toggle = button('', () => { if (collapsed.has(collection.id)) collapsed.delete(collection.id); else collapsed.add(collection.id); persist(); render(); }, 'collection-toggle', collection.name);
      const isOpen = Boolean(q) || !collapsed.has(collection.id);
      toggle.setAttribute('aria-expanded', String(isOpen));
      const info = element('span', 'collection-copy');
      info.append(element('span', 'collection-name', collection.name), element('span', 'count', `${videos.length} video${videos.length === 1 ? '' : 's'} · ${videos.filter(v => v.transcribedAt).length} transcritos`));
      toggle.append(element('span', 'chevron', isOpen ? '⌄' : '›'), element('span', 'folder-icon', '▱'), info);
      const menu = element('details', 'menu'); const summary = element('summary', 'menu-trigger', '⋯'); summary.title = `Acciones de ${collection.name}`; summary.setAttribute('aria-label', summary.title);
      const options = element('div', 'menu-options');
      options.append(button('Importar videos', () => send('import', { collectionId: collection.id }), 'menu-item'), button('Transcribir pendientes', () => send('transcribeCollection', { id: collection.id }), 'menu-item'), button('Renombrar', () => form('Nombre de la colección', collection.name, name => send('renameCollection', { id: collection.id, name })), 'menu-item'), button('Eliminar colección vacía', () => send('deleteCollection', { id: collection.id }), 'menu-item danger'));
      menu.append(summary, options); head.append(toggle, menu); card.append(head);
      if (isOpen) {
        const list = element('div', 'video-list');
        if (!filtered.length) list.append(button('＋ Importar primer video', () => send('import', { collectionId: collection.id }), 'empty-collection'));
        for (const video of filtered) list.append(videoRow(video));
        card.append(list);
      }
      host.append(card);
    }
    $('summary').textContent = `${query ? visible : state.videos.length} videos · ${state.jobs.length ? `${state.jobs.length} en cola` : 'Guardados en este equipo'}`;
    if (!host.childElementCount) {
      const empty = element('div', 'empty');
      empty.append(element('div', 'empty-icon', '▷'), element('h2', '', query ? 'Sin coincidencias' : 'Tu biblioteca empieza aquí'), element('p', '', query ? 'Prueba con otro título o una palabra de la transcripción.' : 'Organiza tus videos en colecciones y convierte su voz en texto, de forma local.'));
      if (!query) empty.append(button('Importar videos', () => send('import'), 'button primary'));
      host.append(empty);
    }
  }
  window.addEventListener('message', ({ data: m }) => {
    if (m.type === 'library') {
      state = m.state; error(''); render();
      if (query) send('search', { query });
    } else if (m.type === 'search' && m.query === query) { matches = new Set(m.matches); render(); }
    else if (m.type === 'composeCollection') create();
    else if (m.type === 'error') error(m.message);
  });
  send('ready');
}

function editorPage(): void {
  app.className = 'editor';
  app.innerHTML = `<header class="editor-head"><div><span class="eyebrow">BIBLIOTECA LOCAL</span><h1 id="title">Cargando video…</h1><p id="meta" class="muted"></p></div><div class="actions"><button id="external" class="button subtle">Abrir en reproductor ↗</button><button id="folder" class="button subtle">Carpeta ↗</button></div></header>
    <main class="workspace"><section class="player-column"><div class="player-shell"><video id="video" controls preload="metadata" aria-label="Reproductor del video"></video></div><p id="codec" class="hint" hidden>Este formato no se puede reproducir dentro de VS Code. Usa «Abrir en reproductor»; la transcripción sigue disponible.</p><div class="job-card"><div class="actions"><button id="transcribe" class="button primary">Transcribir video</button><button id="cancel" class="button subtle" hidden>Cancelar</button><button id="logs" class="button subtle">Registro</button></div><div id="phase-summary" class="phase-summary" hidden><strong id="phase-name"></strong><strong id="phase-percent"></strong></div><progress id="progress" max="100" hidden aria-label="Progreso de la etapa actual"></progress><p id="job-status" class="muted" role="status">La voz se procesa en tu equipo.</p><ul id="stage-history" class="stage-history" hidden aria-label="Etapas completadas"></ul></div><p class="hint">Puedes cerrar esta pestaña: el trabajo continúa mientras VS Code permanezca abierto. La cola se procesa de uno en uno.</p><section id="actors" class="actor-panel" aria-label="Hablantes"></section><div id="composer" class="composer" hidden></div></section>
    <section class="transcript-column"><div class="transcript-toolbar"><div class="tabs" role="tablist" aria-label="Vista de la transcripción"><button id="read-tab" role="tab" aria-selected="true">Lectura</button><button id="edit-tab" role="tab" aria-selected="false">Editar</button><button id="time-tab" role="tab" aria-selected="false">Tiempos</button></div><span id="save-state" class="muted" role="status">Guardado</span></div>
    <div id="reading-controls" class="reading-controls"><label><input id="group-dialogues" type="checkbox" checked> Agrupar diálogos</label><span id="group-hint" class="muted"></span></div><p id="error" class="error" role="alert" hidden></p><div id="reading" class="reading"></div><textarea id="text" class="text-editor" aria-label="Editar transcripción en Markdown" spellcheck="true" hidden placeholder="Aquí aparecerá tu transcripción. También puedes escribir tus notas."></textarea><div id="timeline" class="timeline" hidden></div>
    <footer class="export-bar"><span class="muted">Exportar</span><button id="export-md" class="button subtle" title="Incluye tus ediciones">Markdown editado</button><select id="export-format" aria-label="Formato de reconocimiento original"><option value="txt">Texto original</option><option value="srt">SRT original</option><option value="vtt">VTT original</option><option value="json">JSON original</option></select><button id="export-original" class="button subtle">Exportar original ↗</button></footer></section></main>`;
  let video: Video | undefined;
  let transcript: Transcript | undefined;
  let job: Job | undefined;
  let revision = 0;
  let savedRevision = 0;
  let mode: 'read' | 'edit' | 'time' = 'read';
  let dialogueOptions: DialogueOptions = { ...DEFAULT_DIALOGUE_OPTIONS };
  let currentMedia = '';
  const player = $<HTMLVideoElement>('video');
  const text = $<HTMLTextAreaElement>('text');
  function save(): void {
    revision += 1; $('save-state').textContent = 'Guardando…'; error('');
    send('save', { text: text.value, revision });
  }
  function setMode(next: typeof mode): void {
    mode = next;
    $('reading').hidden = next !== 'read'; text.hidden = next !== 'edit'; $('timeline').hidden = next !== 'time';
    for (const [id, value] of [['read-tab', 'read'], ['edit-tab', 'edit'], ['time-tab', 'time']]) $(id!).setAttribute('aria-selected', String(value === next));
    $('reading-controls').hidden = next !== 'read';
    if (next === 'read') reading();
    if (next === 'edit') text.focus();
  }
  function seek(seconds: number): void { player.currentTime = seconds; void player.play().catch(() => { $('codec').hidden = false; }); }
  function reading(): void {
    const host = $('reading'); host.replaceChildren();
    const checkbox = $<HTMLInputElement>('group-dialogues'); checkbox.checked = dialogueOptions.groupDialogues;
    $('group-hint').textContent = dialogueOptions.groupDialogues ? `Por voz · pausas ≤ ${dialogueOptions.dialogueGapSeconds} s · bloques ≤ ${dialogueOptions.dialogueMaxSeconds} s` : 'Fragmentos originales';

    if (!text.value.trim()) {
      host.append(element('div', 'transcript-empty', 'Todo empieza con una voz.'), element('p', 'muted', 'Pulsa «Transcribir video» para generar texto con marcas de tiempo, o abre «Editar» para tomar notas.'));
      return;
    }
    for (const block of readingBlocks(text.value, transcript, dialogueOptions)) {
      if (block.kind === 'heading') { host.append(element(block.level === 1 ? 'h2' : 'h3', '', block.text)); continue; }
      if (block.kind === 'text') { host.append(element('p', '', block.text)); continue; }
      if (dialogueOptions.groupDialogues) {
        const dialogue = element('section', 'dialogue');
        const heading = element('div', 'dialogue-heading');
        const range = `${timestamp(block.start)}${block.end > block.start ? ` – ${timestamp(block.end)}` : ''}`;
        heading.append(button(range, () => seek(block.start), 'time-link'));
        if (block.speakerId && transcript) heading.append(element('span', 'speaker-badge', `${speakerName(transcript, block.speakerId)} · ${block.speakerId}`));
        if (block.lines.length > 1) heading.append(element('span', 'dialogue-count muted', `${block.lines.length} fragmentos`));
        dialogue.append(heading, element('p', '', block.lines.map(line => line.text).join(' ')));
        host.append(dialogue);
      } else {
        const p = element('p');
        p.append(button(timestamp(block.start), () => seek(block.start), 'time-link'));
        if (block.speakerId && transcript) p.append(element('span', 'speaker-badge', `${speakerName(transcript, block.speakerId)} · ${block.speakerId}`));
        p.append(document.createTextNode(block.lines[0]?.text ?? '')); host.append(p);
      }
    }
  }

  function timeline(): void {
    const host = $('timeline'); const scroll = host.scrollTop; host.replaceChildren();
    host.append(element('p', 'hint', 'Reconocimiento original con tiempos. Las ediciones de Markdown se conservan en Lectura y Editar.'));
    if (!transcript?.segments.length) host.append(element('p', 'muted', transcript ? 'No se detectó voz en este video.' : 'Transcribe el video para ver sus segmentos.'));
    for (const [index, s] of (transcript?.segments ?? []).entries()) {
      const row = element('div', 'segment');
      const body = element('div', 'segment-body');
      const controls = element('div', 'segment-controls');
      const select = element('select', 'speaker-select');
      select.setAttribute('aria-label', `Hablante del fragmento ${index + 1}`);
      const unassigned = element('option', '', 'Sin asignar'); unassigned.value = ''; unassigned.disabled = true; select.append(unassigned);
      for (const actor of transcript?.speakers ?? []) { const option = element('option', '', `${actor.name} · ${actor.id}`); option.value = actor.id; select.append(option); }
      select.value = s.speakerId ?? ''; select.disabled = Boolean(job);
      const segmentId = s.id ?? `segment-${String(index + 1).padStart(6, '0')}`;
      select.addEventListener('change', () => send('assignSpeaker', { segmentId, speakerId: select.value }));
      controls.append(select, element('span', 'segment-id muted', `${segmentId}${s.language ? ` · ${s.language.toUpperCase()}` : ''}`));
      body.append(controls, element('p', '', s.text));
      row.append(button(timestamp(s.start), () => seek(s.start), 'time-link'), body);
      host.append(row);
    }
    host.scrollTop = scroll;
  }
  function actors(): void {
    const host = $('actors'); host.replaceChildren();
    const heading = element('div', 'actor-heading'); heading.append(element('h2', '', 'Hablantes'));
    heading.append(button('＋ Agregar', () => form('Nombre del hablante', '', name => send('addSpeaker', { name })), 'button subtle'));
    host.append(heading);
    if (!transcript?.speakers?.length) host.append(element('p', 'hint', transcript ? 'Esta transcripción aún no tiene hablantes. Puedes agregar uno y asignarlo en Tiempos, o regenerar para detectar voces.' : 'Al transcribir se asigna un ID a cada voz. Después puedes ponerle nombre.'));
    for (const actor of transcript?.speakers ?? []) {
      const row = element('div', 'actor-row');
      const copy = element('div'); copy.append(element('strong', '', actor.name), element('code', '', actor.id));
      row.append(copy, button('Renombrar', () => form(`Nombre de ${actor.id}`, actor.name, name => send('renameSpeaker', { speakerId: actor.id, name })), 'button subtle'));
      host.append(row);
    }
    host.append(element('p', 'hint', 'Los IDs pertenecen a este video. Si una voz quedó mal asignada, puedes corregirla en Tiempos.'));
  }
  function renderJob(): void {
    const transcribe = $<HTMLButtonElement>('transcribe'); transcribe.disabled = Boolean(job);
    transcribe.textContent = job ? job.state === 'queued' ? 'En cola…' : 'Transcribiendo…' : transcript ? 'Regenerar transcripción' : 'Transcribir video';
    $('cancel').hidden = !job; text.disabled = Boolean(job);
    for (const control of document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('#actors button, .speaker-select')) control.disabled = Boolean(job);
    const progress = $<HTMLProgressElement>('progress'); progress.hidden = !job;
    if (job?.percent !== undefined) progress.value = job.percent; else progress.removeAttribute('value');
    $('phase-summary').hidden = !job;
    $('phase-name').textContent = job ? job.stage ? STAGE_LABELS[job.stage] : job.state === 'queued' ? 'En cola' : 'Preparando' : '';
    $('phase-percent').textContent = job?.percent !== undefined ? `${Math.floor(job.percent)}%` : job?.state === 'queued' ? '' : 'En curso';
    if (job) progress.setAttribute('aria-label', jobProgressLabel(job));
    const history = $('stage-history'); history.replaceChildren();
    for (const stage of job?.stages ?? []) {
      if (stage.id === job?.stage) continue;
      const row = element('li');
      row.append(element('span', '', STAGE_LABELS[stage.id]), element('span', 'stage-result', stage.percent !== undefined ? `${Math.floor(stage.percent)}%` : '✓ Listo'));
      history.append(row);
    }
    history.hidden = !history.childElementCount;

    $('job-status').textContent = job?.message ?? (video?.error ? 'El último intento falló. Revisa el registro; puedes reintentar.' : transcript ? `${transcript.segments.length} segmentos · ${timestamp(transcript.duration)} · ${transcript.model} · ${transcript.device.toUpperCase()} · ${transcript.languages?.length ? transcript.languages.join(' / ').toUpperCase() : transcript.multilingual ? 'Detección multilingüe' : transcript.language}` : 'La voz se procesa en tu equipo. La primera vez se descarga el modelo.');
  }
  text.addEventListener('input', save);
  $('group-dialogues').addEventListener('change', () => { dialogueOptions.groupDialogues = $<HTMLInputElement>('group-dialogues').checked; reading(); send('groupDialogues', { value: dialogueOptions.groupDialogues }); });
  $('read-tab').onclick = () => setMode('read'); $('edit-tab').onclick = () => setMode('edit'); $('time-tab').onclick = () => setMode('time');
  $('transcribe').onclick = () => { if (revision !== savedRevision) save(); send('transcribe'); };
  $('cancel').onclick = () => send('cancel'); $('external').onclick = () => send('external'); $('folder').onclick = () => send('reveal'); $('logs').onclick = () => send('logs');
  $('export-md').onclick = () => send('export', { format: 'md' });
  $('export-original').onclick = () => send('export', { format: $<HTMLSelectElement>('export-format').value });
  player.addEventListener('error', () => { $('codec').hidden = false; });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!job) save(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); setMode(mode === 'edit' ? 'read' : 'edit'); }
  });
  window.addEventListener('message', ({ data: m }) => {
    if (m.type === 'detail') {
      video = m.video; transcript = m.transcript; job = m.job ?? undefined;
      if (m.readingOptions) dialogueOptions = m.readingOptions;
      $('title').textContent = video!.title;
      $('meta').textContent = `${size(video!.bytes)} · Importado ${new Date(video!.importedAt).toLocaleDateString()} · ${video!.originalName}`;
      if (m.revision >= revision) { text.value = m.text; revision = savedRevision = m.revision; $('save-state').textContent = 'Guardado'; }
      if (currentMedia !== m.media) { currentMedia = m.media; player.src = m.media; }
      reading(); timeline(); actors(); renderJob();
    } else if (m.type === 'readingOptions') { dialogueOptions = m.options; reading(); }
    else if (m.type === 'job') { job = m.job ?? undefined; renderJob(); }
    else if (m.type === 'saved') { savedRevision = Math.max(savedRevision, m.revision); if (savedRevision === revision) $('save-state').textContent = 'Guardado'; }
    else if (m.type === 'error') { error(m.message); if (savedRevision !== revision) $('save-state').textContent = 'No se pudo guardar'; }
  });
  send('ready');
}

function settingsPage(): void {
  app.className = 'settings';
  app.innerHTML = `<span class="eyebrow">DEV TRANSCRIPTION</span><h1>Configuración</h1><p class="muted">Motor local, idiomas, hablantes y almacenamiento.</p><p id="error" class="error" role="alert" hidden></p><p id="setting-status" class="muted" role="status">Los cambios se guardan automáticamente.</p><main class="settings-grid"><section class="settings-card"><h2>Transcripción</h2><div id="transcription-fields"></div></section><section class="settings-card"><h2>Lectura</h2><div id="reading-fields"></div></section><section class="settings-card"><h2>Hablantes</h2><div id="speaker-fields"></div></section><section class="settings-card"><h2>Motor y almacenamiento</h2><div id="engine" class="engine"></div><div id="runtime-fields"></div><div class="actions"><button id="setup" class="button primary">Preparar o reparar motor</button><button id="download" class="button subtle">Descargar modelos</button><button id="logs" class="button subtle">Registro del motor</button></div><p class="hint">La descarga prepara el modelo de transcripción y los de separación de voces para usarlos sin conexión.</p><div class="actions"><button id="storage" class="button subtle">Abrir carpeta de la biblioteca ↗</button><button id="native" class="button subtle">Ajustes avanzados de VS Code ↗</button></div></section></main>`;
  const controls = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
  function field(section: string, key: string, label: string, hint: string, type: 'text' | 'number' | 'checkbox' | 'textarea' | 'select', choices: [string, string][] = []): void {
    const row = element('div', 'setting-field');
    const copy = element('div'); const name = element('label', '', label); name.htmlFor = `setting-${key}`; copy.append(name, element('small', '', hint));
    let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (type === 'select') {
      const select = element('select');
      for (const [value, label] of choices) { const option = element('option', '', label); option.value = value; select.append(option); }
      input = select;
    } else if (type === 'textarea') { const area = element('textarea'); area.rows = 3; area.maxLength = 4000; input = area; }
    else { const i = element('input'); i.type = type; if (key === 'numSpeakers') { i.min = '0'; i.max = '30'; i.step = '1'; } if (key === 'dialogueGapSeconds') { i.min = '0'; i.max = '30'; i.step = '0.5'; } if (key === 'dialogueMaxSeconds') { i.min = '5'; i.max = '300'; i.step = '5'; } if (key === 'speakerThreshold') { i.min = '0.1'; i.max = '0.95'; i.step = '0.05'; } input = i; }
    input.id = `setting-${key}`;
    input.addEventListener('change', () => {
      if (!input.checkValidity()) { input.reportValidity(); return; }
      error(''); $('setting-status').textContent = 'Guardando…';
      send('setting', { key, value: type === 'checkbox' ? (input as HTMLInputElement).checked : type === 'number' ? Number(input.value) : input.value });
    });
    controls.set(key, input); row.append(copy, input); $(section).append(row);
  }
  field('transcription-fields', 'model', 'Modelo', 'large-v3 prioriza calidad. Los modelos pequeños usan menos tiempo y memoria.', 'select', [['large-v3', 'Whisper large-v3 · Calidad'], ['turbo', 'Whisper turbo · Rapidez'], ['medium', 'Medium'], ['small', 'Small'], ['base', 'Base'], ['tiny', 'Tiny']]);
  field('transcription-fields', 'language', 'Idioma de la conversación', 'Automático elige únicamente entre español e inglés para cada fragmento. Un idioma fijo desactiva esa detección.', 'select', [['auto', 'Automático · Español / inglés'], ['es', 'Solo español'], ['en', 'Solo inglés']]);
  field('transcription-fields', 'initialPrompt', 'Vocabulario', 'Nombres propios o términos que ayuden al reconocimiento.', 'textarea');
  field('reading-fields', 'groupDialogues', 'Agrupar diálogos', 'Une fragmentos consecutivos del mismo hablante en la vista de lectura. Tiempos conserva cada intervención.', 'checkbox');
  field('reading-fields', 'dialogueGapSeconds', 'Pausa máxima (segundos)', 'Una pausa mayor inicia otro bloque. Sin hablantes asignados, se agrupa solo por tiempo.', 'number');
  field('reading-fields', 'dialogueMaxSeconds', 'Duración máxima del bloque', 'Se inicia otro bloque cuando al unir el siguiente fragmento se supera esta duración.', 'number');
  field('speaker-fields', 'diarization', 'Separar voces', 'Asigna IDs dentro de cada video. Después puedes renombrar hablantes y corregir intervenciones.', 'checkbox');
  field('speaker-fields', 'numSpeakers', 'Número de hablantes', '0 = detección automática. Indica una cantidad si la estimación une o divide voces.', 'number');
  field('speaker-fields', 'speakerThreshold', 'Umbral de voces', 'Solo con detección automática. Un valor menor tiende a separar más hablantes.', 'number');
  field('runtime-fields', 'device', 'Procesamiento', 'Automático intenta NVIDIA y vuelve a CPU si CUDA falla.', 'select', [['auto', 'Automático · GPU / CPU'], ['cuda', 'NVIDIA CUDA'], ['cpu', 'CPU']]);
  field('runtime-fields', 'offline', 'Modo sin conexión', 'Solo modelos ya descargados. Prepara todos los modelos antes de activarlo.', 'checkbox');
  field('runtime-fields', 'pythonPath', 'Ejecutable Python', 'Opcional: se usa al crear el entorno privado. Se recomienda Python 3.12.', 'text');
  $('setup').onclick = () => send('setup'); $('download').onclick = () => send('download'); $('logs').onclick = () => send('logs'); $('storage').onclick = () => send('storage'); $('native').onclick = () => send('nativeSettings');
  window.addEventListener('message', ({ data: m }) => {
    if (m.type === 'settings') {
      for (const [key, control] of controls) {
        const value = key === 'pythonPath' ? m.pythonPath : key === 'initialPrompt' ? m.options.prompt : m.readingOptions?.[key] ?? m.options[key];
        if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = Boolean(value);
        else if (document.activeElement !== control) {
          if (control instanceof HTMLSelectElement && ![...control.options].some(o => o.value === String(value))) { const option = element('option', '', String(value)); option.value = String(value); control.append(option); }
          control.value = String(value ?? '');
        }
      }
      $('engine').textContent = `${m.ready ? '● Motor preparado' : '○ Motor pendiente de preparar'} · ${m.options.model} · Procesamiento local`;
      $('setting-status').textContent = 'Configuración guardada';
    } else if (m.type === 'error') { error(m.message); $('setting-status').textContent = 'No se pudo completar el cambio'; }
  });
  send('ready');
}
