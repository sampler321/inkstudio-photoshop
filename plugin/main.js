/* InkStudio for Photoshop: a Procreate-simple brush library + drawing rail.
   Brushes are never bundled: the user points the panel at a folder of packs
   (<folder>/<pack>/*.abr), indexed by tools/catalogue.py into <folder>/.inkstudio. */
const { entrypoints, storage } = require('uxp');
const ps = require('photoshop');
const { app, core, action } = ps;
const lfs = storage.localFileSystem;

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
  async brush(name) {
    await play([
      { _obj: 'select', _target: [{ _ref: 'paintbrushTool' }] },
      { _obj: 'select', _target: [{ _ref: 'brush', _name: name }] },
    ], 'Select brush');
  },
  async size(px) {
    await play([{ _obj: 'set', _target: [{ _ref: 'brush', _enum: 'ordinal', _value: 'targetEnum' }], to: { _obj: 'brush', masterDiameter: { _unit: 'pixelsUnit', _value: px } } }], 'Brush size');
  },
  async opacity(pct) {
    const t = await currentTool();
    await play([{ _obj: 'set', _target: [{ _ref: t }], to: { _obj: 'currentToolOptions', opacity: pct } }], 'Opacity');
  },
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
    cat.packs.forEach((p) => { p.media = packMedia(p); });
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
    const b = el('button', 'chip' + (media === n ? ' on' : ''), n);
    b.title = `${cnt} packs`;
    b.onclick = () => { media = media === n ? null : n; render(); };
    c.appendChild(b);
  });
}
function star(k, onChange) {
  const s = el('button', 'star' + (favs.has(k) ? ' on' : ''), favs.has(k) ? '★' : '☆');
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
    const more = el('button', 'link', 'More');
    more.onclick = () => { const c = d.classList.toggle('clamp'); more.textContent = c ? 'More' : 'Less'; };
    body.appendChild(d); body.appendChild(more);
  }
  if (p.tags && p.tags.length) {
    const t = el('div', 'tags');
    p.tags.slice(0, 12).forEach((tg) => { const b = el('button', 'tag', tg); b.onclick = () => { query = tg; $('#q').value = tg; tab = 'packs'; setTab(); render(); }; t.appendChild(b); });
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
    status(b);
    recent = [{ pack: p.id, file: f.file, brush: b }, ...recent.filter((r) => !(r.pack === p.id && r.brush === b))].slice(0, 40);
    store.set('recent', recent);
  } catch (e) { status('Could not select: ' + (e.message || e)); }
}
function setTab() { document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab)); }

/* ---------- library wiring ---------- */
function initLibrary() {
  document.querySelectorAll('#tabs button').forEach((b) => b.onclick = () => { tab = b.dataset.tab; setTab(); render(); });
  let t; $('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { query = e.target.value.trim(); render(); }, 150); });
  const pick = async () => { const f = await lfs.getFolder(); if (f) loadLibrary(f.nativePath); };
  $('#pick').onclick = pick; $('#settings').onclick = pick;
  const root = store.get('root', null);
  if (root) loadLibrary(root); else render();
}

/* ---------- rail ---------- */
const SIZE_MIN = 1, SIZE_MAX = 2500;
const sliderToPx = (v) => Math.round(SIZE_MIN * Math.pow(SIZE_MAX / SIZE_MIN, v / 1000));
const pxToSlider = (px) => Math.round(1000 * Math.log(px / SIZE_MIN) / Math.log(SIZE_MAX / SIZE_MIN));
let recentColors = store.get('colors', []);
function paintColor() {
  try { const c = app.foregroundColor.rgb; $('#color').style.backgroundColor = `rgb(${c.red},${c.green},${c.blue})`; } catch (e) {}
  const rc = $('#recentColors'); rc.innerHTML = '';
  recentColors.slice(0, 8).forEach((c) => { const b = el('button', 'swatch'); b.style.backgroundColor = `rgb(${c.red},${c.green},${c.blue})`; b.onclick = async () => { await ps_.setColor(c); paintColor(); }; rc.appendChild(b); });
}
function initRail() {
  document.querySelectorAll('.tool').forEach((b) => b.onclick = () => ps_.tool(b.dataset.tool).catch((e) => console.error(e)));
  const size = $('#size'), sizeV = $('#sizeV'), op = $('#opacity'), opV = $('#opV');
  const showSize = () => { sizeV.textContent = sliderToPx(+size.value) + ' px'; };
  size.addEventListener('input', showSize);
  size.addEventListener('change', () => ps_.size(sliderToPx(+size.value)).catch((e) => console.error(e)));
  op.addEventListener('input', () => { opV.textContent = op.value + '%'; });
  op.addEventListener('change', () => ps_.opacity(+op.value).catch((e) => console.error(e)));
  showSize(); opV.textContent = op.value + '%';
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
  action.addNotificationListener(['set', 'select'], async () => {
    paintColor();
    try {
      const r = await action.batchPlay([{ _obj: 'get', _target: [{ _property: 'currentToolOptions' }, { _ref: 'application', _enum: 'ordinal', _value: 'targetEnum' }] }], {});
      const o = r[0] && r[0].currentToolOptions;
      if (o && o.brush && o.brush.diameter) { size.value = pxToSlider(o.brush.diameter._value); showSize(); }
      if (o && o.opacity != null) { op.value = o.opacity; opV.textContent = o.opacity + '%'; }
    } catch (e) {}
  });
}

/* ---------- panel entrypoints ---------- */
const mount = (id) => ({
  show(ev) {
    const node = (ev && ev.node) || ev || document.body;
    const part = document.getElementById(id);
    if (part && part.parentNode !== node && node.appendChild) node.appendChild(part);
  },
});
entrypoints.setup({ panels: { library: mount('library'), rail: mount('rail') } });
initLibrary();
initRail();
