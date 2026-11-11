// Renderer: everything you see. PDF.js does the drawing; this file wires up the UI.
import * as pdfjsLib from '../../node_modules/pdfjs-dist/build/pdf.mjs';

globalThis.pdfjsLib = pdfjsLib; // pdf_viewer.mjs looks for this global
const { PDFViewer, EventBus, PDFLinkService, PDFFindController } = await import(
  '../../node_modules/pdfjs-dist/web/pdf_viewer.mjs'
);

const PDFJS_ROOT = new URL('../../node_modules/pdfjs-dist/', import.meta.url);
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('build/pdf.worker.mjs', PDFJS_ROOT).href;

const DOC_OPTIONS = {
  cMapUrl: new URL('cmaps/', PDFJS_ROOT).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('standard_fonts/', PDFJS_ROOT).href,
  isEvalSupported: false,
};

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const THUMB_WIDTH = 116;
const THEMES = ['system', 'light', 'dark'];
const THEME_LABELS = { system: 'System', light: 'Light', dark: 'Dark' };

const $ = (id) => document.getElementById(id);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

const el = {
  tabstrip: $('tabstrip'),
  container: $('viewerContainer'),
  viewer: $('viewer'),
  empty: $('empty'),
  sidebar: $('sidebar'),
  thumbs: $('panel-thumbs'),
  outline: $('panel-outline'),
  pageInput: $('page-input'),
  pageCount: $('page-count'),
  prev: $('btn-prev'),
  next: $('btn-next'),
  zoomSelect: $('zoom-select'),
  findbar: $('findbar'),
  findInput: $('find-input'),
  findCount: $('find-count'),
  dropOverlay: $('drop-overlay'),
  toast: $('toast'),
};

// ---------- Preferences ----------
const prefs = Object.assign(
  { sidebar: true, panel: 'thumbs', nightPages: false, theme: 'system' },
  safeParse(localStorage.getItem('folio.prefs')),
);
function safeParse(text) {
  try { return JSON.parse(text) ?? {}; } catch { return {}; }
}
function savePrefs() {
  try { localStorage.setItem('folio.prefs', JSON.stringify(prefs)); } catch { /* storage full or blocked */ }
}

// ---------- Viewer ----------
const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus, externalLinkTarget: 2 /* open in browser */ });
const findController = new PDFFindController({ eventBus, linkService });
const pdfViewer = new PDFViewer({
  container: el.container,
  viewer: el.viewer,
  eventBus,
  linkService,
  findController,
  removePageBorders: true,
});
linkService.setViewer(pdfViewer);

// Each tab keeps its original bytes. The editing features planned for later
// (annotations, page tools) will write their changes on top of tab.bytes.
const state = { tabs: [], active: null, nextId: 1 };

eventBus.on('pagesinit', () => {
  const tab = state.active;
  if (!tab || pdfViewer.pdfDocument !== tab.doc) return;
  const view = tab.view;
  if (view) {
    pdfViewer.pagesRotation = view.rotation;
    pdfViewer.spreadMode = view.spread;
    pdfViewer.currentScaleValue = view.scale;
    pdfViewer.currentPageNumber = view.page;
  } else {
    pdfViewer.currentScaleValue = 'auto';
  }
  updatePageControls(pdfViewer.currentPageNumber);
});

eventBus.on('pagechanging', ({ pageNumber }) => {
  updatePageControls(pageNumber);
  markCurrentThumb(pageNumber);
});

eventBus.on('scalechanging', ({ scale, presetValue }) => updateZoomSelect(scale, presetValue));

eventBus.on('rotationchanging', () => {
  if (state.active?.doc) buildThumbnails(state.active);
});

eventBus.on('spreadmodechanged', ({ mode }) => {
  $('btn-spread').setAttribute('aria-pressed', String(mode !== 0));
});

eventBus.on('updatefindmatchescount', ({ matchesCount }) => renderFindCount(matchesCount));
eventBus.on('updatefindcontrolstate', ({ state: findState, matchesCount }) => {
  el.findInput.classList.toggle('not-found', findState === 1 && el.findInput.value !== '');
  renderFindCount(matchesCount);
});

function updatePageControls(pageNumber) {
  const total = pdfViewer.pagesCount || 0;
  if (document.activeElement !== el.pageInput) el.pageInput.value = total ? pageNumber : '';
  el.pageCount.textContent = `of ${total}`;
  el.prev.disabled = pageNumber <= 1;
  el.next.disabled = pageNumber >= total;
}

function updateZoomSelect(scale, preset) {
  const options = [...el.zoomSelect.options];
  const custom = options.find((o) => o.dataset.custom !== undefined);
  let match = preset ? options.find((o) => o.value === preset && o !== custom) : null;
  if (!match) {
    const pct = Math.round(scale * 100);
    match = options.find((o) => o !== custom && !Number.isNaN(Number(o.value)) && Math.round(Number(o.value) * 100) === pct);
    if (!match) {
      custom.textContent = `${pct}%`;
      custom.hidden = false;
      el.zoomSelect.value = 'custom';
      return;
    }
  }
  custom.hidden = true;
  el.zoomSelect.value = match.value;
}

function hasDoc() {
  return Boolean(state.active?.doc && pdfViewer.pdfDocument === state.active.doc);
}

function goToPage(n) {
  if (!hasDoc()) return;
  pdfViewer.currentPageNumber = clamp(n, 1, pdfViewer.pagesCount);
}

function setScale(scale) {
  if (!hasDoc()) return;
  pdfViewer.currentScale = clamp(scale, MIN_SCALE, MAX_SCALE);
}

function zoomStep(direction) {
  if (!hasDoc()) return;
  const current = pdfViewer.currentScale;
  const next = direction > 0
    ? ZOOM_STEPS.find((s) => s > current + 0.001) ?? MAX_SCALE
    : [...ZOOM_STEPS].reverse().find((s) => s < current - 0.001) ?? MIN_SCALE;
  setScale(next);
}

function setScaleValue(value) {
  if (!hasDoc()) return;
  pdfViewer.currentScaleValue = value;
}

// Fit modes depend on the window size, so re-apply them when space changes.
function refitIfNeeded() {
  if (!hasDoc()) return;
  const value = pdfViewer.currentScaleValue;
  if (['auto', 'page-fit', 'page-width'].includes(value)) pdfViewer.currentScaleValue = value;
}

// ---------- Tabs ----------
function renderTabs() {
  el.tabstrip.replaceChildren(...state.tabs.map((tab) => {
    const tabEl = document.createElement('div');
    tabEl.className = 'tab' + (tab.doc ? '' : ' loading');
    tabEl.setAttribute('role', 'tab');
    tabEl.setAttribute('aria-selected', String(tab === state.active));
    tabEl.title = tab.path ?? tab.name;

    const label = document.createElement('button');
    label.className = 'tab-label';
    label.textContent = tab.name;
    label.addEventListener('click', () => activateTab(tab));

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.setAttribute('aria-label', `Close ${tab.name}`);
    close.title = 'Close (Ctrl+W)';
    close.append(icon('i-close'));
    close.addEventListener('click', () => closeTab(tab));

    tabEl.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(tab); });
    tabEl.append(label, close);
    return tabEl;
  }));
  document.body.classList.toggle('no-doc', !state.active);
  el.tabstrip.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function toUint8(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data?.buffer instanceof ArrayBuffer) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data);
}

async function openFiles(files) {
  let target = null;
  for (const file of files) {
    if (file.error) {
      showToast(`Couldn't open ${file.name}: ${file.error}`);
      continue;
    }
    const existing = file.path ? state.tabs.find((t) => t.path === file.path) : null;
    if (existing) {
      target = existing;
      continue;
    }
    const tab = {
      id: state.nextId++,
      name: file.name,
      path: file.path ?? null,
      bytes: toUint8(file.data),
      doc: null,
      task: null,
      view: null,
    };
    state.tabs.push(tab);
    target = tab;
  }
  renderTabs();
  if (target) await activateTab(target);
}

async function activateTab(tab) {
  if (state.active === tab && (hasDoc() || tab.loadPromise)) return;
  saveView();
  closeFind();
  state.active = tab;
  renderTabs();
  el.empty.hidden = true;
  document.title = `${tab.name} – Folio`;

  if (!tab.doc) {
    showDocument(null);
    try {
      tab.loadPromise ??= loadDocument(tab);
      tab.doc = await tab.loadPromise;
    } catch (err) {
      if (!state.tabs.includes(tab)) return; // closed while loading
      const cancelled = tab.passwordCancelled;
      closeTab(tab);
      if (!cancelled) showToast(`Couldn't open ${tab.name}. ${friendlyError(err)}`);
      return;
    }
    if (state.active !== tab) return; // switched away while loading
    renderTabs();
  }

  showDocument(tab.doc);
  buildThumbnails(tab);
  buildOutline(tab);
  el.container.focus({ preventScroll: true });
}

function showDocument(doc) {
  pdfViewer.setDocument(doc);
  linkService.setDocument(doc, null);
  if (!doc) {
    el.thumbs.replaceChildren();
    el.outline.replaceChildren();
  }
  updatePageControls(1);
}

function loadDocument(tab) {
  // PDF.js takes ownership of the buffer it's given, so hand it a copy.
  const task = pdfjsLib.getDocument({ ...DOC_OPTIONS, data: tab.bytes.slice() });
  tab.task = task;
  task.onPassword = (updatePassword, reason) => {
    const wrong = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
    askPassword(tab.name, wrong).then((password) => {
      if (password === null) {
        tab.passwordCancelled = true;
        task.destroy();
      } else {
        updatePassword(password);
      }
    });
  };
  return task.promise;
}

function friendlyError(err) {
  if (err?.name === 'InvalidPDFException') return 'The file is damaged or is not a PDF.';
  if (err?.name === 'MissingPDFException') return 'The file could not be found.';
  return err?.message ?? 'Something went wrong while reading it.';
}

function saveView() {
  const tab = state.active;
  if (!tab?.doc || pdfViewer.pdfDocument !== tab.doc) return;
  tab.view = {
    page: pdfViewer.currentPageNumber,
    scale: pdfViewer.currentScaleValue,
    rotation: pdfViewer.pagesRotation,
    spread: pdfViewer.spreadMode,
  };
}

function closeTab(tab) {
  const index = state.tabs.indexOf(tab);
  if (index < 0) return;
  state.tabs.splice(index, 1);

  if (state.active === tab) {
    state.active = null;
    closeFind();
    showDocument(null);
    const next = state.tabs[index] ?? state.tabs[index - 1];
    if (next) activateTab(next);
    else showEmpty();
  }
  renderTabs();
  tab.task?.destroy(); // frees the document and its worker memory
}

function cycleTab(direction) {
  if (state.tabs.length < 2 || !state.active) return;
  const index = state.tabs.indexOf(state.active);
  activateTab(state.tabs[(index + direction + state.tabs.length) % state.tabs.length]);
}

function showEmpty() {
  el.empty.hidden = false;
  document.title = 'Folio';
  renderTabs();
}

// ---------- Thumbnails ----------
let thumbJob = 0;
let thumbObserver = null;
let thumbQueue = Promise.resolve();

async function buildThumbnails(tab) {
  const job = ++thumbJob;
  thumbObserver?.disconnect();
  el.thumbs.replaceChildren();
  const doc = tab.doc;

  let ratio = '210 / 297';
  try {
    const first = await doc.getPage(1);
    const vp = first.getViewport({ scale: 1, rotation: (first.rotate + pdfViewer.pagesRotation) % 360 });
    ratio = `${vp.width} / ${vp.height}`;
  } catch { /* fall back to A4 proportions */ }
  if (job !== thumbJob) return;

  const fragment = document.createDocumentFragment();
  for (let n = 1; n <= doc.numPages; n++) {
    const button = document.createElement('button');
    button.className = 'thumb';
    button.dataset.page = String(n);
    button.setAttribute('aria-label', `Page ${n}`);
    const frame = document.createElement('span');
    frame.className = 'thumb-frame';
    frame.style.aspectRatio = ratio;
    const label = document.createElement('span');
    label.className = 'thumb-label';
    label.textContent = String(n);
    button.append(frame, label);
    fragment.append(button);
  }
  el.thumbs.append(fragment);

  thumbObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      thumbObserver.unobserve(entry.target);
      queueThumb(doc, entry.target, job);
    }
  }, { root: el.thumbs, rootMargin: '400px 0px' });
  el.thumbs.querySelectorAll('.thumb').forEach((b) => thumbObserver.observe(b));
  markCurrentThumb(pdfViewer.currentPageNumber);
}

// Render thumbnails one at a time so a 500-page file doesn't stall the app.
function queueThumb(doc, button, job) {
  thumbQueue = thumbQueue
    .then(() => (job === thumbJob ? renderThumb(doc, button) : null))
    .catch(() => {});
}

async function renderThumb(doc, button) {
  const page = await doc.getPage(Number(button.dataset.page));
  const rotation = (page.rotate + pdfViewer.pagesRotation) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  const dpr = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: (THUMB_WIDTH * dpr) / base.width, rotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  const frame = button.querySelector('.thumb-frame');
  frame.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
  frame.replaceChildren(canvas);
}

function markCurrentThumb(n) {
  const previous = el.thumbs.querySelector('.thumb.current');
  previous?.classList.remove('current');
  previous?.removeAttribute('aria-current');
  const current = el.thumbs.querySelector(`.thumb[data-page="${n}"]`);
  if (!current) return;
  current.classList.add('current');
  current.setAttribute('aria-current', 'page');
  if (!el.sidebar.hidden && !el.thumbs.hidden) current.scrollIntoView({ block: 'nearest' });
}

el.thumbs.addEventListener('click', (e) => {
  const button = e.target.closest('.thumb');
  if (button) goToPage(Number(button.dataset.page));
});

// ---------- Contents (outline) ----------
async function buildOutline(tab) {
  el.outline.replaceChildren();
  const outline = await tab.doc.getOutline().catch(() => null);
  if (state.active !== tab) return;
  if (!outline?.length) {
    const p = document.createElement('p');
    p.className = 'panel-empty';
    p.textContent = 'This document has no contents list.';
    el.outline.append(p);
    return;
  }
  el.outline.append(renderOutlineList(outline));
}

function renderOutlineList(items) {
  const list = document.createElement('ul');
  list.className = 'outline-list';
  for (const item of items) {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'outline-row';

    if (item.items?.length) {
      const toggle = document.createElement('button');
      toggle.className = 'outline-toggle';
      toggle.setAttribute('aria-label', 'Show or hide sub-sections');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.append(icon('i-right'));
      toggle.addEventListener('click', () => {
        const open = li.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(open));
      });
      row.append(toggle);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'outline-spacer';
      row.append(spacer);
    }

    const link = document.createElement('button');
    link.className = 'outline-link';
    link.textContent = item.title || 'Untitled section';
    if (item.bold) link.style.fontWeight = '600';
    if (item.italic) link.style.fontStyle = 'italic';
    link.addEventListener('click', () => {
      if (item.dest) linkService.goToDestination(item.dest);
      else if (item.url) window.open(item.url, '_blank');
    });
    row.append(link);
    li.append(row);
    if (item.items?.length) li.append(renderOutlineList(item.items));
    list.append(li);
  }
  return list;
}

// ---------- Find ----------
function openFind() {
  if (!hasDoc()) return;
  el.findbar.hidden = false;
  el.findInput.focus();
  el.findInput.select();
  if (el.findInput.value) runFind('');
}

function closeFind() {
  if (el.findbar.hidden) return;
  el.findbar.hidden = true;
  eventBus.dispatch('findbarclose', { source: window });
  el.container.focus({ preventScroll: true });
}

function runFind(type, findPrevious = false) {
  eventBus.dispatch('find', {
    source: window,
    type,
    query: el.findInput.value,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious,
    matchDiacritics: false,
  });
}

function renderFindCount(matchesCount) {
  const { current = 0, total = 0 } = matchesCount ?? {};
  if (!el.findInput.value) el.findCount.textContent = '';
  else if (total > 0) el.findCount.textContent = `${current} of ${total}`;
  else el.findCount.textContent = 'No matches';
}

el.findInput.addEventListener('input', () => {
  if (!el.findInput.value) {
    el.findInput.classList.remove('not-found');
    el.findCount.textContent = '';
  }
  runFind('');
});
el.findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runFind('again', e.shiftKey);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeFind();
  }
});
$('find-next').addEventListener('click', () => runFind('again', false));
$('find-prev').addEventListener('click', () => runFind('again', true));
$('find-close').addEventListener('click', closeFind);

// ---------- Password prompt ----------
function askPassword(name, wrong) {
  return new Promise((resolve) => {
    const dialog = $('password-dialog');
    const input = $('pw-input');
    const ok = $('pw-ok');
    const cancel = $('pw-cancel');
    const hint = $('pw-hint');
    $('pw-title').textContent = `${name} is password protected`;
    hint.textContent = wrong ? 'That password is incorrect. Try again.' : 'Enter the password to open it.';
    hint.classList.toggle('error', wrong);
    input.value = '';

    const finish = (value) => {
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
      input.removeEventListener('keydown', onKey);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onOk = () => finish(input.value);
    const onCancel = (e) => { e?.preventDefault(); finish(null); };
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); onOk(); } };

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);
    input.addEventListener('keydown', onKey);
    dialog.showModal();
    input.focus();
  });
}

// ---------- Toolbar ----------
async function openDialog() {
  const files = await window.folio.openDialog();
  if (files?.length) openFiles(files);
}

function setSidebar(open) {
  prefs.sidebar = open;
  savePrefs();
  el.sidebar.hidden = !open;
  $('btn-sidebar').setAttribute('aria-pressed', String(open));
  refitIfNeeded();
  if (open) markCurrentThumb(pdfViewer.currentPageNumber);
}

function setPanel(name) {
  prefs.panel = name;
  savePrefs();
  document.querySelectorAll('.sidebar-tab').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.panel === name));
  });
  el.thumbs.hidden = name !== 'thumbs';
  el.outline.hidden = name !== 'outline';
  if (name === 'thumbs') markCurrentThumb(pdfViewer.currentPageNumber);
}

function setNightPages(on) {
  prefs.nightPages = on;
  savePrefs();
  document.body.classList.toggle('night-pages', on);
  $('btn-night').setAttribute('aria-pressed', String(on));
}

function setTheme(mode) {
  prefs.theme = THEMES.includes(mode) ? mode : 'system';
  savePrefs();
  window.folio.setTheme(prefs.theme);
  $('btn-theme').title = `App theme: ${THEME_LABELS[prefs.theme]} (click to change)`;
}

function rotate() {
  if (hasDoc()) pdfViewer.pagesRotation = (pdfViewer.pagesRotation + 90) % 360;
}

function toggleSpread() {
  if (!hasDoc()) return;
  pdfViewer.spreadMode = pdfViewer.spreadMode === 0 ? 1 : 0;
  refitIfNeeded();
}

$('btn-open').addEventListener('click', openDialog);
$('btn-open-empty').addEventListener('click', openDialog);
$('btn-sidebar').addEventListener('click', () => setSidebar(el.sidebar.hidden));
$('btn-prev').addEventListener('click', () => pdfViewer.previousPage());
$('btn-next').addEventListener('click', () => pdfViewer.nextPage());
$('btn-zoom-in').addEventListener('click', () => zoomStep(1));
$('btn-zoom-out').addEventListener('click', () => zoomStep(-1));
$('btn-rotate').addEventListener('click', rotate);
$('btn-spread').addEventListener('click', toggleSpread);
$('btn-find').addEventListener('click', openFind);
$('btn-night').addEventListener('click', () => setNightPages(!prefs.nightPages));
$('btn-theme').addEventListener('click', () => setTheme(THEMES[(THEMES.indexOf(prefs.theme) + 1) % THEMES.length]));
document.querySelectorAll('.sidebar-tab').forEach((tab) => {
  tab.addEventListener('click', () => setPanel(tab.dataset.panel));
});

el.zoomSelect.addEventListener('change', () => {
  if (el.zoomSelect.value !== 'custom') setScaleValue(el.zoomSelect.value);
  el.container.focus({ preventScroll: true });
});

el.pageInput.addEventListener('change', () => {
  const n = parseInt(el.pageInput.value, 10);
  if (Number.isNaN(n)) el.pageInput.value = pdfViewer.currentPageNumber;
  else goToPage(n);
});
el.pageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    el.pageInput.dispatchEvent(new Event('change'));
    el.container.focus({ preventScroll: true });
  } else if (e.key === 'Escape') {
    el.pageInput.value = pdfViewer.currentPageNumber;
    el.container.focus({ preventScroll: true });
  }
});
el.pageInput.addEventListener('focus', () => el.pageInput.select());
el.pageInput.addEventListener('blur', () => updatePageControls(pdfViewer.currentPageNumber));

// Ctrl + mouse wheel zooms the document rather than the whole app.
window.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  if (hasDoc()) setScale(pdfViewer.currentScale * Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(refitIfNeeded, 120);
});

// ---------- Keyboard shortcuts ----------
window.addEventListener('keydown', (e) => {
  if ($('password-dialog').open) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const inField = e.target instanceof HTMLElement && e.target.matches('input, select, textarea');

  const shortcuts = {
    o: mod && openDialog,
    w: mod && (() => state.active && closeTab(state.active)),
    f: mod && openFind,
    r: mod && rotate,
    '=': mod && (() => zoomStep(1)),
    '+': mod && (() => zoomStep(1)),
    '-': mod && (() => zoomStep(-1)),
    '0': mod && (() => setScaleValue('page-fit')),
    '1': mod && (() => setScaleValue('page-actual')),
    '2': mod && (() => setScaleValue('page-width')),
    i: mod && e.shiftKey && (() => window.folio.toggleDevTools()),
    Tab: mod && (() => cycleTab(e.shiftKey ? -1 : 1)),
    F3: () => (el.findbar.hidden ? openFind() : runFind('again', e.shiftKey)),
    F4: () => hasDoc() && setSidebar(el.sidebar.hidden),
    F11: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
    F12: () => window.folio.toggleDevTools(),
    Escape: () => closeFind(),
  };

  const action = shortcuts[key];
  if (action) {
    e.preventDefault();
    action();
    return;
  }
  if (inField || mod || !hasDoc()) return;

  // Left/right turn pages when the page fits horizontally.
  const noSideScroll = el.container.scrollWidth <= el.container.clientWidth;
  if (key === 'ArrowLeft' && noSideScroll) { e.preventDefault(); pdfViewer.previousPage(); }
  if (key === 'ArrowRight' && noSideScroll) { e.preventDefault(); pdfViewer.nextPage(); }
  if (key === 'Home' && e.target !== el.container) { e.preventDefault(); goToPage(1); }
  if (key === 'End' && e.target !== el.container) { e.preventDefault(); goToPage(pdfViewer.pagesCount); }
});

// ---------- Drag and drop ----------
let dragDepth = 0;
const draggingFiles = (e) => e.dataTransfer?.types?.includes('Files');

window.addEventListener('dragenter', (e) => {
  if (!draggingFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  el.dropOverlay.hidden = false;
});
window.addEventListener('dragover', (e) => {
  if (!draggingFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
  if (!draggingFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) el.dropOverlay.hidden = true;
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  el.dropOverlay.hidden = true;
  const files = [...(e.dataTransfer?.files ?? [])].filter(
    (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name),
  );
  if (!files.length) {
    showToast('Only PDF files can be opened.');
    return;
  }
  const loaded = await Promise.all(files.map(async (f) => ({
    name: f.name,
    path: window.folio.pathForFile(f) || null,
    data: new Uint8Array(await f.arrayBuffer()),
  })));
  openFiles(loaded);
});

// ---------- Helpers ----------
function icon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

let toastTimer = 0;
function showToast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 5000);
}

// ---------- Start up ----------
setSidebar(prefs.sidebar);
setPanel(prefs.panel === 'outline' ? 'outline' : 'thumbs');
setNightPages(Boolean(prefs.nightPages));
setTheme(prefs.theme);

window.folio.onOpenFiles((files) => openFiles(files));
const initialFiles = await window.folio.getInitialFiles();
if (initialFiles.length) openFiles(initialFiles);
else showEmpty();
