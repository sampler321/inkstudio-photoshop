/* InkStudio for Photoshop: a Procreate-simple brush library + drawing rail.
   Brushes are never bundled: the user points the panel at a folder of packs
   (<folder>/<pack>/*.abr), indexed by tools/catalogue.py into <folder>/.inkstudio. */
const { entrypoints, storage } = require('uxp');
const ps = require('photoshop');
const { app, core, action } = ps;
const lfs = storage.localFileSystem;

/* debug log -> <plugin data>/inkstudio.log (UXP has no console without the dev tool) */
const LOG = [];
async function log(...a) {
  LOG.push(new Date().toISOString().slice(11, 19) + ' ' + a.map((x) => (x && x.stack) || (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' '));
  try { const d = await lfs.getDataFolder(); const f = await d.createFile('inkstudio.log', { overwrite: true }); await f.write(LOG.join('\n')); } catch (e) {}
}
window.addEventListener && window.addEventListener('error', (e) => log('window error', e.message || e));
log('start');

/* ---------- storage helpers ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('ink.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('ink.' + k, JSON.stringify(v)); } catch (e) {} },
};
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const status = (t) => { const s = $('#status'); if (s) s.textContent = t || ''; };

/* ---------- Photoshop actions (batchPlay, always modal-wrapped) ---------- */
async function modal(name, fn) {
  return core.executeAsModal(fn, { commandName: name });
}
async function play(descs, name = 'InkStudio') {
  return modal(name, () => action.batchPlay(descs, {}));
}
const ps_ = {
  async tool(t) { await play([{ _obj: 'select', _target: [{ _ref: t }] }], 'Tool'); },
  async loadAbr(path) {
    const entry = await lfs.getEntryWithUrl('file:' + path);
    const token = lfs.createSessionToken(entry);
    // same descriptor as app.load(): set application.brush to the file, appending
    await play([{ _obj: 'set', _target: [{ _ref: 'property', _property: 'brush' }, { _ref: 'application', _enum: 'ordinal', _value: 'targetEnum' }], to: { _path: token, _kind: 'local' }, append: true }], 'Load brushes');
  },
  async brush(name, tool = 'paintbrushTool') {
    await play([
      { _obj: 'select', _target: [{ _ref: tool }] },
      { _obj: 'select', _target: [{ _ref: 'brush', _name: name }] },
    ], 'Select brush');
  },
  async size(px) {
    await play([{ _obj: 'set', _target: [{ _ref: 'brush', _enum: 'ordinal', _value: 'targetEnum' }], to: { _obj: 'brush', masterDiameter: { _unit: 'pixelsUnit', _value: px } } }], 'Brush size');
  },
  // tool options must be read, patched and written back whole: a partial set resets the rest
  async toolOpts(patch, name = 'Brush options') {
    const t = await currentTool();
    await modal(name, async () => {
      const r = await action.batchPlay([{ _obj: 'get', _target: [{ _property: 'currentToolOptions' }, { _ref: 'application', _enum: 'ordinal', _value: 'targetEnum' }] }], {});
      const cur = (r[0] && r[0].currentToolOptions) || {};
      await action.batchPlay([{ _obj: 'set', _target: [{ _ref: t }], to: Object.assign({}, cur, { _obj: 'currentToolOptions' }, patch) }], {});
    });
  },
  async opacity(pct) { await ps_.toolOpts({ opacity: pct }, 'Opacity'); },
  async step(dir) {
    await play([{ _obj: 'select', _target: [{ _ref: 'historyState', _enum: 'ordinal', _value: dir }] }], dir === 'previous' ? 'Undo' : 'Redo');
  },
  async pickColor() {
    const c = app.foregroundColor;
    const r = await play([{ _obj: 'showColorPicker', context: 'InkStudio', color: { _obj: 'RGBColor', red: c.rgb.red, grain: c.rgb.green, blue: c.rgb.blue } }], 'Colour');
    const col = r && r[0] && r[0].RGBFloatColor || r && r[0] && r[0].color;
    if (!col) return null;
    const rgb = { red: Math.round(col.red), green: Math.round(col.grain != null ? col.grain : col.green), blue: Math.round(col.blue) };
    await ps_.setColor(rgb);
    return rgb;
  },
  async setColor(rgb) {
    await play([{ _obj: 'set', _target: [{ _ref: 'color', _property: 'foregroundColor' }], to: { _obj: 'RGBColor', red: rgb.red, grain: rgb.green, blue: rgb.blue }, source: 'photoshopPicker' }], 'Colour');
  },
};
// paper grain: plugin/assets/paper-tooth.png becomes the "InkStudio Paper" pattern the first time it is needed
let paperReady = false;
async function ensurePaper() {
  if (paperReady || store.get('paperDefined', false)) { paperReady = true; return; }
  const pf = await lfs.getPluginFolder();
  const png = await pf.getEntry('assets/paper-tooth.png');
  const token = lfs.createSessionToken(png);
  await modal('Paper', async () => {
    const keep = app.activeDocument;
    await action.batchPlay([{ _obj: 'open', null: { _path: token, _kind: 'local' } }], {});
    await action.batchPlay([
      { _obj: 'set', _target: [{ _ref: 'channel', _property: 'selection' }], to: { _enum: 'ordinal', _value: 'allEnum' } },
      { _obj: 'make', _target: [{ _ref: 'pattern' }], using: { _ref: [{ _ref: 'property', _property: 'selection' }, { _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }] }, name: 'InkStudio Paper' },
      { _obj: 'close', saving: { _enum: 'yesNo', _value: 'no' } },
    ], {});
    if (keep) app.activeDocument = keep;
  });
  store.set('paperDefined', true); paperReady = true;
}
/* media behaviour: which Photoshop painting features a medium switches on (all visible as rail toggles) */
const MEDIUM_FX = {
  'Pencil':            { paper: true,  wet: false, layer: false },
  'Charcoal & pastel': { paper: true,  wet: false, layer: false },
  'Watercolour':       { paper: true,  wet: true,  layer: true },
  'Marker':            { paper: false, wet: false, layer: true },
};
function fxPatch(fx) {
  const p = { wetEdges: !!fx.wet, mode: { _enum: 'blendMode', _value: fx.layer ? 'multiply' : 'normal' }, useTexture: !!fx.paper };
  if (fx.paper) Object.assign(p, {
    texture: { _obj: 'pattern', name: 'InkStudio Paper' }, textureScale: { _unit: 'percentUnit', _value: 100 }, textureBlendMode: { _enum: 'blendMode', _value: 'height' },
    textureDepth: { _unit: 'percentUnit', _value: 70 }, minimumDepth: { _unit: 'percentUnit', _value: 15 },
    textureDepthDynamics: { _obj: 'brVr', bVTy: 2, fStp: 25, jitter: { _unit: 'percentUnit', _value: 0 }, minimum: { _unit: 'percentUnit', _value: 15 } },
  });
  return p;
}
async function currentTool() {
  const r = await action.batchPlay([{ _obj: 'get', _target: [{ _property: 'tool' }, { _ref: 'application', _enum: 'ordinal', _value: 'targetEnum' }] }], {});
  return (r[0] && r[0].tool && r[0].tool._enum) || 'paintbrushTool';
}

/* ---------- library model ---------- */
const MEDIA = [
  ['Pencil', /pencil|graphite|sketch|hatch/i],
  ['Ink & pen', /\bink|inky|pen\b|liner|nib|calligraph|dip pen|fountain/i],
  ['Marker', /marker|felt|copic|highlighter/i],
  ['Watercolour', /water ?colou?r|wash|aquarel|wet/i],
  ['Gouache & acrylic', /gouache|acrylic|poster paint|tempera/i],
  ['Oil', /\boil|impasto|palette knife/i],
  ['Charcoal & pastel', /charcoal|pastel|chalk|crayon|conte|graphite stick/i],
  ['Spray & splatter', /spray|splatter|splash|drip|blot|airbrush|drop/i],
  ['Texture & grain', /texture|grain|noise|halftone|paper|grunge|stipple|dry ?brush|canvas/i],
];
let LIB = null;          // {root, packs}
let loaded = new Set(store.get('loaded', []));
let favs = new Set(store.get('favs', []));
let recent = store.get('recent', []);
let tab = 'media', media = null, query = '';
let lastBrushKey = null, syncRail = null, applyPressure = null, currentBrush = null, setFx = null;
const open = new Set();

function packMedia(p) {
  const hay = [p.title, (p.tags || []).join(' '), p.id].join(' ');
  return MEDIA.filter(([, re]) => re.test(hay)).map(([n]) => n);
}
async function readText(path) {
  const e = await lfs.getEntryWithUrl('file:' + path);
  return e.read();
}
const imgCache = new Map();
async function imgUrl(path) {
  if (imgCache.has(path)) return imgCache.get(path);
  let url = 'file:' + path;
  try {
    const e = await lfs.getEntryWithUrl('file:' + path);
    const buf = await e.read({ format: storage.formats.binary });
    const b = new Uint8Array(buf); let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    url = (path.endsWith('.png') ? 'data:image/png;base64,' : 'data:image/jpeg;base64,') + btoa(s);
  } catch (e) {}
  imgCache.set(path, url);
  return url;
}
function lazyImg(img, path) { imgUrl(path).then((u) => { img.src = u; }); }

async function loadLibrary(root) {
  try {
    const cat = JSON.parse(await readText(root + '/.inkstudio/catalog.json'));
    const SAMPLE = /^Sampled Brush \d+/i;
    cat.packs.forEach((p) => {
      p.media = packMedia(p);
      // .abr files also name each sampled tip ("Sampled Brush 3 1"); keep only real preset names
      p.files.forEach((f) => { const real = f.brushes.filter((b) => !SAMPLE.test(b)); if (real.length) f.brushes = [...new Set(real)]; });
      p.count = p.files.reduce((a, f) => a + Math.max(f.brushes.length, f.tips.length ? 1 : 0), 0);
    });
    LIB = { root, packs: cat.packs.filter((p) => p.count > 0) };
    store.set('root', root);
    const n = LIB.packs.reduce((a, p) => a + p.count, 0);
    status(`${LIB.packs.length} packs · ${n.toLocaleString()} brushes`);
  } catch (e) {
    LIB = null;
    status('No catalogue in that folder. Run tools/catalogue.py on it.');
  }
  render();
}

/* ---------- rendering ---------- */
function visiblePacks() {
  if (!LIB) return [];
  let ps = LIB.packs;
  if (tab === 'media' && media) ps = ps.filter((p) => p.media.includes(media));
  if (tab === 'fav') ps = ps.filter((p) => favs.has('pack:' + p.id) || p.files.some((f) => f.brushes.some((b) => favs.has(key(p, f, b)))));
  if (tab === 'recent') { const ids = recent.map((r) => r.pack); ps = ids.map((id) => LIB.packs.find((p) => p.id === id)).filter(Boolean).filter((p, i, a) => a.indexOf(p) === i); }
  if (query) {
    const q = query.toLowerCase();
    ps = ps.filter((p) => [p.title, p.author, (p.tags || []).join(' '), p.files.map((f) => f.brushes.join(' ')).join(' ')].join(' ').toLowerCase().includes(q));
  }
  return ps;
}
const key = (p, f, b) => `b:${p.id}/${f.file}/${b}`;

function render() {
  const list = $('#list'); if (!list) return;
  $('#empty').classList.toggle('hidden', !!LIB);
  list.classList.toggle('hidden', !LIB);
  renderChips();
  list.innerHTML = '';
  const packs = visiblePacks();
  if (LIB && !packs.length) list.appendChild(el('div', 'none', tab === 'fav' ? 'Star a pack or a brush to keep it here.' : 'Nothing matches.'));
  packs.slice(0, 400).forEach((p) => list.appendChild(packRow(p)));
}
function renderChips() {
  const c = $('#chips'); c.innerHTML = '';
  c.classList.toggle('hidden', tab !== 'media' || !LIB);
  if (tab !== 'media' || !LIB) return;
  MEDIA.forEach(([n]) => {
    const cnt = LIB.packs.filter((p) => p.media.includes(n)).length;
    if (!cnt) return;
    const b = el('div', 'b chip' + (media === n ? ' on' : ''), n);
    b.title = `${cnt} packs`;
    b.onclick = () => { media = media === n ? null : n; render(); };
    c.appendChild(b);
  });
}
function star(k, onChange) {
  const s = el('div', 'b star' + (favs.has(k) ? ' on' : ''), favs.has(k) ? '★' : '☆');
  s.title = 'Favourite';
  s.onclick = (ev) => { ev.stopPropagation(); favs.has(k) ? favs.delete(k) : favs.add(k); store.set('favs', [...favs]); s.textContent = favs.has(k) ? '★' : '☆'; s.classList.toggle('on', favs.has(k)); onChange && onChange(); };
  return s;
}
function packRow(p) {
  const row = el('div', 'pack' + (open.has(p.id) ? ' open' : ''));
  const head = el('div', 'head');
  const thumb = el('img', 'cover');
  if (p.covers && p.covers[0]) lazyImg(thumb, LIB.root + '/.inkstudio/' + p.covers[0]);
  const meta = el('div', 'meta');
  meta.appendChild(el('div', 'title', p.title));
  meta.appendChild(el('div', 'sub', `${p.author || 'Unknown maker'} · ${p.count}`));
  head.appendChild(thumb); head.appendChild(meta); head.appendChild(star('pack:' + p.id));
  head.onclick = () => { open.has(p.id) ? open.delete(p.id) : open.add(p.id); row.replaceWith(packRow(p)); };
  row.appendChild(head);
  if (open.has(p.id)) row.appendChild(packBody(p));
  return row;
}
function packBody(p) {
  const body = el('div', 'body');
  if (p.media.length) body.appendChild(el('div', 'mediaLine', p.media.join(' · ')));
  // Envato's own description, collapsed to a few lines until asked
  if (p.description) {
    const d = el('div', 'desc clamp', p.description.replace(/[*_#>]+/g, '').replace(/\n{2,}/g, '\n').trim());
    const more = el('div', 'b link', 'More');
    more.onclick = () => { const c = d.classList.toggle('clamp'); more.textContent = c ? 'More' : 'Less'; };
    body.appendChild(d); body.appendChild(more);
  }
  if (p.tags && p.tags.length) {
    const t = el('div', 'tags');
    p.tags.slice(0, 12).forEach((tg) => { const b = el('div', 'b tag', tg); b.onclick = () => { query = tg; $('#q').value = tg; tab = 'packs'; setTab(); render(); }; t.appendChild(b); });
    body.appendChild(t);
  }
  p.files.forEach((f) => {
    if (p.files.length > 1) body.appendChild(el('div', 'file', f.file.split('/').pop().replace(/\.abr$/i, '')));
    const grid = el('div', 'grid');
    const names = f.brushes.length ? f.brushes : f.tips.map((_, i) => `Brush ${i + 1}`);
    names.forEach((b, i) => {
      const cell = el('div', 'cell');
      const im = el('img', 'tip');
      const tip = f.tips[Math.min(i, f.tips.length - 1)];
      if (tip && i < f.tips.length) lazyImg(im, LIB.root + '/.inkstudio/' + tip); else im.classList.add('blank');
      cell.appendChild(im);
      cell.appendChild(el('div', 'name', b));
      cell.appendChild(star(key(p, f, b)));
      cell.title = b;
      cell.onclick = () => useBrush(p, f, b, cell);
      grid.appendChild(cell);
    });
    body.appendChild(grid);
  });
  return body;
}
async function useBrush(p, f, b, cell) {
  document.querySelectorAll('.cell.sel').forEach((c) => c.classList.remove('sel'));
  cell && cell.classList.add('sel');
  const path = LIB.root + '/' + f.file;
  try {
    if (!loaded.has(path)) {
      status(`Loading ${p.title}…`);
      await ps_.loadAbr(path);
      loaded.add(path); store.set('loaded', [...loaded]);
    }
    await ps_.brush(b);
    // Envato tips are huge (often 2000-5000 px); start at the size last used with this brush, else 120 px
    const sizes = store.get('sizes', {});
    const px = sizes[key(p, f, b)] || 120;
    await ps_.size(px);
    applyPressure && await applyPressure();
    const fx = Object.assign({ paper: false, wet: false, layer: false }, MEDIUM_FX[p.media.find((m) => MEDIUM_FX[m])] || {}, store.get('fx', {})[key(p, f, b)] || {});
    setFx && await setFx(fx);
    lastBrushKey = key(p, f, b);
    currentBrush = { name: b, px };
    document.querySelectorAll('.tool').forEach((x) => x.classList.toggle('on', x.dataset.tool === 'paintbrushTool'));
    syncRail && syncRail();
    status(b + ' · ' + px + ' px');
    recent = [{ pack: p.id, file: f.file, brush: b }, ...recent.filter((r) => !(r.pack === p.id && r.brush === b))].slice(0, 40);
    store.set('recent', recent);
  } catch (e) { status('Could not select: ' + (e.message || e)); }
}
function setTab() { document.querySelectorAll('#tabs .b').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab)); }

/* ---------- library wiring ---------- */
function initLibrary() {
  document.querySelectorAll('#tabs .b').forEach((b) => b.onclick = () => { tab = b.dataset.tab; setTab(); render(); });
  let t; $('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { query = e.target.value.trim(); render(); }, 150); });
  const pick = async () => { const f = await lfs.getFolder(); if (f) loadLibrary(f.nativePath); };
  $('#pick').onclick = pick; $('#settings').onclick = pick;
  // <plugin data>/library.txt (if present) names the brush folder; otherwise the last folder picked
  const root = store.get('root', null);
  lfs.getDataFolder().then((d) => d.getEntry('library.txt')).then((f) => f.read())
    .then((p) => { p = p.trim(); if (p) loadLibrary(p); else if (root) loadLibrary(root); else render(); })
    .catch(() => { if (root) loadLibrary(root); else render(); });
}

/* ---------- rail ---------- */
/* Procreate-style vertical slider: drag anywhere on the track, relative like a fader */
function vslider(node, { min, max, value, onInput, onChange }) {
  let v = value, startY = 0, startV = 0, dragging = false;
  const fill = node.querySelector('.fill'), knob = node.querySelector('.knob');
  const paint = () => { const t = (v - min) / (max - min); fill.style.height = (t * 100) + '%'; knob.style.bottom = `calc(${t * 100}% - 4px)`; };
  const h = () => node.getBoundingClientRect().height || 160;
  node.addEventListener('pointerdown', (e) => { dragging = true; startY = e.clientY; startV = v; try { node.setPointerCapture(e.pointerId); } catch (x) {} });
  node.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    v = Math.max(min, Math.min(max, startV + (startY - e.clientY) / h() * (max - min)));
    paint(); onInput && onInput(v);
  });
  const end = () => { if (!dragging) return; dragging = false; onChange && onChange(v); };
  node.addEventListener('pointerup', end); node.addEventListener('pointercancel', end);
  paint();
  return { get value() { return v; }, set value(x) { v = Math.max(min, Math.min(max, x)); paint(); } };
}

const SIZE_MIN = 1, SIZE_MAX = 2500;
const sliderToPx = (v) => Math.round(SIZE_MIN * Math.pow(SIZE_MAX / SIZE_MIN, v / 1000));
const pxToSlider = (px) => Math.round(1000 * Math.log(px / SIZE_MIN) / Math.log(SIZE_MAX / SIZE_MIN));
let recentColors = store.get('colors', []);
function paintColor() {
  try { const c = app.foregroundColor.rgb; $('#color').style.backgroundColor = `rgb(${c.red},${c.green},${c.blue})`; } catch (e) {}
  const rc = $('#recentColors'); rc.innerHTML = '';
  recentColors.slice(0, 8).forEach((c) => { const b = el('div', 'b swatch'); b.style.backgroundColor = `rgb(${c.red},${c.green},${c.blue})`; b.onclick = async () => { await ps_.setColor(c); paintColor(); }; rc.appendChild(b); });
}
function initRail() {
  // Procreate: erase / smudge / wet-mix with the brush you are painting with, at the same size
  const tools = document.querySelectorAll('.tool');
  const markTool = (t) => tools.forEach((x) => x.classList.toggle('on', x.dataset.tool === t));
  tools.forEach((b) => b.onclick = async () => {
    const t = b.dataset.tool; markTool(t);
    try {
      if (currentBrush) {
        await ps_.brush(currentBrush.name, t);
        await ps_.size(currentBrush.px || sliderToPx(size.value));
        applyPressure && await applyPressure();
      } else await ps_.tool(t);
    } catch (e) { log('tool', t, e); try { await ps_.tool(t); } catch (x) {} }
  });
  markTool('paintbrushTool');
  const sizeV = $('#sizeV'), opV = $('#opV');
  const showSize = () => { sizeV.textContent = sliderToPx(size.value) + ' px'; };
  const size = vslider($('#size'), { min: 0, max: 1000, value: pxToSlider(120),
    onInput: () => showSize(),
    onChange: (v) => {
      const px = sliderToPx(v);
      if (lastBrushKey) { const m = store.get('sizes', {}); m[lastBrushKey] = px; store.set('sizes', m); }
      if (currentBrush) currentBrush.px = px;
      ps_.size(px).catch((e) => log('size', e));
    } });
  const op = vslider($('#opacity'), { min: 1, max: 100, value: 100,
    onInput: (v) => { opV.textContent = Math.round(v) + '%'; },
    onChange: (v) => ps_.opacity(Math.round(v)).catch((e) => log('opacity', e)) });
  showSize(); opV.textContent = '100%';
  const pS = $('#pSize'), pO = $('#pOpacity');
  const prs = store.get('pressure', { size: true, opacity: true });
  const paintP = () => { pS.classList.toggle('on', prs.size); pO.classList.toggle('on', prs.opacity); };
  const applyP = () => ps_.toolOpts({ usePressureOverridesSize: prs.size, usePressureOverridesOpacity: prs.opacity }, 'Pressure').catch((e) => log('pressure', e));
  pS.onclick = () => { prs.size = !prs.size; store.set('pressure', prs); paintP(); applyP(); };
  pO.onclick = () => { prs.opacity = !prs.opacity; store.set('pressure', prs); paintP(); applyP(); };
  paintP();
  applyPressure = applyP;
  let fxNow = { paper: false, wet: false, layer: false };
  const fxEls = { paper: $('#fxPaper'), wet: $('#fxWet'), layer: $('#fxLayer') };
  const paintFx = () => Object.keys(fxEls).forEach((k) => fxEls[k].classList.toggle('on', !!fxNow[k]));
  setFx = async (fx) => {
    fxNow = fx; paintFx();
    try { if (fx.paper) await ensurePaper(); await ps_.toolOpts(fxPatch(fx), 'Media'); } catch (e) { log('fx', e); }
  };
  Object.keys(fxEls).forEach((k) => fxEls[k].onclick = () => {
    const fx = Object.assign({}, fxNow, { [k]: !fxNow[k] });
    if (lastBrushKey) { const m = store.get('fx', {}); m[lastBrushKey] = fx; store.set('fx', m); }   // remembered per brush
    setFx(fx);
  });
  paintFx();
  $('#undo').onclick = () => ps_.step('previous').catch((e) => console.error(e));
  $('#redo').onclick = () => ps_.step('next').catch((e) => console.error(e));
  $('#color').onclick = async () => {
    try {
      const c = await ps_.pickColor();
      if (c) { recentColors = [c, ...recentColors.filter((x) => x.red !== c.red || x.green !== c.green || x.blue !== c.blue)].slice(0, 12); store.set('colors', recentColors); }
    } catch (e) { console.error(e); }
    paintColor();
  };
  paintColor();
  // keep the rail in step with brush size / colour changed elsewhere
  syncRail = async () => {
    paintColor();
    try {
      const r = await action.batchPlay([{ _obj: 'get', _target: [{ _property: 'currentToolOptions' }, { _ref: 'application', _enum: 'ordinal', _value: 'targetEnum' }] }], {});
      const o = r[0] && r[0].currentToolOptions;
      if (o && o.brush && o.brush.diameter) { size.value = pxToSlider(o.brush.diameter._value); showSize(); }
      if (o && o.opacity != null) { op.value = o.opacity; opV.textContent = Math.round(o.opacity) + '%'; }
    } catch (e) {}
  };
  action.addNotificationListener(['set', 'select'], () => syncRail());
}

/* ---------- panel entrypoints ---------- */
const mount = (id) => ({
  show(ev) {
    log('show', id, ev && (ev.node ? 'node' : typeof ev));
    const node = (ev && ev.node) || ev || document.body;
    const part = document.getElementById(id);
    if (part && part.parentNode !== node && node.appendChild) node.appendChild(part);
  },
});
try { entrypoints.setup({ panels: { library: mount('library'), rail: mount('rail') } }); log('setup ok'); } catch (e) { log('setup', e); }
try { initLibrary(); log('library ok'); } catch (e) { log('initLibrary', e); }
try { initRail(); log('rail ok'); } catch (e) { log('initRail', e); }
