import { t, setLocale, localeTag, countedText, localizeMessage, type MessageKey } from '../i18n';
import './style.css';
import { timestamp, speakerName, type LibraryState, type Video, type Transcript, type Job } from '../domain';
import { stageLabel, jobProgressLabel } from '../progress';
import { readingBlocks, DEFAULT_DIALOGUE_OPTIONS, type DialogueOptions } from '../dialogues';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): any; setState(value: unknown): void };
const vscode = acquireVsCodeApi();
setLocale(document.documentElement.lang);
const send = (type: string, fields: Record<string, unknown> = {}) => vscode.postMessage({ type, ...fields });
const app = document.querySelector<HTMLDivElement>('#app')!;
const bindings: { node: Text | Element; attribute?: string; template: string }[] = [];
function h(key: MessageKey): string { return `__DT_I18N_${key}__`; }
function localizeMarkup(root: Element): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  const inspect = (node: Node) => {
    if (node instanceof Text && node.data.includes('__DT_I18N_')) bindings.push({ node, template: node.data });
    if (node instanceof Element) for (const attribute of [...node.attributes]) {
      if (attribute.value.includes('__DT_I18N_')) bindings.push({ node, attribute: attribute.name, template: attribute.value });
    }
  };
  inspect(root);
  while (walker.nextNode()) inspect(walker.currentNode);
  applyTranslations();
}
function applyTranslations(): void {
  for (let index = bindings.length - 1; index >= 0; index--) {
    const binding = bindings[index]!;
    if (!binding.node.isConnected) { bindings.splice(index, 1); continue; }
    const value = binding.template.replace(/__DT_I18N_(\w+)__/g, (_, key: MessageKey) => t(key));
    if (binding.attribute && binding.node instanceof Element) binding.node.setAttribute(binding.attribute, value);
    else binding.node.textContent = value;
  }
}
window.addEventListener('message', ({ data: message }) => {
  if (message.locale === undefined || message.locale === document.documentElement.lang) return;
  setLocale(message.locale);
  document.documentElement.lang = message.locale === 'es' ? 'es' : 'en';
  applyTranslations();
  window.dispatchEvent(new Event('localechange'));
});
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); e.className = className; if (text !== undefined) e.textContent = text; return e;
}
function button(label: string, action: () => void, className = 'button subtle', title = label): HTMLButtonElement {
  const b = element('button', className, label); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', action); return b;
}
function error(message: string): void { $('error').textContent = message; $('error').hidden = !message; }
function size(bytes: number): string { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
function form(key: MessageKey, initial: string, submit: (name: string) => void, values: Record<string, string> = {}): void {
  const title = t(key, values);
  const host = $('composer'); host.replaceChildren(); host.hidden = false;
  const heading = element('label', 'form-label', title); heading.htmlFor = 'name';
  const input = element('input'); input.id = 'name'; input.value = initial; input.maxLength = 160; input.required = true; input.autocomplete = 'off';
  const f = element('form'); const actions = element('div', 'actions');
  const save = element('button', 'button primary', t('save')); save.type = 'submit';
  actions.append(save, button(t('cancel'), () => { host.hidden = true; }));
  f.append(heading, input, actions);
  f.addEventListener('submit', e => { e.preventDefault(); if (input.value.trim()) { submit(input.value.trim()); host.hidden = true; } });
  host.append(f);
  const updateLabels = () => {
    if (!heading.isConnected) { window.removeEventListener('localechange', updateLabels); return; }
    heading.textContent = t(key, values); save.textContent = t('save');
    const cancel = actions.querySelectorAll('button')[1];
    if (cancel) { cancel.textContent = t('cancel'); cancel.title = t('cancel'); cancel.setAttribute('aria-label', t('cancel')); }
  };
  window.addEventListener('localechange', updateLabels);
  input.focus(); input.select();
}

if (document.body.dataset.page === 'library') libraryPage(); else if (document.body.dataset.page === 'settings') settingsPage(); else editorPage();

function libraryPage(): void {
  app.className = 'sidebar';
  app.innerHTML = `<header class="brand"><div class="brand-mark" aria-hidden="true">▷</div><div><h1>Dev Transcription</h1><p>${h('tagline')}</p></div></header>
    <div class="controls"><input id="search" type="search" placeholder="${h('searchPlaceholder')}" aria-label="${h('searchLabel')}"><button id="new" class="square primary" title="${h('createCollection')}" aria-label="${h('createCollection')}">+</button></div>
    <div class="actions top-actions"><button id="import" class="button primary">${h('importVideos')}</button><button id="settings" class="button subtle">${h('settings')}</button></div>
    <div id="composer" class="composer" hidden></div><p id="error" class="error" role="alert" hidden></p>
    <div id="summary" class="summary"></div><main id="collections" aria-label="${h('collections')}"></main>
`;
  localizeMarkup(app);
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
  const create = () => form('newCollection', '', name => send('createCollection', { name }));
  $('new').onclick = create; $('import').onclick = () => send('import');
  $('settings').onclick = () => send('settings');
  function videoRow(video: Video): HTMLElement {
    const job = state.jobs.find(j => j.id === video.id);
    const row = element('div', 'video-row');
    const open = button('', () => send('open', { id: video.id }), 'video-open', t('openVideo', { title: video.title }));
    const icon = element('span', 'video-icon', job ? '◌' : video.transcribedAt ? '≡' : '▷'); icon.setAttribute('aria-hidden', 'true');
    const copy = element('span', 'video-copy'); const name = element('span', 'video-title', video.title);
    const subtitle = (job ? localizeMessage(job.message) : undefined) ?? (video.error ? t('videoError') : video.transcribedAt ? t('transcriptSaved') : t('pending'));
    const meta = element('span', 'video-meta', `${size(video.bytes)} · ${subtitle}`);
    meta.title = meta.textContent ?? '';
    if (job) {
      meta.classList.add('job-meta');
      meta.replaceChildren(element('span', 'stage-name', job.stage ? stageLabel(job.stage) : localizeMessage(job.message)), element('span', 'stage-percent', job.percent !== undefined ? `${Math.floor(job.percent)}%` : job.state === 'queued' ? '' : t('inProgress')));
    }
    if (video.error && !job) meta.classList.add('danger');
    copy.append(name, meta); open.append(icon, copy); row.append(open);
    const menu = element('details', 'menu'); const trigger = element('summary', 'menu-trigger', '⋯'); trigger.title = t('actionsFor', { name: video.title }); trigger.setAttribute('aria-label', trigger.title);
    const options = element('div', 'menu-options');
    options.append(button(job ? t('cancelJob') : video.transcribedAt ? t('regenerate') : t('transcribe'), () => { send(job ? 'cancel' : 'transcribe', { id: video.id }); menu.open = false; }, 'menu-item'));
    options.append(button(t('rename'), () => form('videoName', video.title, name => send('rename', { id: video.id, name })), 'menu-item'));
    options.append(button(t('moveToCollectionMore'), () => moveForm(video), 'menu-item'));
    options.append(button(t('delete'), () => send('delete', { id: video.id }), 'menu-item danger'));
    menu.append(trigger, options); row.append(menu);
    if (job) { const progress = element('progress'); progress.max = 100; if (job.percent !== undefined) progress.value = job.percent; progress.setAttribute('aria-label', jobProgressLabel(job)); row.append(progress); }
    return row;
  }
  function moveForm(video: Video): void {
    const host = $('composer'); host.replaceChildren(); host.hidden = false;
    const label = element('label', 'form-label', h('moveToCollection')); label.htmlFor = 'destination';
    const select = element('select'); select.id = 'destination';
    for (const collection of state.collections) { const option = element('option', '', collection.name); option.value = collection.id; select.append(option); }
    select.value = video.collectionId;
    const actions = element('div', 'actions');
    actions.append(button(h('move'), () => { send('move', { id: video.id, collectionId: select.value }); host.hidden = true; }, 'button primary'), button(h('cancel'), () => { host.hidden = true; }));
    host.append(label, select, actions); localizeMarkup(label); localizeMarkup(actions); select.focus();
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
      info.append(element('span', 'collection-name', collection.name), element('span', 'count', t('collectionSummary', { videos: countedText('videos', videos.length), transcribed: countedText('transcribed', videos.filter(v => v.transcribedAt).length) })));
      toggle.append(element('span', 'chevron', isOpen ? '⌄' : '›'), element('span', 'folder-icon', '▱'), info);
      const menu = element('details', 'menu'); const summary = element('summary', 'menu-trigger', '⋯'); summary.title = t('actionsFor', { name: collection.name }); summary.setAttribute('aria-label', summary.title);
      const options = element('div', 'menu-options');
      options.append(button(t('importVideos'), () => send('import', { collectionId: collection.id }), 'menu-item'), button(t('transcribePending'), () => send('transcribeCollection', { id: collection.id }), 'menu-item'), button(t('rename'), () => form('collectionName', collection.name, name => send('renameCollection', { id: collection.id, name })), 'menu-item'), button(t('deleteEmptyCollection'), () => send('deleteCollection', { id: collection.id }), 'menu-item danger'));
      menu.append(summary, options); head.append(toggle, menu); card.append(head);
      if (isOpen) {
        const list = element('div', 'video-list');
        if (!filtered.length) list.append(button(t('importFirstVideo'), () => send('import', { collectionId: collection.id }), 'empty-collection'));
        for (const video of filtered) list.append(videoRow(video));
        card.append(list);
      }
      host.append(card);
    }
    $('summary').textContent = t('librarySummary', { videos: countedText('videos', query ? visible : state.videos.length), status: state.jobs.length ? t('queueCount', { count: state.jobs.length }) : t('savedLocally') });
    if (!host.childElementCount) {
      const empty = element('div', 'empty');
      empty.append(element('div', 'empty-icon', '▷'), element('h2', '', query ? t('noMatches') : t('emptyLibrary')), element('p', '', query ? t('searchHint') : t('emptyLibraryHint')));
      if (!query) empty.append(button(t('importVideos'), () => send('import'), 'button primary'));
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
  window.addEventListener('localechange', render);
  send('ready');
}

function editorPage(): void {
  app.className = 'editor';
  app.innerHTML = `<header class="editor-head"><div><span class="eyebrow">${h('localLibrary')}</span><h1 id="title">${h('loadingVideo')}</h1><p id="meta" class="muted"></p></div><div class="actions"><button id="external" class="button subtle">${h('openPlayer')}</button><button id="folder" class="button subtle">${h('folder')}</button></div></header>
    <main class="workspace"><section class="player-column"><div class="player-shell"><video id="video" controls preload="metadata" aria-label="${h('videoPlayer')}"></video></div><p id="codec" class="hint" hidden>${h('codecHint')}</p><div class="job-card"><div class="actions"><button id="transcribe" class="button primary">${h('transcribeVideo')}</button><button id="cancel" class="button subtle" hidden>${h('cancel')}</button><button id="logs" class="button subtle">${h('log')}</button></div><div id="phase-summary" class="phase-summary" hidden><strong id="phase-name"></strong><strong id="phase-percent"></strong></div><progress id="progress" max="100" hidden aria-label="${h('stageProgress')}"></progress><p id="job-status" class="muted" role="status">${h('localSpeech')}</p><ul id="stage-history" class="stage-history" hidden aria-label="${h('completedStages')}"></ul></div><p class="hint">${h('queueHint')}</p><section id="actors" class="actor-panel" aria-label="${h('speakers')}"></section><div id="composer" class="composer" hidden></div></section>
    <section class="transcript-column"><div class="transcript-toolbar"><div class="tabs" role="tablist" aria-label="${h('transcriptView')}"><button id="read-tab" role="tab" aria-selected="true">${h('reading')}</button><button id="edit-tab" role="tab" aria-selected="false">${h('edit')}</button><button id="time-tab" role="tab" aria-selected="false">${h('timing')}</button></div><span id="save-state" class="muted" role="status">${h('saved')}</span></div>
    <div id="reading-controls" class="reading-controls"><label><input id="group-dialogues" type="checkbox" checked> ${h('groupDialogues')}</label><span id="group-hint" class="muted"></span></div><p id="error" class="error" role="alert" hidden></p><div id="reading" class="reading"></div><textarea id="text" class="text-editor" aria-label="${h('editMarkdown')}" spellcheck="true" hidden placeholder="${h('transcriptPlaceholder')}"></textarea><div id="timeline" class="timeline" hidden></div>
    <footer class="export-bar"><span class="muted">${h('export')}</span><button id="export-md" class="button subtle" title="${h('includesEdits')}">${h('editedMarkdown')}</button><select id="export-format" aria-label="${h('originalFormat')}"><option value="txt">${h('originalText')}</option><option value="srt">${h('originalSrt')}</option><option value="vtt">${h('originalVtt')}</option><option value="json">${h('originalJson')}</option></select><button id="export-original" class="button subtle">${h('exportOriginal')}</button></footer></section></main>`;
  localizeMarkup(app);
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
    revision += 1; $('save-state').textContent = t('saving'); error('');
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
    $('group-hint').textContent = dialogueOptions.groupDialogues ? t('groupingSummary', { gap: dialogueOptions.dialogueGapSeconds, max: dialogueOptions.dialogueMaxSeconds }) : t('originalSegments');

    if (!text.value.trim()) {
      host.append(element('div', 'transcript-empty', t('emptyTranscript')), element('p', 'muted', t('emptyTranscriptHint')));
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
        if (block.lines.length > 1) heading.append(element('span', 'dialogue-count muted', t('segmentCount', { count: block.lines.length })));
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
    host.append(element('p', 'hint', t('timelineHint')));
    if (!transcript?.segments.length) host.append(element('p', 'muted', transcript ? t('noSpeech') : t('transcribeForSegments')));
    for (const [index, s] of (transcript?.segments ?? []).entries()) {
      const row = element('div', 'segment');
      const body = element('div', 'segment-body');
      const controls = element('div', 'segment-controls');
      const select = element('select', 'speaker-select');
      select.setAttribute('aria-label', t('segmentSpeaker', { count: index + 1 }));
      const unassigned = element('option', '', t('unassigned')); unassigned.value = ''; unassigned.disabled = true; select.append(unassigned);
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
    const heading = element('div', 'actor-heading'); heading.append(element('h2', '', t('speakers')));
    heading.append(button(t('addSpeaker'), () => form('speakerName', '', name => send('addSpeaker', { name })), 'button subtle'));
    host.append(heading);
    if (!transcript?.speakers?.length) host.append(element('p', 'hint', transcript ? t('noSpeakers') : t('speakerHint')));
    for (const actor of transcript?.speakers ?? []) {
      const row = element('div', 'actor-row');
      const copy = element('div'); copy.append(element('strong', '', actor.name), element('code', '', actor.id));
      row.append(copy, button(t('rename'), () => form('nameFor', actor.name, name => send('renameSpeaker', { speakerId: actor.id, name }), { id: actor.id }), 'button subtle'));
      host.append(row);
    }
    host.append(element('p', 'hint', t('speakerIdsHint')));
  }
  function renderJob(): void {
    const transcribe = $<HTMLButtonElement>('transcribe'); transcribe.disabled = Boolean(job);
    transcribe.textContent = job ? job.state === 'queued' ? t('queuedEllipsis') : t('transcribingEllipsis') : transcript ? t('regenerateTranscript') : t('transcribeVideo');
    $('cancel').hidden = !job; text.disabled = Boolean(job);
    for (const control of document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('#actors button, .speaker-select')) control.disabled = Boolean(job);
    const progress = $<HTMLProgressElement>('progress'); progress.hidden = !job;
    if (job?.percent !== undefined) progress.value = job.percent; else progress.removeAttribute('value');
    $('phase-summary').hidden = !job;
    $('phase-name').textContent = job ? job.stage ? stageLabel(job.stage) : job.state === 'queued' ? t('queued') : t('preparing') : '';
    $('phase-percent').textContent = job?.percent !== undefined ? `${Math.floor(job.percent)}%` : job?.state === 'queued' ? '' : t('inProgress');
    if (job) progress.setAttribute('aria-label', jobProgressLabel(job));
    const history = $('stage-history'); history.replaceChildren();
    for (const stage of job?.stages ?? []) {
      if (stage.id === job?.stage) continue;
      const row = element('li');
      row.append(element('span', '', stageLabel(stage.id)), element('span', 'stage-result', stage.percent !== undefined ? `${Math.floor(stage.percent)}%` : t('done')));
      history.append(row);
    }
    history.hidden = !history.childElementCount;

    $('job-status').textContent = (job ? localizeMessage(job.message) : undefined) ?? (video?.error ? t('lastAttemptFailed') : transcript ? t('recognitionSummary', { segments: countedText('segments', transcript.segments.length), duration: timestamp(transcript.duration), model: transcript.model, device: transcript.device.toUpperCase(), language: transcript.languages?.length ? transcript.languages.join(' / ').toUpperCase() : transcript.multilingual ? t('multilingualDetection') : transcript.language }) : t('firstDownloadHint'));
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
      $('meta').textContent = t('videoMeta', { size: size(video!.bytes), date: new Date(video!.importedAt).toLocaleDateString(localeTag()), name: video!.originalName });
      if (m.revision >= revision) { text.value = m.text; revision = savedRevision = m.revision; $('save-state').textContent = t('saved'); }
      if (currentMedia !== m.media) { currentMedia = m.media; player.src = m.media; }
      reading(); timeline(); actors(); renderJob();
    } else if (m.type === 'readingOptions') { dialogueOptions = m.options; reading(); }
    else if (m.type === 'job') { job = m.job ?? undefined; renderJob(); }
    else if (m.type === 'saved') { savedRevision = Math.max(savedRevision, m.revision); if (savedRevision === revision) $('save-state').textContent = t('saved'); }
    else if (m.type === 'error') { error(m.message); if (savedRevision !== revision) $('save-state').textContent = t('saveFailed'); }
  });
  window.addEventListener('localechange', () => {
    reading(); timeline(); actors(); renderJob();
    if (video) $('meta').textContent = t('videoMeta', { size: size(video.bytes), date: new Date(video.importedAt).toLocaleDateString(localeTag()), name: video.originalName });
    $('save-state').textContent = t(savedRevision === revision ? 'saved' : 'saving');
  });
  send('ready');
}

function settingsPage(): void {
  app.className = 'settings';
  app.innerHTML = `<span class="eyebrow">DEV TRANSCRIPTION</span><h1>${h('settings')}</h1><p class="muted">${h('settingsSubtitle')}</p><p id="error" class="error" role="alert" hidden></p><p id="setting-status" class="muted" role="status">${h('autoSaveHint')}</p><main class="settings-grid"><section class="settings-card"><h2>${h('transcription')}</h2><div id="transcription-fields"></div></section><section class="settings-card"><h2>${h('reading')}</h2><div id="reading-fields"></div></section><section class="settings-card"><h2>${h('speakers')}</h2><div id="speaker-fields"></div></section><section class="settings-card"><h2>${h('engineStorage')}</h2><div id="engine" class="engine"></div><div id="runtime-fields"></div><div class="actions"><button id="setup" class="button primary">${h('setupEngine')}</button><button id="download" class="button subtle">${h('downloadModels')}</button><button id="logs" class="button subtle">${h('engineLog')}</button></div><p class="hint">${h('downloadHint')}</p><div class="actions"><button id="storage" class="button subtle">${h('openStorage')}</button><button id="native" class="button subtle">${h('advancedSettings')}</button></div></section></main>`;
  localizeMarkup(app);
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
      error(''); $('setting-status').textContent = t('saving');
      send('setting', { key, value: type === 'checkbox' ? (input as HTMLInputElement).checked : type === 'number' ? Number(input.value) : input.value });
    });
    controls.set(key, input); row.append(copy, input); $(section).append(row);
  }
  function renderFields(): void {
    controls.clear();
    for (const id of ['transcription-fields', 'reading-fields', 'speaker-fields', 'runtime-fields']) $(id).replaceChildren();
    field('runtime-fields', 'interfaceLanguage', t('interfaceLanguage'), t('interfaceLanguageHint'), 'select', [['en', t('english')], ['es', t('spanish')]]);
    field('transcription-fields', 'model', t('model'), t('modelHint'), 'select', [['large-v3', t('qualityModel')], ['turbo', t('fastModel')], ['medium', 'Medium'], ['small', 'Small'], ['base', 'Base'], ['tiny', 'Tiny']]);
    field('transcription-fields', 'language', t('conversationLanguage'), t('conversationLanguageHint'), 'select', [['auto', t('autoConversation')], ['es', t('spanishOnly')], ['en', t('englishOnly')]]);
    field('transcription-fields', 'initialPrompt', t('vocabulary'), t('vocabularyHint'), 'textarea');
    field('reading-fields', 'groupDialogues', t('groupDialogues'), t('groupHint'), 'checkbox');
    field('reading-fields', 'dialogueGapSeconds', t('maxPause'), t('maxPauseHint'), 'number');
    field('reading-fields', 'dialogueMaxSeconds', t('maxBlock'), t('maxBlockHint'), 'number');
    field('speaker-fields', 'diarization', t('separateVoices'), t('separateVoicesHint'), 'checkbox');
    field('speaker-fields', 'numSpeakers', t('speakerCount'), t('speakerCountHint'), 'number');
    field('speaker-fields', 'speakerThreshold', t('voiceThreshold'), t('voiceThresholdHint'), 'number');
    field('runtime-fields', 'device', t('processing'), t('processingHint'), 'select', [['auto', t('autoDevice')], ['cuda', 'NVIDIA CUDA'], ['cpu', 'CPU']]);
    field('runtime-fields', 'offline', t('offline'), t('offlineHint'), 'checkbox');
    field('runtime-fields', 'pythonPath', t('pythonExecutable'), t('pythonHint'), 'text');
  }
  renderFields();
  window.addEventListener('localechange', renderFields);
  $('setup').onclick = () => send('setup'); $('download').onclick = () => send('download'); $('logs').onclick = () => send('logs'); $('storage').onclick = () => send('storage'); $('native').onclick = () => send('nativeSettings');
  window.addEventListener('message', ({ data: m }) => {
    if (m.type === 'settings') {
      for (const [key, control] of controls) {
        const value = key === 'interfaceLanguage' ? m.locale : key === 'pythonPath' ? m.pythonPath : key === 'initialPrompt' ? m.options.prompt : m.readingOptions?.[key] ?? m.options[key];
        if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = Boolean(value);
        else if (document.activeElement !== control) {
          if (control instanceof HTMLSelectElement && ![...control.options].some(o => o.value === String(value))) { const option = element('option', '', String(value)); option.value = String(value); control.append(option); }
          control.value = String(value ?? '');
        }
      }
      $('engine').textContent = t('engineSummary', { status: m.ready ? t('engineReady') : t('engineMissing'), model: m.options.model });
      $('setting-status').textContent = t('settingsSaved');
    } else if (m.type === 'error') { error(m.message); $('setting-status').textContent = t('settingFailed'); }
  });
  send('ready');
}
