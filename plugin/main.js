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
  // batchPlay reports failures as {_obj:'error'} results instead of throwing
  const r = await modal(name, () => action.batchPlay(descs, {}));
  const bad = (r || []).find((x) => x && x._obj === 'error');
  if (bad) throw new Error(bad.message || ('Photoshop error ' + bad.result));
  return r;
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
  // give eraser / smudge / mixer the painting brush: copy its tip, dynamics and grain into that tool's options
  async carryBrush(tool) {
    const get = () => action.batchPlay([{ _obj: 'get', _target: [{ _property: 'currentToolOptions' }, { _ref: 'application', _enum: 'ordinal', _value: 'targetEnum' }] }], {}).then((r) => (r[0] && r[0].currentToolOptions) || {});
    await modal('Carry brush', async () => {
      await action.batchPlay([{ _obj: 'select', _target: [{ _ref: 'paintbrushTool' }] }], {});
      const src = await get();
      await action.batchPlay([{ _obj: 'select', _target: [{ _ref: tool }] }], {});
      const dst = await get();
      const skip = new Set(['_obj', 'mode', 'opacity', 'flow', 'foregroundColor']);
      Object.keys(src).forEach((k) => { if (!skip.has(k) && k in dst) dst[k] = src[k]; });
      await action.batchPlay([{ _obj: 'set', _target: [{ _ref: tool }], to: Object.assign(dst, { _obj: 'currentToolOptions' }) }], {});
    });
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
const MEDIUM_FX = {   // paper: texture mode + depth tuned by test strokes (subtract reads as graphite on tooth)
  'Pencil':            { paper: true,  wet: false, layer: false, grain: ['subtract', 100], px: 30 },
  'Charcoal & pastel': { paper: true,  wet: false, layer: false, grain: ['multiply', 55], px: 60 },
  'Watercolour':       { paper: true,  wet: true,  layer: true,  grain: ['subtract', 50], px: 160 },
  'Marker':            { paper: false, wet: false, layer: true,  px: 50 },
  'Ink & pen':         { paper: false, wet: false, layer: false, px: 16 },
};
function fxPatch(fx) {
  const p = { wetEdges: !!fx.wet, mode: { _enum: 'blendMode', _value: fx.layer ? 'multiply' : 'normal' } };
  if (!fx.own) p.useTexture = !!fx.paper;   // a brush with its own grain keeps it unless paper is switched on explicitly
  const nat = (currentBrush && currentBrush.native) || {};
  if (fx.tilt) Object.assign(p, {   // pen tilt turns and flattens the tip, like shading with the side of a pencil
    useTipDynamics: true,
    angleDynamics: { _obj: '$brVr', $bVTy: 3, $fStp: 25, jitter: { _unit: 'percentUnit', _value: 0 }, minimum: { _unit: 'percentUnit', _value: 0 } },
    roundnessDynamics: { _obj: '$brVr', $bVTy: 3, $fStp: 25, jitter: { _unit: 'percentUnit', _value: 0 }, minimum: { _unit: 'percentUnit', _value: 30 } },
  });
  else if (nat.angleDynamics) Object.assign(p, { useTipDynamics: !!nat.useTipDynamics, angleDynamics: nat.angleDynamics, roundnessDynamics: nat.roundnessDynamics });
  if (fx.paper) Object.assign(p, {
    useTexture: true, invertTexture: false,
    texture: { _obj: 'pattern', name: 'InkStudio Paper' }, textureScale: { _unit: 'percentUnit', _value: 100 }, textureBlendMode: { _enum: 'blendMode', _value: (fx.grain || ['subtract'])[0] },
    textureDepth: { _unit: 'percentUnit', _value: (fx.grain || [0, 80])[1] }, minimumDepth: { _unit: 'percentUnit', _value: 15 },
    textureDepthDynamics: { _obj: '$brVr', $bVTy: 2, $fStp: 25, jitter: { _unit: 'percentUnit', _value: 0 }, minimum: { _unit: 'percentUnit', _value: 15 } },
  });
  return p;
}
async function nativeOptions() {
  const r = await action.batchPlay([{ _obj: 'get', _target: [{ _property: 'currentToolOptions' }, { _ref: 'application', _enum: 'ordinal', _value: 'targetEnum' }] }], {});
  return (r[0] && r[0].currentToolOptions) || {};
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
  ['Stamps', /(?!)/],
];
let LIB = null;          // {root, packs}
let loaded = new Set(store.get('loaded', []));
let favs = new Set(store.get('favs', []));
let recent = store.get('recent', []);
let tab = 'media', media = null, query = '';
let tipF = null;   // tip-type filter: image, round, bristle, erodible/airbrush
const tipOf = (f, i) => { const x = f.pen && f.pen[i]; return x && x.tip; };
const TIP_FILTERS = [['image', 'Image'], ['round', 'Round'], ['bristle', 'Bristle'], ['erodible/airbrush', 'Erodible']];
let inspT = null, loadPressure = null;
let lastBrushKey = null, syncRail = null, applyPressure = null, currentBrush = null, setFx = null, fxNowRef = () => ({});
const open = new Set();
const showAll = new Set();
const upTo = (n, cls) => { while (n && !(n.classList && n.classList.contains(cls))) n = n.parentNode; return n; };

function packMedia(p) {
  const hay = [p.title, (p.tags || []).join(' '), p.id].join(' ');
  // stamps are single impressions, not stroke brushes: they live under Stamps only
  if (/stamp/i.test(p.title + ' ' + p.id)) return ['Stamps'];
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
    cat.packs.forEach((p) => {
      p.media = packMedia(p);
      // marketing counts in titles ("100 Watercolor ...") rarely match the real brushes: show the name, real count below
      p.name = (p.title || p.id).replace(/^\s*\d+[+]?\s*[-–:]?\s*/, '').replace(/^(CM|CM\s*\d+)\s*-\s*/i, '') || p.title;
    });
    cat.packs.sort((a, b) => a.name.localeCompare(b.name));
    LIB = { root, packs: cat.packs.filter((p) => p.count > 0) };
    store.set('root', root);
    const n = LIB.packs.reduce((a, p) => a + p.count, 0);
    status(`${LIB.packs.length} packs, ${n.toLocaleString()} brushes`);
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
  if (tab === 'media' && tipF) ps = ps.filter((p) => p.files.some((f) => (f.pen || []).some((x) => x && x.tip === tipF)));
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
  if (tab === 'mine') return renderMine(list);
  if (tab === 'fav') return renderFavs(list);
  $('#empty').classList.toggle('hidden', !!LIB);
  list.classList.toggle('hidden', !LIB);
  renderChips();
  list.innerHTML = '';
  const packs = visiblePacks();
  if (LIB && !packs.length) list.appendChild(el('div', 'none', tab === 'fav' ? 'Star a pack or a brush to keep it here.' : 'Nothing matches.'));
  // gallery views: explicit rows (UXP can't wrap stacked cards), an open pack gets a full row
  const per = { 0: 0, 1: 2, 2: 1 }[store.get('zoom', 0)] || 0;
  if (!per) { packs.slice(0, 400).forEach((p) => list.appendChild(packRow(p))); return; }
  let row = null;
  packs.slice(0, 400).forEach((p) => {
    if (open.has(p.id)) { row = null; const r = el('div', 'grow'); r.appendChild(packRow(p)); list.appendChild(r); return; }
    if (!row || row.childNodes.length >= per) { row = el('div', 'grow'); list.appendChild(row); }
    row.appendChild(packRow(p));
  });
}

/* Mine: brushes you saved to Photoshop, shown with the preview of the brush they came from */

/* Favourites: starred brushes as their own tiles; whole packs only when the pack itself is starred */
function renderFavs(list) {
  $('#empty').classList.toggle('hidden', !!LIB); list.classList.remove('hidden'); renderChips();
  list.innerHTML = '';
  if (!LIB) return;
  const brushes = [];
  LIB.packs.forEach((p) => p.files.forEach((f) => f.brushes.forEach((b, i) => { if (favs.has(key(p, f, b))) brushes.push({ p, f, b, i }); })));
  const packs = LIB.packs.filter((p) => favs.has('pack:' + p.id));
  if (!brushes.length && !packs.length) { list.appendChild(el('div', 'none', 'Star a brush or a pack to keep it here.')); return; }
  if (brushes.length) {
    list.appendChild(el('div', 'favHead', 'Brushes'));
    const grid = el('div', 'grid');
    brushes.forEach(({ p, f, b, i }) => {
      const cell = el('div', 'cell');
      const im = el('img', 'tip');
      const pv = (f.tips && f.tips[i]) || (f.strokes && f.strokes[i]);
      if (pv) lazyImg(im, LIB.root + '/.inkstudio/' + pv); else im.classList.add('blank');
      cell.appendChild(im); cell.appendChild(el('div', 'name', b)); cell.appendChild(el('div', 'name favPack', p.name || p.title));
      const st = star(key(p, f, b), () => render()); cell.appendChild(st);
      { const tb = tipBadge(f, i); if (tb) cell.appendChild(el('span', 'tipBadge cellBadge', tb)); }
      cell.title = b + ' (' + (p.name || p.title) + ')';
      cell.onclick = () => useBrush(p, f, b, cell).catch(() => {});
      grid.appendChild(cell);
    });
    list.appendChild(grid);
  }
  if (packs.length) { list.appendChild(el('div', 'favHead', 'Packs')); packs.forEach((p) => list.appendChild(packRow(p))); }
}

function renderMine(list) {
  $('#empty').classList.add('hidden'); list.classList.remove('hidden'); renderChips();
  list.innerHTML = '';
  const mine = store.get('myBrushes', []);
  if (!mine.length) { list.appendChild(el('div', 'none', 'Brushes you save with "Save brush" in the Brush panel appear here.')); return; }
  const grid = el('div', 'grid');
  mine.slice().reverse().forEach((m) => {
    const cell = el('div', 'cell');
    const im = el('img', 'tip');
    if (m.preview && LIB) lazyImg(im, LIB.root + '/.inkstudio/' + m.preview); else im.classList.add('blank');
    cell.appendChild(im); cell.appendChild(el('div', 'name', m.name));
    const del = el('div', 'b star', '×'); del.title = 'Delete this brush';
    del.onclick = async (ev) => {
      ev.stopPropagation();
      await play([{ _obj: 'delete', _target: [{ _ref: 'brush', _name: m.name }] }], 'Delete brush').catch(() => {});
      store.set('myBrushes', store.get('myBrushes', []).filter((x) => x.name !== m.name)); render();
    };
    cell.appendChild(del);
    cell.onclick = async () => {
      document.querySelectorAll('.cell.sel').forEach((c) => c.classList.remove('sel')); cell.classList.add('sel');
      try { await ps_.brush(m.name, m.tool || 'paintbrushTool'); currentBrush = { name: m.name, px: m.px, native: {} }; status(m.name); renderBrushPanel(); }
      catch (e) { status('Not in Photoshop any more: ' + m.name); }
    };
    grid.appendChild(cell);
  });
  list.appendChild(grid);
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
  // second row: tip type
  const row = el('div', 'tipRow'); row.appendChild(el('span', 'tipLab', 'Tip'));
  TIP_FILTERS.forEach(([id, label]) => {
    let cnt = 0; LIB.packs.forEach((p) => p.files.forEach((f) => (f.pen || []).forEach((x) => { if (x && x.tip === id) cnt++; })));
    if (!cnt) return;
    const b = el('div', 'b chip' + (tipF === id ? ' on' : ''), label);
    b.title = `${cnt} brushes`;
    b.onclick = () => { tipF = tipF === id ? null : id; if (tipF) LIB.packs.forEach((p) => { if (p.files.some((f) => (f.pen || []).some((x) => x && x.tip === tipF)) && LIB.packs.filter((q) => q.files.some((f) => (f.pen || []).some((x) => x && x.tip === tipF))).length <= 3) open.add(p.id); }); render(); };
    row.appendChild(b);
  });
  c.appendChild(row);
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
  const firstTip = (p.files.find((f) => f.tips && f.tips.length) || {}).tips;
  if (p.covers && p.covers[0]) lazyImg(thumb, LIB.root + '/.inkstudio/' + p.covers[0]);
  else if (firstTip) { lazyImg(thumb, LIB.root + '/.inkstudio/' + firstTip[0]); thumb.classList.add('tipCover'); }   // no Envato cover: the first brush
  else {   // computed brushes (Photoshop's own): the first painted stroke
    const st = (p.files.find((f) => f.strokes && f.strokes.some(Boolean)) || {}).strokes;
    if (st) { lazyImg(thumb, LIB.root + '/.inkstudio/' + st.find(Boolean)); thumb.classList.add('tipCover'); }
  }
  const meta = el('div', 'meta');
  meta.appendChild(el('div', 'title', p.name));
  meta.title = p.title;
  const sub = el('div', 'sub');
  sub.appendChild(el('span', 'maker', p.author || 'Unknown maker'));
  sub.appendChild(el('span', 'count', `${p.count} brushes`));
  meta.appendChild(sub);
  head.appendChild(thumb); head.appendChild(meta); head.appendChild(star('pack:' + p.id));
  head.onclick = () => { open.has(p.id) ? open.delete(p.id) : open.add(p.id); if (store.get('zoom', 0)) render(); else row.replaceWith(packRow(p)); };
  row.appendChild(head);
  if (open.has(p.id)) row.appendChild(packBody(p));
  return row;
}
function packBody(p) {
  const body = el('div', 'body');
  if (p.media.length) { const ml = el('div', 'mediaLine'); p.media.forEach((m) => ml.appendChild(el('span', 'medium', m))); body.appendChild(ml); }
  // Envato's own description, collapsed to a few lines until asked
  if (p.description) {
    const d = el('div', 'desc clamp', p.description.replace(/[*_#>]+/g, '').replace(/\n{2,}/g, '\n').trim());
    const more = el('div', 'b link', 'More');
    more.onclick = () => { const c = d.classList.toggle('clamp'); more.textContent = c ? 'More' : 'Less'; };
    body.appendChild(d); body.appendChild(more);
  }
  if (p.tags && p.tags.length) {
    const t = el('div', 'tags');
    p.tags.slice(0, 12).forEach((tg) => { const b = el('div', 'b tag', tg); b.onclick = () => { query = tg; $('#q').value = tg; tab = 'media'; media = null; setTab(); render(); }; t.appendChild(b); });
    body.appendChild(t);
  }
  p.files.forEach((f) => {
    if (tipF && !(f.pen || []).some((x) => x && x.tip === tipF)) return;
    if (p.files.length > 1) body.appendChild(el('div', 'file', f.file.split('/').pop().replace(/\.abr$/i, '')));
    const names = f.brushes.length ? f.brushes : f.tips.map((_, i) => `Brush ${i + 1}`);
    // tip images show a brush best (the user's call); painted strokes only where there is no tip (computed brushes:
    // Photoshop's own, bristle tips)
    const useStrokes = f.strokes && f.strokes.some(Boolean) && (!f.tips.length || p.author === 'Adobe');
    if (useStrokes) {
      // Procreate-style rows: a real stroke rendered by Photoshop with this brush, name underneath
      const list = el('div', 'strokes');
      const LIMIT = 48;   // big packs (up to 500 brushes): show a first page, the rest on request
      const shown = (showAll.has(p.id + f.file) || (tipF && tipF !== 'image')) ? names : names.slice(0, LIMIT);
      shown.forEach((b, i) => {
        if (tipF && tipOf(f, i) !== tipF) return;
        const row = el('div', 'srow');
        const im = el('img', 'stroke');
        if (f.strokes[i]) lazyImg(im, LIB.root + '/.inkstudio/' + f.strokes[i]);
        else if (f.tips[i]) { lazyImg(im, LIB.root + '/.inkstudio/' + f.tips[i]); im.classList.add('tipOnly'); }   // no painted preview yet: show the tip
        else im.classList.add('blank');
        row.appendChild(im);
        const line = el('div', 'sline'); line.appendChild(el('div', 'name', b));
        const tb = tipBadge(f, i); if (tb) line.appendChild(el('span', 'tipBadge', tb));
        line.appendChild(star(key(p, f, b)));
        row.appendChild(line);
        row.title = b;
        row.onclick = () => useBrush(p, f, b, row).catch(() => {});
        list.appendChild(row);
      });
      body.appendChild(list);
      if (shown.length < names.length) {
        const more = el('div', 'b link', `Show all ${names.length}`);
        more.onclick = () => { showAll.add(p.id + f.file); upTo(more, 'pack').replaceWith(packRow(p)); };
        body.appendChild(more);
      }
      return;
    }
    const grid = el('div', 'grid');
    const shownT = (showAll.has(p.id + f.file) || (tipF && tipF !== 'image')) ? names : names.slice(0, 60);
    shownT.forEach((b, i) => {
      if (tipF && tipOf(f, i) !== tipF) return;
      const cell = el('div', 'cell');
      const im = el('img', 'tip');
      const tip = f.tips[Math.min(i, f.tips.length - 1)];
      if (tip && i < f.tips.length) lazyImg(im, LIB.root + '/.inkstudio/' + tip); else im.classList.add('blank');
      cell.appendChild(im);
      cell.appendChild(el('div', 'name', b));
      { const tb = tipBadge(f, i); if (tb) cell.appendChild(el('span', 'tipBadge cellBadge', tb)); }
      cell.appendChild(star(key(p, f, b)));
      cell.title = b;
      cell.onclick = () => useBrush(p, f, b, cell).catch(() => {});
      grid.appendChild(cell);
    });
    body.appendChild(grid);
    if (shownT.length < names.length) {
      const more = el('div', 'b link', `Show all ${names.length}`);
      more.onclick = () => { showAll.add(p.id + f.file); upTo(more, 'pack').replaceWith(packRow(p)); };
      body.appendChild(more);
    }
  });
  return body;
}

/* which pack owns each brush name the panel loaded: keeps "1", "Pencil 1" etc. from picking another pack's brush */
let owner = store.get('owner', {});
const builtinNames = () => new Set((LIB ? LIB.packs : []).filter((x) => x.builtin).flatMap((x) => x.files.flatMap((f) => f.brushes)));
async function presetNames() {
  const r = await action.batchPlay([{ _obj: 'get', _target: [{ _property: 'presetManager' }, { _ref: 'application', _enum: 'ordinal', _value: 'targetEnum' }] }], {});
  const pm = r[0] && r[0].presetManager; const br = pm && pm.find((x) => x._obj === 'brushClass' || x._obj === 'brush') || (pm && pm[0]);
  return (br && br.name) || [];
}
async function loadPack(p, f, path) {
  const have = await presetNames();
  const mine = new Set(f.brushes.map((b) => b.replace(/\.(jpe?g|png|tiff?|bmp|psd)$/i, '')));
  // remove same-named presets that another pack loaded (they are reloaded on demand); never touch others
  for (const n of have) {
    if (mine.has(n) && owner[n] && owner[n] !== p.id && !builtinNames().has(n)) {
      await modal('Tidy brushes', () => action.batchPlay([{ _obj: 'delete', _target: [{ _ref: 'brush', _name: n }] }], {}));
    }
  }
  await ps_.loadAbr(path);
  mine.forEach((n) => { owner[n] = p.id; });
  store.set('owner', owner);
}

const TIP_BADGE = { bristle: 'Bristle', 'erodible/airbrush': 'Erodible' };
const tipBadge = (f, i) => { const pr = f.pen && f.pen[i]; return pr && TIP_BADGE[pr.tip]; };
async function useBrush(p, f, b, cell) {
  document.querySelectorAll('.cell.sel, .srow.sel').forEach((c) => c.classList.remove('sel'));
  cell && cell.classList.add('sel');
  const path = LIB.root + '/' + f.file;
  try {
    // select first; load the pack only if Photoshop doesn't have the brush (presets can be removed outside the panel)
    const names = [b, b.replace(/\.(jpe?g|png|tiff?|bmp|psd)$/i, '')];
    const trySelect = async () => { for (const n of names) { try { await ps_.brush(n); return true; } catch (e) {} } return false; };
    const clean = names[1];
    const ours = p.builtin || owner[clean] === p.id;
    if (!ours || !(await trySelect())) {
      if (p.builtin) throw new Error('not in Photoshop: ' + b);
      status(`Loading ${p.title}…`);
      await loadPack(p, f, path);
      if (!(await trySelect())) throw new Error('brush not found after loading: ' + b);
    }
    // Envato tips are huge (often 2000-5000 px); start at the size last used with this brush, else 120 px
    const sizes = store.get('sizes', {});
    const med = MEDIUM_FX[p.media.find((m) => MEDIUM_FX[m])] || {};
    const px = sizes[key(p, f, b)] || med.px || 120;
    await ps_.size(px);
    const native = await nativeOptions();   // the maker's settings, read before any switch touches them
    currentBrush = { name: b, px, native: { useTipDynamics: native.useTipDynamics, angleDynamics: native.angleDynamics, roundnessDynamics: native.roundnessDynamics, $szVr: native.$szVr, $opVr: native.$opVr, $prVr: native.$prVr, textureDepthDynamics: native.textureDepthDynamics } };
    stripUrl = null;
    loadPressure && loadPressure(key(p, f, b));   // this brush's switches (default: the maker's design)
    applyPressure && await applyPressure();
    const fx = Object.assign({ paper: false, wet: false, layer: false }, MEDIUM_FX[p.media.find((m) => MEDIUM_FX[m])] || {});
    if (native.useTexture) { fx.paper = false; fx.own = true; }       // maker's grain wins
    if (native.wetEdges) fx.wet = true;
    fx.tilt = !!(loadPressure ? loadPressure(key(p, f, b)) : {}).tilt;
    Object.assign(fx, store.get('fx', {})[key(p, f, b)] || {});
    setFx && await setFx(fx);
    lastBrushKey = key(p, f, b);
    activeTool = 'paintbrushTool';
    document.querySelectorAll('.tool').forEach((x) => x.classList.toggle('on', x.dataset.tool === 'paintbrushTool'));
    syncRail && syncRail();
    status(`${b}, ${px} px`);
    renderInspector(); renderBrushPanel(); writeCurveForRelay(curveFor(lastBrushKey));
    recent = [{ pack: p.id, file: f.file, brush: b }, ...recent.filter((r) => !(r.pack === p.id && r.brush === b))].slice(0, 40);
    store.set('recent', recent);
  } catch (e) { status('Could not select: ' + (e.message || e)); log('useBrush', b, e); throw e; }
}
function setTab() { document.querySelectorAll('#tabs .b').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab)); }


/* ---------- pen inspector: every way the current brush reacts to the pen, live from Photoshop, each switchable ---------- */
const CONTROL = { 1: 'Fade', 2: 'Pressure', 3: 'Tilt', 4: 'Stylus wheel', 5: 'Initial direction', 6: 'Direction', 7: 'Initial rotation', 8: 'Rotation' };   // stored values, not menu order (docs/brush-settings-reference.md)
const LINKS = [
  ['$szVr', 'size'], ['$opVr', 'opacity'], ['$prVr', 'flow'], ['angleDynamics', 'angle'], ['roundnessDynamics', 'roundness'],
  ['textureDepthDynamics', 'grain depth'], ['scatterDynamics', 'scatter'], ['countDynamics', 'dab count'], ['$clVr', 'colour'],
  ['$wtVr', 'wetness'], ['$mxVr', 'mix'],
];
const TIP = { sampledBrush: 'image tip', computedBrush: 'round tip', dBrush: 'bristle tip', dTips: 'erodible / airbrush tip' };
let inspOpen = store.get('inspOpen', false);
function penProfile(o) {
  const rows = [];   // {control, what, key, on}
  LINKS.forEach(([k0, label]) => {
    const k = [k0, '$' + k0, k0.replace(/^\$/, '')].find((x) => o[x] && typeof o[x] === 'object');
    if (!k) return; const v = o[k];
    if (v.$bVTy) rows.push({ control: CONTROL[v.$bVTy] || ('control ' + v.$bVTy), what: label, key: k, on: true, min: v.minimum && v.minimum._value });
    const j = v.jitter && v.jitter._value; if (j > 0) rows.push({ control: 'Random', what: label + ' ' + Math.round(j) + '%', key: k, jitter: true, on: true });
  });
  const hidden = [];
  const b = o.brush || {};
  if (b._obj === 'dBrush') hidden.push('Bristle physics: pressure and tilt press the bristles down, so strokes get denser, wider and darker. No setting controls this; "Pen pressure: none" fixes it at one value.');
  if (b._obj === 'dTips') hidden.push('Erodible / airbrush tip: wears down or sprays with pressure and tilt.');
  if (o.useBrushPose) hidden.push('Brush pose is on: it can replace the pen\'s real tilt, rotation or pressure with fixed values.');
  if (o.usePressureOverridesSize) hidden.push('Pressure for size override (top bar) is on.');
  if (o.usePressureOverridesOpacity) hidden.push('Pressure for opacity override (top bar) is on.');
  if (o.useTexture) hidden.push('Paper grain: ' + ((o.texture && o.texture.name) || 'texture') + ', ' + ((o.textureBlendMode && o.textureBlendMode._value) || '') + ', depth ' + ((o.textureDepth && Math.round(o.textureDepth._value)) || 0) + '%.');
  if (o.dualBrush && o.dualBrush.useDualBrush) hidden.push('Dual brush: a second tip cuts into this one.');
  if (o.useColorDynamics) hidden.push('Colour dynamics: hue, saturation or brightness vary while you paint.');
  if (o.wetEdges) hidden.push('Wet edges: pigment pools at the stroke edge, the middle stays lighter.');
  if (o.repeat) hidden.push('Build-up: paint keeps flowing while the pen rests.');
  if (o.noise) hidden.push('Noise on soft edges.');
  if (o.flow != null && o.flow < 100) hidden.push('Flow ' + o.flow + '%: strokes are see-through and build up where they overlap.');
  if (o.opacity != null && o.opacity < 100) hidden.push('Opacity ' + o.opacity + '%.');
  if (o.mode && o.mode._value && o.mode._value !== 'normal') hidden.push('Blend mode ' + o.mode._value + '.');
  if (o.minimumDiameter && o.minimumDiameter._value > 0 && o.$szVr && o.$szVr.$bVTy) hidden.push('Never thinner than ' + Math.round(o.minimumDiameter._value) + '% of the size.');
  if (o.tiltScale && o.tiltScale._value && o.angleDynamics && o.angleDynamics.$bVTy === 3) hidden.push('Tilt scale ' + Math.round(o.tiltScale._value) + '%.');
  return { rows, hidden, tip: TIP[b._obj] || b._obj, name: b.name };
}
async function renderInspector() {
  const body = $('#inspBody'); if (!body) return;
  $('#inspHead .caret').textContent = inspOpen ? '▾' : '▸';
  body.classList.toggle('hidden', !inspOpen);
  $('#inspName').textContent = currentBrush ? currentBrush.name : '';
  if (!inspOpen) return;
  let o; try { o = await nativeOptions(); } catch (e) { return; }
  const pr = penProfile(o);
  body.innerHTML = '';
  body.appendChild(el('div', 'inspTip', pr.tip + (pr.name ? ', ' + pr.name : '')));
  if (bpHelp && TIP_HELP[(o.brush || {})._obj]) body.appendChild(helpLine(TIP_HELP[(o.brush || {})._obj]));
  const groups = {};
  pr.rows.forEach((r) => (groups[r.control] = groups[r.control] || []).push(r));
  if (!pr.rows.length) body.appendChild(el('div', 'inspNone', 'Nothing on this brush follows the pen.'));
  Object.keys(groups).forEach((g) => {
    body.appendChild(el('div', 'inspGroup', g));
    if (bpHelp && CONTROL_HELP[g]) body.appendChild(helpLine(CONTROL_HELP[g]));
    groups[g].forEach((r) => {
      const row = el('div', 'inspRow');
      row.appendChild(el('span', 'inspWhat', r.what + (r.min ? '  (min ' + Math.round(r.min) + '%)' : '')));
      const sw = el('div', 'b inspSw on', 'on');
      sw.title = r.jitter ? 'Switch off this randomness' : 'Switch off this pen link';
      sw.onclick = async () => {
        const v = Object.assign({}, o[r.key]);
        if (r.jitter) v.jitter = { _unit: 'percentUnit', _value: 0 }; else v.$bVTy = 0;
        await ps_.toolOpts({ [r.key]: v }, 'Pen link').catch((e) => log('insp', e));
        renderInspector();
      };
      row.appendChild(sw); body.appendChild(row);
    });
  });
  if (pr.hidden.length) { body.appendChild(el('div', 'inspGroup', 'Built in')); pr.hidden.forEach((t) => body.appendChild(el('div', 'inspNote', t))); }
  // one lever for everything pressure does, including bristle physics: Brush Pose with a fixed pressure
  const fixed = o.useBrushPose && o.overridePosePressure;
  const lv = el('div', 'b inspLever' + (fixed ? ' on' : ''), fixed ? 'Pen pressure: fixed (tap to use the pen again)' : 'Pen pressure: none (fix it at one value)');
  lv.onclick = async () => {
    const patch = fixed ? { overridePosePressure: false } : { useBrushPose: true, overridePosePressure: true, brushPosePressure: { _unit: 'percentUnit', _value: 60 } };
    await ps_.toolOpts(patch, 'Pressure').catch((e) => log('lever', e));
    renderInspector();
  };
  body.appendChild(lv);
}



const pct = (v) => (v && typeof v === 'object' ? v._value : v);
const P = (x) => ({ _unit: 'percentUnit', _value: x });

/* test strip: paint a light-heavy-light pressure stroke with the current brush in a scratch document, show it here */
let stripUrl = null;
async function renderStrip() {
  try {
    const imaging = require('photoshop').imaging;
    stripUrl = await core.executeAsModal(async () => {
      const keep = app.activeDocument;
      const W = 1200, H = 300;
      await action.batchPlay([{ _obj: 'make', new: { _obj: 'document', name: 'inkstudio-strip', width: { _unit: 'pixelsUnit', _value: W }, height: { _unit: 'pixelsUnit', _value: H }, resolution: { _unit: 'densityUnit', _value: 72 }, mode: { _class: 'RGBColorMode' }, fill: { _enum: 'fill', _value: 'white' } } }], {});
      const pts = []; for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push([W * (0.06 + 0.88 * t), H * (0.5 + 0.28 * Math.sin(t * Math.PI * 2))]); }
      await action.batchPlay([{ _obj: 'set', _target: [{ _ref: 'path', _property: 'workPath' }], to: { _obj: 'pathClass', pathComponents: [{ _obj: 'pathComponent', shapeOperation: { _enum: 'shapeOperation', _value: 'add' }, subpathListKey: [{ _obj: 'subpathsList', closedSubpath: false, points: pts.map(([x, y]) => ({ _obj: 'pathPoint', anchor: { _obj: 'paint', horizontal: { _unit: 'pixelsUnit', _value: x }, vertical: { _unit: 'pixelsUnit', _value: y } } })) }] }] } }], {});
      const tool = activeTool === 'wetBrushTool' ? 'wetBrushTool' : 'paintbrushTool';
      await action.batchPlay([{ _obj: 'stroke', _target: [{ _ref: 'path', _property: 'workPath' }], using: { _class: tool }, pressure: true }], {});
      const doc = app.activeDocument;
      const px = await imaging.getPixels({ documentID: doc.id, targetSize: { width: 600 } });
      const b64 = await imaging.encodeImageData({ imageData: px.imageData, base64: true, quality: 95 });
      px.imageData.dispose();
      await doc.closeWithoutSaving();
      if (keep) app.activeDocument = keep;
      return 'data:image/jpeg;base64,' + b64;
    }, { commandName: 'Test strip' });
  } catch (e) { log('strip', e); status('Test strip failed: ' + (e.message || e)); }
  renderBrushPanel();
}

const impastoSettings = () => Object.assign({ stylization: 4, cleanliness: 6, brushScale: 1, microBrush: 2, lightingOn: true, lightDirection: -60, specularity: 1.3, opacity: 100, blend: 'softLight' }, store.get('impasto', {}));
/* feel presets: tested combinations so nobody has to hand-tune minimums and jitter */
const D = (c, min = 0, jit = 0) => ({ _obj: '$brVr', $bVTy: c, $fStp: 25, jitter: P(jit), minimum: P(min) });
const FEELS = [
  ['original', "Maker's original", null],
  ['pencil', 'Pencil (side shading)', { useTipDynamics: true, usePaintDynamics: true, $szVr: D(2, 40), $opVr: D(2, 15), $prVr: D(2, 30), angleDynamics: D(3), roundnessDynamics: D(3, 25), minimumRoundness: P(25), tiltScale: P(150) }],
  ['fineliner', 'Fineliner', { useTipDynamics: true, usePaintDynamics: true, $szVr: D(2, 80), $opVr: D(0), $prVr: D(0), angleDynamics: D(0), roundnessDynamics: D(0) }],
  ['brushpen', 'Brush pen', { useTipDynamics: true, usePaintDynamics: true, $szVr: D(2, 5), $opVr: D(0), $prVr: D(2, 70), angleDynamics: D(6), roundnessDynamics: D(2, 60) }],
  ['chisel', 'Chisel marker', { useTipDynamics: true, usePaintDynamics: true, $szVr: D(0), $opVr: D(0), $prVr: D(0), angleDynamics: D(0), roundnessDynamics: D(0), brushAngle: 45, brushRoundness: 30, mode: { _enum: 'blendMode', _value: 'multiply' } }],
  ['calligraphy', 'Calligraphy', { useTipDynamics: true, usePaintDynamics: true, $szVr: D(2, 50), $opVr: D(0), $prVr: D(0), angleDynamics: D(0), roundnessDynamics: D(0), brushAngle: 30, brushRoundness: 20 }],
  ['charcoal', 'Charcoal / pastel', { useTipDynamics: true, usePaintDynamics: true, $szVr: D(2, 50, 10), $opVr: D(2, 10), $prVr: D(2, 20), angleDynamics: D(3, 0, 5), roundnessDynamics: D(3, 30), minimumRoundness: P(30) }],
  ['airbrush', 'Airbrush', { useTipDynamics: true, usePaintDynamics: true, $szVr: D(0), $opVr: D(2, 0), $prVr: D(2, 0), angleDynamics: D(0), roundnessDynamics: D(0), repeat: true }],
];

/* your own feels: snapshot of the current brush's pen behaviour, applicable to any brush */
const FEEL_KEYS = ['$szVr', '$opVr', '$prVr', 'angleDynamics', 'roundnessDynamics', 'textureDepthDynamics', 'scatterDynamics', 'countDynamics',
  'minimumDiameter', 'minimumRoundness', 'tiltScale', 'brushProjection', 'useTipDynamics', 'usePaintDynamics'];
async function saveFeel(name) {
  const o = await nativeOptions(); const snap = {};
  FEEL_KEYS.forEach((k) => { if (k in o) snap[k] = o[k]; });
  if (o.brush) { if (o.brush.angle) snap.brushAngle = o.brush.angle._value; if (o.brush.roundness) snap.brushRoundness = o.brush.roundness._value; }
  const mine = store.get('myFeels', {}); const id = 'my:' + Date.now(); mine[id] = { name, patch: snap }; store.set('myFeels', mine);
  if (lastBrushKey) { const m = store.get('feel', {}); m[lastBrushKey] = id; store.set('feel', m); }
  status('Saved feel "' + name + '"'); renderBrushPanel();
}
function deleteFeel(id) { const mine = store.get('myFeels', {}); delete mine[id]; store.set('myFeels', mine); renderBrushPanel(); }
async function saveBrushToPhotoshop(name) {
  // Photoshop's "New Brush Preset" from the current tool settings
  await play([{ _obj: 'make', _target: [{ _ref: 'brush' }], name, using: { _ref: [{ _ref: 'property', _property: 'currentToolOptions' }, { _ref: 'application', _enum: 'ordinal', _value: 'targetEnum' }] } }], 'Save brush')
    .then(() => {
      // remember it for the Mine tab, with the preview of the brush it came from
      const src = recent[0] && LIB && LIB.packs.find((x) => x.id === recent[0].pack);
      const sf = src && src.files.find((x) => x.file === recent[0].file);
      const i = sf ? sf.brushes.indexOf(recent[0].brush) : -1;
      const preview = sf && i >= 0 ? ((sf.tips && sf.tips[i]) || (sf.strokes && sf.strokes[i])) : null;
      const list = store.get('myBrushes', []).filter((x) => x.name !== name);
      list.push({ name, preview, tool: activeTool, px: currentBrush && currentBrush.px, from: recent[0] || null });
      store.set('myBrushes', list);
      status('Saved "' + name + '": find it under Mine');
      if (tab === 'mine') render();
    })
    .catch((e) => status('Could not save the brush: ' + (e.message || e)));
}

async function applyFeel(id) {
  const mine = store.get('myFeels', {});
  const f = FEELS.find((x) => x[0] === id) || (mine[id] && [id, mine[id].name, mine[id].patch]); if (!f) return;
  if (id === 'original') {   // back to the brush exactly as designed: re-select the preset, keep size
    if (currentBrush) { await ps_.brush(currentBrush.name, await currentTool()).catch(() => {}); await ps_.size(currentBrush.px); }
  } else {
    const r = Object.assign({}, f[2]);
    const o = await nativeOptions(); const tip = Object.assign({}, o.brush || {});
    if ('brushAngle' in r) { tip.angle = { _unit: 'angleUnit', _value: r.brushAngle }; delete r.brushAngle; }
    if ('brushRoundness' in r) { tip.roundness = P(r.brushRoundness); delete r.brushRoundness; }
    if (tip.angle || tip.roundness) r.brush = tip;
    Object.keys(r).forEach((k) => {
      if (!(k in o) && k[0] === '$') { delete r[k]; return; }
      // keep the maker's randomness (it is part of the brush's character) unless the preset sets its own
      const v = r[k]; const nv = o[k];
      if (v && v._obj === '$brVr' && nv && nv.jitter && !(v.jitter && v.jitter._value)) r[k] = Object.assign({}, v, { jitter: nv.jitter });
    });
    await ps_.toolOpts(r, 'Feel: ' + f[1]).catch((e) => log('feel', e));
  }
  if (lastBrushKey) { const m = store.get('feel', {}); m[lastBrushKey] = id; store.set('feel', m); }
  renderBrushPanel();
}


/* plain-language help: what each tip type, pen input and setting means, and how to tune it */
const TIP_HELP = {
  sampledBrush: 'Image tip: a picture of a mark (charcoal grain, a bristle smear, a splatter) stamped along the stroke. Its look comes from the picture. Tune spacing for smoother or dottier strokes, angle and roundness to turn or squash it, and the pen controls for how it reacts.',
  computedBrush: 'Round tip: a simple mathematical circle, hard or soft. Clean and predictable. Hardness sets how soft the edge is; everything else comes from the pen controls.',
  dBrush: 'Bristle tip: Photoshop simulates individual bristles with physics. Pressing harder pushes more bristles onto the paper (wider, denser, darker) even with every pen control off. Tune bristles (count), length, thickness and stiffness; stiff short bristles give crisp strokes, soft long ones streaky paint. To stop pressure acting, use Brush pose and fix pressure.',
  dTips: 'Erodible or airbrush tip: an erodible tip is a pencil or chalk point that wears flat as you draw (Sharpen in Photoshop restores it); pressure widens it. An airbrush tip sprays: light pressure spreads widest. Tune softness and shape (erodible) or granularity, splatter size and count (airbrush).',
};
const CONTROL_HELP = {
  'Off': 'Not linked to the pen. Random and min still apply.',
  'Pressure': 'How hard you press. Light touch gives the min value, full pressure 100%.',
  'Tilt': 'How far the pen leans. Upright gives the min value, flat gives 100%. Needs a pen that sends tilt.',
  'Direction': 'The way the stroke is moving right now, so a flat tip follows your curves like a calligraphy nib.',
  'Initial direction': 'The direction the stroke started in, then kept: the tip stays at that angle for the whole stroke.',
  'Rotation': 'Turning the pen around its own axis (only pens with barrel rotation, like Wacom Art Pen).',
  'Initial rotation': 'The pen rotation at the start of the stroke, kept for the whole stroke.',
  'Fade': 'Goes from full to the min value over a number of dabs, like ink running out.',
  'Stylus wheel': 'The finger wheel on a Wacom airbrush pen.',
  'Random': 'Changes each dab by a random amount, which makes the stroke look hand-made rather than digital.',
};
const ASPECT_HELP = {
  'Size': 'Line width. Min sets the thinnest it gets (for example 30% = never thinner than a third).',
  'Opacity': 'How dark each stroke can get. Overlapping strokes do not build past it.',
  'Flow': 'How much paint each dab lays down. Low flow builds up where strokes overlap, like real graphite or watercolour.',
  'Angle': 'Which way the tip points. Matters for flat or shaped tips (chisel, nib, flat brush).',
  'Roundness': 'How squashed the tip is: 100% round, low = a flat sliver. Min sets the flattest.',
  'Grain depth': 'How much the paper grain shows. Light pressure usually shows more tooth, like a real pencil.',
  'Scatter': 'How far dabs jump off the line, for spray, foliage and texture.',
  'Dab count': 'How many dabs per step. More = denser, darker strokes.',
  'Colour': 'Mixes between foreground and background colour, for colour that varies within a stroke.',
};

const FIELD_HELP = {
  'Tool': 'Which Photoshop tool paints. Some brushes switch it (blenders use Smudge, Real Oils the Mixer Brush).',
  'Opacity %': 'Ceiling for how dark a single stroke gets. Overlapping strokes do not go past it while you keep the pen down.',
  'Flow %': 'Paint per dab. Below 100% strokes are see-through and build up where they overlap, like graphite or watercolour.',
  'Mode': 'How paint mixes with what is underneath. Multiply darkens like marker or glaze; Normal covers.',
  'Build-up (airbrush)': 'Paint keeps flowing while the pen rests in one spot, like an airbrush.',
  'Wet edges': 'Pigment collects at the edge of the stroke and the middle stays lighter, like watercolour drying.',
  'Noise': 'Adds grain to soft brush edges. Mostly for soft round brushes.',
  'Texture': 'Paper grain inside the stroke. Depth, scale and mode below tune it.',
  'Protect texture': 'Keeps the same paper grain when you switch between textured brushes, so the paper stays consistent.',
  'Scatter': 'Dabs jump off the line (spray, foliage, splatter). Amount and count are in Pen controls.',
  'Colour dynamics': 'Colour varies while you paint (hue, saturation, brightness, foreground/background mix).',
  'Shape dynamics': 'Master switch for size, angle and roundness reacting to the pen. Off = those pen controls do nothing.',
  'Transfer': 'Master switch for opacity and flow reacting to the pen. Off = those pen controls do nothing.',
  'Dual brush': 'A second tip cuts holes into the first, for broken, textured edges (charcoal, dry brush).',
  'Grain depth %': 'How strongly the paper grain shows. 0 = smooth, 100 = only the raised paper gets paint.',
  'Grain scale %': 'Size of the paper grain. Bigger = coarser paper.',
  'Grain mode': 'How the grain cuts into paint. Subtract and Height read as graphite on tooth; Multiply is rougher.',
  'Strength %': 'Smudge: how far the paint is dragged. 100% drags the colour along the whole stroke.',
  'Finger painting': 'Smudge: each stroke starts with the foreground colour mixed in, like a finger dipped in paint. Option while dragging toggles it.',
  'Sample all layers': 'Pick up and blend paint from every visible layer, so you can blend on a new, empty layer and keep the paint underneath safe.',
  'Clean after each stroke': 'Mixer: the brush is wiped clean after every stroke, so each stroke starts fresh.',
  'Load after each stroke': 'Mixer: the brush is refilled with the foreground colour after every stroke. Off = it carries the mixed, dirty paint on, like a real brush.',
  'Load solid colours only': 'Mixer: the brush loads one flat colour instead of the varied colour under it.',
  'Smoothing %': 'Steadies the line by lagging behind the pen. Higher = smoother curves, slower response (Procreate StreamLine).',
  'Wetness %': 'Mixer Brush: how much paint it picks up from the canvas. High = blends more.',
  'Load %': 'Mixer Brush: how much paint is on the brush. Low runs out along the stroke.',
  'Mix %': 'Mixer Brush: canvas paint versus brush paint. High = mostly canvas colour.',
  'Smallest size %': 'The thinnest the line gets when pressure or tilt drives size.',
  'Flattest roundness %': 'The most squashed the tip gets when roundness follows the pen.',
  'Tilt scale %': 'How much tilt grows the tip when size follows tilt.',
  'Brush projection (tilt shapes the tip)': 'Tilt and rotation reshape the tip directly, like a real brush lying down. Needs a pen that sends tilt.',
  'Top-bar pressure for size': 'Photoshop button that forces pressure on size for every brush, overriding the brush.',
  'Top-bar pressure for opacity': 'Photoshop button that forces pressure on opacity for every brush, overriding the brush.',
  'Brush pose': 'Master switch for the overrides below.',
  'Override Tilt X': 'Pretend the pen leans left/right by this amount.', 'Override Tilt Y': 'Pretend the pen leans forward/back by this amount.',
  'Override Rotation': 'Pretend the pen is turned by this angle.', 'Override Pressure': 'Use this pressure instead of the real one: the brush behaves the same however hard you press.',
  'Bend (soft − / hard +)': 'Minus = light touches already give a lot (soft pen). Plus = you have to press harder (firm pen).',
  'Pen starts at %': 'Pressure below this counts as nothing: ignores feather-light touches.',
  'Full at %': 'Pressure above this already counts as full: less effort for full strokes.',
  'Lightest output %': 'The least pressure Photoshop ever sees while drawing.', 'Strongest output %': 'The most pressure Photoshop ever sees.',
};
const TIP_FIELDS = {   // readable names for tip values
  diameter: ['Size', 'Tip size in pixels.'], angle: ['Angle', 'Which way the tip points.'], roundness: ['Roundness', '100% round, lower = flatter.'],
  hardness: ['Hardness', 'Edge softness of a round tip.'], spacing: ['Spacing', 'Gap between dabs as % of size. Low = smooth line, high = separate stamps.'],
  density: ['Bristles', 'How many bristles, as density.'], length: ['Length', 'Bristle length. Long = floppy, streaky.'],
  thickness: ['Thickness', 'Thickness of each bristle.'], stiffness: ['Stiffness', 'Stiff bristles keep their shape; soft ones splay out.'],
  clumping: ['Clumping', 'How much bristles stick together in clumps.'], shape: ['Shape', 'Bristle tip shape (round, flat, fan...).'],
  physics: ['Physics', 'Bristles bend under pressure and tilt.'],
};
const TOOL_NAMES = { paintbrushTool: 'Brush', wetBrushTool: 'Mixer Brush', smudgeTool: 'Smudge', eraserTool: 'Eraser', pencilTool: 'Pencil' };
let bpHelp = store.get('bpHelp', true);
const helpLine = (t) => el('div', 'bpHelpTxt', t);

/* ---------- Brush panel: every brush setting the pen can touch, editable ---------- */
const ASPECTS = [   // [label, key candidates, switch that must be on for it to work]
  ['Size', ['$szVr'], 'useTipDynamics'], ['Opacity', ['$opVr'], 'usePaintDynamics'], ['Flow', ['$prVr'], 'usePaintDynamics'],
  ['Angle', ['angleDynamics'], 'useTipDynamics'], ['Roundness', ['roundnessDynamics'], 'useTipDynamics'],
  ['Grain depth', ['textureDepthDynamics'], 'useTexture'], ['Scatter', ['scatterDynamics', '$scatterDynamics'], 'useScatter'],
  ['Dab count', ['countDynamics', '$countDynamics'], 'useScatter'], ['Colour', ['$clVr', 'clVr'], 'useColorDynamics'],
];
const CONTROLS = [[0, 'Off'], [2, 'Pressure'], [3, 'Tilt'], [6, 'Direction'], [5, 'Initial direction'], [8, 'Rotation'], [7, 'Initial rotation'], [1, 'Fade'], [4, 'Stylus wheel']];
let bpAll = store.get('bpAll', false);
let bpOpen = store.get('bpOpen', { pen: true, curve: true, tip: false, pose: false, paint: false });
function section(id, title, build) {
  const wrap = el('div', 'bpSec');
  const head = el('div', 'bpSecHead'); head.appendChild(el('span', 'caret', bpOpen[id] ? '▾' : '▸')); head.appendChild(el('span', '', title));
  head.onclick = () => { bpOpen[id] = !bpOpen[id]; store.set('bpOpen', bpOpen); renderBrushPanel(); };
  wrap.appendChild(head);
  if (bpOpen[id]) { const body = el('div', 'bpSecBody'); try { build(body); } catch (e) { log('section ' + id, e); body.appendChild(el('div', 'bpNote', 'Could not show this section: ' + e.message)); } wrap.appendChild(body); }
  return wrap;
}
function num(value, onSet, opts = {}) {
  const i = document.createElement('input'); i.type = 'number'; i.className = 'bpNum'; i.value = value == null ? '' : Math.round(value * 100) / 100;
  if (opts.min != null) i.min = opts.min; if (opts.max != null) i.max = opts.max; i.title = opts.title || '';
  i.addEventListener('change', () => onSet(parseFloat(i.value)));
  return i;
}
function sel(options, value, onSet) {
  const s = document.createElement('select'); s.className = 'bpSel';
  options.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v == value) o.selected = true; s.appendChild(o); });
  s.addEventListener('change', () => onSet(s.value));
  return s;
}
function tog(on, onSet, label) {
  const t = el('div', 'b bpTog' + (on ? ' on' : ''), label || (on ? 'on' : 'off'));
  t.onclick = () => onSet(!on);
  return t;
}
async function setOpt(patch, name) { try { await ps_.toolOpts(patch, name || 'Brush setting'); } catch (e) { log('bp', e); status('Photoshop refused: ' + (e.message || e)); } renderBrushPanel(); }
async function renderBrushPanel() {
  const body = $('#bpBody'); if (!body) return;
  let o; try { o = await nativeOptions(); } catch (e) { return; }
  const b = o.brush || {};
  $('#bpName').textContent = (currentBrush && currentBrush.name) || b.name || 'Current brush';
  body.innerHTML = '';
  // 1. pen -> brush matrix
  body.appendChild(section('pen', 'Pen controls', (sec) => {
    const cur = (store.get('feel', {})[lastBrushKey]) || 'original';
    const mine = store.get('myFeels', {});
    const opts = FEELS.map((f) => [f[0], f[1]]).concat(Object.keys(mine).map((id) => [id, '★ ' + mine[id].name]));
    sec.appendChild(kv('Feel', sel(opts, cur, (x) => applyFeel(x).then(renderStrip))));
    const row = el('div', 'bpKV');
    const nameIn = document.createElement('input'); nameIn.type = 'text'; nameIn.className = 'bpName'; nameIn.placeholder = 'Name for this feel';
    const sv = el('div', 'b bpTog', 'Save feel'); sv.onclick = () => { const n = (nameIn.value || '').trim(); if (n) saveFeel(n); else nameIn.focus(); };
    row.appendChild(nameIn); row.appendChild(sv); sec.appendChild(row);
    if (mine[cur]) { const del = el('div', 'b bpReset', 'Delete "' + mine[cur].name + '"'); del.onclick = () => deleteFeel(cur); sec.appendChild(del); }
    const sb = el('div', 'b bpReset', 'Save brush to Photoshop'); sb.title = 'Adds the brush with all its current settings to Photoshop\'s Brushes panel';
    sb.onclick = () => { const n = (nameIn.value || '').trim() || ((currentBrush && currentBrush.name) || 'Brush') + ' (mine)'; saveBrushToPhotoshop(n); };
    sec.appendChild(sb);
    const tb = el('div', 'b bpReset', stripUrl ? 'Test stroke again' : 'Test stroke (light, heavy, light)'); tb.onclick = () => renderStrip(); sec.appendChild(tb);
    if (stripUrl) { const im = el('img', 'strip'); im.src = stripUrl; sec.appendChild(im); }
    if (bpHelp) sec.appendChild(helpLine('Each row is one thing about the stroke. Driven by: which pen input changes it. Random: extra variation per dab. Min: the value at the lightest touch (or most upright pen).'));
    const hdr = el('div', 'bpRow bpHdr'); ['', 'driven by', 'random', 'min'].forEach((t) => hdr.appendChild(el('span', 'bpCell', t))); sec.appendChild(hdr);
    const used = (keys, sw) => { const k = keys.find((x) => o[x] && typeof o[x] === 'object'); const v = k && o[k]; return v && o[sw] !== false && (v.$bVTy || pct(v.jitter) > 0); };
    const extra = store.get('bpExtra', []);
    const hidden = [];
    ASPECTS.forEach(([label, keys, sw]) => {
      if (!used(keys, sw) && !extra.includes(label)) { hidden.push(label); return; }   // only what this brush uses
      const k = keys.find((x) => o[x] && typeof o[x] === 'object') || keys[0];
      const v = o[k] || { _obj: '$brVr', $bVTy: 0, $fStp: 25, jitter: P(0), minimum: P(0) };
      const active = o[sw] !== false;
      const row = el('div', 'bpRow' + (active ? '' : ' dim'));
      const lab = el('span', 'bpCell bpLabel', label); lab.title = ASPECT_HELP[label] || ''; row.appendChild(lab);
      const write = (chg) => setOpt(Object.assign({ [k]: Object.assign({ _obj: '$brVr', $bVTy: 0, $fStp: 25, jitter: P(0), minimum: P(0) }, v, chg) }, { [sw]: true }), label);
      row.appendChild(sel(CONTROLS, v.$bVTy || 0, (c) => write({ $bVTy: +c })));
      row.appendChild(num(pct(v.jitter), (x) => write({ jitter: P(Math.max(0, Math.min(100, x))) }), { min: 0, max: 100, title: 'Random amount %' }));
      row.appendChild(num(pct(v.minimum), (x) => write({ minimum: P(Math.max(0, Math.min(100, x))) }), { min: 0, max: 100, title: 'Lowest value at the lightest pressure / tilt %' }));
      sec.appendChild(row);
      if (bpHelp) { const cn = (CONTROLS.find((c) => c[0] === (v.$bVTy || 0)) || [0, 'Off'])[1]; sec.appendChild(helpLine(ASPECT_HELP[label] + ' ' + cn + ': ' + CONTROL_HELP[cn])); }
    });
    if (!sec.querySelector('.bpRow:not(.bpHdr)')) sec.appendChild(el('div', 'bpNote', 'Nothing on this brush follows the pen.'));
    if (hidden.length) sec.appendChild(kv('Add pen link', sel([['', 'choose…']].concat(hidden.map((h) => [h, h])), '', (x) => { if (x) { store.set('bpExtra', extra.concat([x])); renderBrushPanel(); } })));
    if (!bpAll) { if (sec.querySelector('.bpRow:not(.bpHdr)') && o.minimumDiameter && o.$szVr && o.$szVr.$bVTy) sec.appendChild(kv('Smallest size %', num(pct(o.minimumDiameter), (x) => setOpt({ minimumDiameter: P(x) })))); return; }
    if (o.minimumDiameter) sec.appendChild(kv('Smallest size %', num(pct(o.minimumDiameter), (x) => setOpt({ minimumDiameter: P(x) }))));
    if (o.minimumRoundness) sec.appendChild(kv('Flattest roundness %', num(pct(o.minimumRoundness), (x) => setOpt({ minimumRoundness: P(x) }))));
    if (o.tiltScale) sec.appendChild(kv('Tilt scale %', num(pct(o.tiltScale), (x) => setOpt({ tiltScale: P(x) }))));
    if ('brushProjection' in o) sec.appendChild(kv('Brush projection (tilt shapes the tip)', tog(o.brushProjection, (x) => setOpt({ brushProjection: x }))));
    sec.appendChild(kv('Top-bar pressure for size', tog(o.usePressureOverridesSize, (x) => setOpt({ usePressureOverridesSize: x }))));
    sec.appendChild(kv('Top-bar pressure for opacity', tog(o.usePressureOverridesOpacity, (x) => setOpt({ usePressureOverridesOpacity: x }))));
  }));
  // 2. pressure curve (applied by the pen relay before Photoshop sees the pressure; per brush)
  body.appendChild(section('curve', 'Pressure curve', (sec) => buildCurve(sec)));
  // 3. tip
  if (bpOpen.tip === undefined || bpOpen._for !== b._obj) { bpOpen.tip = b._obj === 'dBrush' || b._obj === 'dTips'; bpOpen._for = b._obj; }
  if (o.useBrushPose) bpOpen.pose = true;
  body.appendChild(section('tip', 'Tip: ' + (TIP[b._obj] || b._obj || ''), (sec) => {
    if (bpHelp && TIP_HELP[b._obj]) sec.appendChild(helpLine(TIP_HELP[b._obj]));
    const skip = new Set(['_obj', 'name', 'sampledData', 'interfaceIconFrameDimmed', 'flipX', 'flipY']);
    Object.keys(b).filter((k) => !skip.has(k)).forEach((k) => {
      const v = b[k];
      const put = (val) => setOpt({ brush: Object.assign({}, b, { [k]: val }) }, 'Tip');
      const [nm, hp] = TIP_FIELDS[k] || [k.replace(/^dtips/, '').replace(/([A-Z])/g, ' $1').trim().replace(/^./, (c) => c.toUpperCase()), ''];
      if (typeof v === 'boolean') sec.appendChild(kv(nm, tog(v, (x) => put(x)), hp));
      else if (typeof v === 'number') sec.appendChild(kv(nm, num(v, (x) => put(x)), hp));
      else if (v && typeof v === 'object' && '_value' in v) {
        const frac = v._unit === 'percentUnit' && b._obj === 'dBrush' && Math.abs(v._value) <= 1.5;   // bristle values are stored as fractions
        sec.appendChild(kv(nm + (v._unit === 'pixelsUnit' ? ' px' : v._unit === 'angleUnit' ? ' °' : ' %'),
          num(frac ? v._value * 100 : v._value, (x) => put({ _unit: v._unit, _value: frac ? x / 100 : x })), hp));
      }
    });
    if (b._obj === 'dBrush') sec.appendChild(el('div', 'bpNote', 'Bristle tips react to pressure and tilt through their physics: more pressure presses more bristles onto the paper. Use the pose pressure override to fix it.'));
  }));
  // 4. brush pose
  body.appendChild(section('pose', 'Brush pose (override the pen)', (sec) => {
    if (bpHelp) sec.appendChild(helpLine('Brush pose replaces what the pen reports with fixed values. Override pressure to make a brush behave the same however hard you press (the only way to calm bristle tips); override tilt or rotation to fake a pen angle.'));
    sec.appendChild(kv('Brush pose', tog(o.useBrushPose, (x) => setOpt({ useBrushPose: x }))));
    [['Tilt X', 'overridePoseTiltX', 'brushPoseTiltX'], ['Tilt Y', 'overridePoseTiltY', 'brushPoseTiltY'], ['Rotation', 'overridePoseAngle', 'brushPoseAngle'], ['Pressure', 'overridePosePressure', 'brushPosePressure']].forEach(([lab, ov, val]) => {
      const row = el('div', 'bpKV'); row.appendChild(el('span', 'bpKey', 'Override ' + lab));
      row.appendChild(tog(!!o[ov], (x) => setOpt({ useBrushPose: true, [ov]: x })));
      row.appendChild(num(pct(o[val]), (x) => setOpt({ useBrushPose: true, [val]: (o[val] && o[val]._unit) ? { _unit: o[val]._unit, _value: x } : (lab === 'Pressure' ? P(x) : x) })));
      sec.appendChild(row); if (bpHelp && FIELD_HELP['Override ' + lab]) sec.appendChild(helpLine(FIELD_HELP['Override ' + lab]));
    });
  }));
  // 5. tool & paint (what presets carry as tool settings)
  body.appendChild(section('paint', 'Tool & paint', (sec) => {
    const add = sec.appendChild.bind(sec);
    if (!bpAll) {   // only what differs from Photoshop's defaults
      sec.appendChild = (n) => n;
      const show = (cond, node) => { if (cond) add(node); };
      show(o.opacity < 100, kv('Opacity %', num(o.opacity, (x) => setOpt({ opacity: Math.round(x) }))));
      show('flow' in o && o.flow < 100, kv('Flow %', num(o.flow, (x) => setOpt({ flow: Math.round(x) }))));
      show(o.mode && o.mode._value !== 'normal', kv('Mode', el('span', 'bpVal', o.mode && o.mode._value)));
      [['Build-up', 'repeat'], ['Wet edges', 'wetEdges'], ['Noise', 'noise'], ['Texture', 'useTexture'], ['Scatter', 'useScatter'], ['Colour dynamics', 'useColorDynamics']].forEach(([lab, k]) => show(o[k], kv(lab, tog(true, (x) => setOpt({ [k]: x })))));
      show(o.dualBrush && o.dualBrush.useDualBrush, kv('Dual brush', tog(true, (x) => setOpt({ dualBrush: Object.assign({}, o.dualBrush, { useDualBrush: x }) }))));
      show(o.useTexture && o.textureDepth, kv('Grain depth %', num(pct(o.textureDepth), (x) => setOpt({ textureDepth: P(x) }))));
      ['wetness', 'dryness', 'mix'].forEach((k) => show(k in o, kv(k === 'dryness' ? 'Load %' : k[0].toUpperCase() + k.slice(1) + ' %', num(o[k], (x) => setOpt({ [k]: Math.round(x) })))));
      if (!sec.querySelector('.bpKV')) add(el('div', 'bpNote', 'All at Photoshop defaults.'));
      return;
    }
    sec.appendChild(kv('Tool', el('span', 'bpVal', TOOL_NAMES[activeTool] || activeTool)));
    sec.appendChild(kv('Opacity %', num(o.opacity, (x) => setOpt({ opacity: Math.round(x) }))));
    if ('flow' in o) sec.appendChild(kv('Flow %', num(o.flow, (x) => setOpt({ flow: Math.round(x) }))));
    if (o.mode) sec.appendChild(kv('Mode', sel([['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['softLight', 'Soft light'], ['darken', 'Darken'], ['lighten', 'Lighten'], ['color', 'Colour'], ['luminosity', 'Luminosity'], ['dissolve', 'Dissolve'], ['behind', 'Behind']], o.mode._value, (x) => setOpt({ mode: { _enum: 'blendMode', _value: x } }))));
    [['Build-up (airbrush)', 'repeat'], ['Wet edges', 'wetEdges'], ['Noise', 'noise'], ['Texture', 'useTexture'], ['Protect texture', 'protectTexture'], ['Scatter', 'useScatter'], ['Colour dynamics', 'useColorDynamics'], ['Shape dynamics', 'useTipDynamics'], ['Transfer', 'usePaintDynamics']].forEach(([lab, k]) => { if (k in o) sec.appendChild(kv(lab, tog(o[k], (x) => setOpt({ [k]: x })))); });
    if (o.dualBrush) sec.appendChild(kv('Dual brush', tog(o.dualBrush.useDualBrush, (x) => setOpt({ dualBrush: Object.assign({}, o.dualBrush, { useDualBrush: x }) }))));
    if (o.useTexture) {
      if (o.textureDepth) sec.appendChild(kv('Grain depth %', num(pct(o.textureDepth), (x) => setOpt({ textureDepth: P(x) }))));
      if (o.textureScale) sec.appendChild(kv('Grain scale %', num(pct(o.textureScale), (x) => setOpt({ textureScale: P(x) }))));
      if (o.textureBlendMode) sec.appendChild(kv('Grain mode', sel([['multiply', 'Multiply'], ['subtract', 'Subtract'], ['darken', 'Darken'], ['overlay', 'Overlay'], ['colorDodge', 'Colour dodge'], ['colorBurn', 'Colour burn'], ['linearBurn', 'Linear burn'], ['hardMix', 'Hard mix'], ['linearHeight', 'Linear height'], ['height', 'Height']], o.textureBlendMode._value, (x) => setOpt({ textureBlendMode: { _enum: 'blendMode', _value: x } }))));
    }
    if ('smoothingValue' in o) sec.appendChild(kv('Smoothing %', num(o.smoothingValue, (x) => setOpt({ smoothingValue: Math.round(x) }))));
    ['wetness', 'dryness', 'mix'].forEach((k) => { if (k in o) sec.appendChild(kv(k === 'dryness' ? 'Load %' : k[0].toUpperCase() + k.slice(1) + ' %', num(o[k], (x) => setOpt({ [k]: Math.round(x) })))); });
  }));
  // tool-specific: Mixer Brush (wet paint) and Smudge, based on what is active in Photoshop
  if ('wetness' in o) body.appendChild(section('mixer', 'Wet paint (Mixer Brush)', (sec) => {
    if (bpHelp) sec.appendChild(helpLine('The Mixer Brush carries paint and picks paint up from the canvas, like oil. Wet = how much canvas paint it picks up, Load = paint on the brush, Mix = canvas versus brush paint.'));
    [['Wetness %', 'wetness'], ['Load %', 'dryness'], ['Mix %', 'mix'], ['Flow %', 'flow']].forEach(([lab, k]) => { if (k in o) sec.appendChild(kv(lab, num(o[k], (x) => setOpt({ [k]: Math.round(x) })))); });
    [['Clean after each stroke', 'autoClean'], ['Load after each stroke', 'autoFill'], ['Load solid colours only', 'loadSolidColorOnly'], ['Sample all layers', 'sampleAllLayers']].forEach(([lab, k]) => { if (k in o) sec.appendChild(kv(lab, tog(o[k], (x) => setOpt({ [k]: x })))); });
  }));
  if ('smudgeStick' in o || '$SmdF' in o) body.appendChild(section('smudge', 'Smudge', (sec) => {
    if (bpHelp) sec.appendChild(helpLine('Smudge pushes paint that is already there along your stroke, like a finger or a dry brush smearing oil or pastel. It adds no paint unless finger painting is on.'));
    if ('pressure' in o) sec.appendChild(kv('Strength %', num(o.pressure, (x) => setOpt({ pressure: Math.round(x) }))));
    if ('$SmdF' in o) sec.appendChild(kv('Finger painting', tog(o.$SmdF, (x) => setOpt({ $SmdF: x }))));
    if ('smudgeStick' in o) sec.appendChild(kv('Sample all layers', tog(o.smudgeStick, (x) => setOpt({ smudgeStick: x }))));
  }));
  // impasto settings, used by the rail's Impasto button
  body.appendChild(section('impasto', 'Impasto (oil relief)', (sec) => {
    const im = impastoSettings();
    if (bpHelp) sec.appendChild(helpLine('The rail\'s Impasto button copies everything you painted onto a new layer and runs Photoshop\'s Oil Paint filter on it, so paint gets ridges and light. Your painting underneath is untouched; hide or delete the layer to undo.'));
    const put = (k, x) => { const m = impastoSettings(); m[k] = x; store.set('impasto', m); renderBrushPanel(); };
    [['Stylization', 'stylization', 'How swirly and painterly the strokes become (0.1 to 10).'], ['Cleanliness', 'cleanliness', 'Smooth (high) or gritty, detailed (low) paint (0 to 10).'],
     ['Scale', 'brushScale', 'Size of the paint strokes and ridges (0.1 to 10).'], ['Bristle detail', 'microBrush', 'Fine bristle grooves inside the strokes (0 to 10).'],
     ['Light angle °', 'lightDirection', 'Where the light comes from, so ridges catch highlights.'], ['Shine', 'specularity', 'How glossy and raised the paint looks (0 to 10).'],
     ['Effect strength %', 'opacity', 'Opacity of the impasto layer.']].forEach(([lab, k, h]) => sec.appendChild(kv(lab, num(im[k], (x) => put(k, x)), h)));
    sec.appendChild(kv('Lighting', tog(im.lightingOn, (x) => put('lightingOn', x)), 'Off = only the paint swirl, no raised relief.'));
    sec.appendChild(kv('Blend', sel([['softLight', 'Soft light'], ['overlay', 'Overlay'], ['normal', 'Normal'], ['linearLight', 'Linear light']], im.blend, (x) => put('blend', x)), 'How the relief sits on your painting. Soft light keeps colours true and the paper clean.'));
  }));
}
function kv(label, ctl, help) {
  const r = el('div', 'bpKV'); const k = el('span', 'bpKey', label); const h = help || FIELD_HELP[label]; if (h) k.title = h;
  r.appendChild(k); r.appendChild(ctl);
  if (!bpHelp || !h) return r;
  const w = el('div', 'bpKVwrap'); w.appendChild(r); w.appendChild(helpLine(h)); return w;   // description under the control
}
/* pressure curve: in -> out with a floor, a ceiling and a bend; saved per brush, read by the pen relay */
async function curveFile() { const d = await lfs.getDataFolder(); return d; }
function curveFor(k) { return Object.assign({ inLo: 0, inHi: 100, outLo: 0, outHi: 100, bend: 0 }, (store.get('curves', {})[k || 'default']) || {}); }
const curveAt = (c, p) => { const t = Math.max(0, Math.min(1, (p * 100 - c.inLo) / Math.max(1, c.inHi - c.inLo))); const g = Math.pow(2, -c.bend / 25); return (c.outLo + (c.outHi - c.outLo) * Math.pow(t, g)) / 100; };
async function writeCurveForRelay(c) {
  try { const d = await curveFile(); const f = await d.createFile('pressure-curve.json', { overwrite: true }); await f.write(JSON.stringify(c)); } catch (e) { log('curve', e); }
}
function buildCurve(sec) {
  const k = lastBrushKey || 'default'; const c = curveFor(k);
  const graph = el('div', 'curve');
  for (let i = 0; i <= 24; i++) { const x = i / 24; const y = curveAt(c, x); const d = el('div', 'cdot'); d.style.left = (x * 100) + '%'; d.style.bottom = (y * 100) + '%'; graph.appendChild(d); }
  const diag = el('div', 'cdiag'); graph.appendChild(diag);
  sec.appendChild(graph);
  const save = (chg) => { const all = store.get('curves', {}); all[k] = Object.assign(c, chg); store.set('curves', all); writeCurveForRelay(all[k]); renderBrushPanel(); };
  sec.appendChild(kv('Bend (soft − / hard +)', num(c.bend, (x) => save({ bend: Math.max(-100, Math.min(100, x)) }), { min: -100, max: 100 })));
  sec.appendChild(kv('Pen starts at %', num(c.inLo, (x) => save({ inLo: x }))));
  sec.appendChild(kv('Full at %', num(c.inHi, (x) => save({ inHi: x }))));
  sec.appendChild(kv('Lightest output %', num(c.outLo, (x) => save({ outLo: x }))));
  sec.appendChild(kv('Strongest output %', num(c.outHi, (x) => save({ outHi: x }))));
  const lin = el('div', 'b bpReset', 'Linear'); lin.onclick = () => save({ inLo: 0, inHi: 100, outLo: 0, outHi: 100, bend: 0 }); sec.appendChild(lin);
  sec.appendChild(el('div', 'bpNote', 'Photoshop maps pressure linearly. This curve reshapes the pen pressure before Photoshop sees it, for this brush.'));
}

/* ---------- library wiring ---------- */
function initLibrary() {
  document.querySelectorAll('#tabs .b').forEach((b) => b.onclick = () => { tab = b.dataset.tab; setTab(); render(); });
  let t; $('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { query = e.target.value.trim(); render(); }, 150); });
  // view size, like Premiere's media zoom: 0 list, 1 two covers per row, 2 one large cover per row (brush tiles grow too)
  const applyZoom = (z) => { const l = $('#list'); ['z0', 'z1', 'z2'].forEach((c) => l.classList.remove(c)); l.classList.add('z' + z); };
  const vbtns = document.querySelectorAll('#views .vbtn');
  const setView = (z) => { applyZoom(z); store.set('zoom', +z); vbtns.forEach((b) => b.classList.toggle('on', b.dataset.z == z)); };
  setView(store.get('zoom', 0));
  vbtns.forEach((b) => b.onclick = () => { setView(+b.dataset.z); render(); });
  $('#bpRefresh').onclick = () => renderBrushPanel();
  const bpQ = $('#bpHelp'); const paintQ = () => bpQ.classList.toggle('on', bpHelp); paintQ();
  bpQ.onclick = () => { bpHelp = !bpHelp; store.set('bpHelp', bpHelp); paintQ(); renderBrushPanel(); renderInspector(); };
  const bpMode = $('#bpMode'); const paintMode = () => { bpMode.textContent = bpAll ? 'All' : 'Simple'; bpMode.classList.toggle('on', bpAll); };
  paintMode(); bpMode.onclick = () => { bpAll = !bpAll; store.set('bpAll', bpAll); paintMode(); renderBrushPanel(); };
  $('#inspHead').onclick = () => { inspOpen = !inspOpen; store.set('inspOpen', inspOpen); renderInspector(); };
  const pick = async () => { const f = await lfs.getFolder(); if (f) loadLibrary(f.nativePath); };
  $('#pick').onclick = pick; $('#settings').onclick = pick;
  // <plugin data>/library.txt (if present) names the brush folder; otherwise the last folder picked
  const root = store.get('root', null);
  lfs.getDataFolder().then((d) => d.getEntry('library.txt')).then((f) => f.read())
    .then((p) => { p = p.trim(); if (p) loadLibrary(p); else if (root) loadLibrary(root); else render(); })
    .catch(() => { if (root) loadLibrary(root); else render(); });
}

/* ---------- rail ---------- */
// one "Wet" value (0 dry .. 100 soaking) drives the Mixer Brush's wetness, load and mix together
const wetOpts = (w) => ({ wetness: Math.round(w), dryness: Math.round(Math.max(0, 100 - w * 1.15)), mix: Math.round(w), autoFill: w < 85, autoClean: true, sampleAllLayers: true });   // wet end = clean blender
let activeTool = 'paintbrushTool';
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
    const t = b.dataset.tool; markTool(t); activeTool = t;
    try {
      if (t === 'paintbrushTool') await ps_.tool(t);
      else if (t === 'eraserTool') {   // eraser: a plain round circle at the current size (textured tips erase unevenly)
        await ps_.brush('Hard Round Pressure Size', t).catch(() => ps_.brush('Hard Round', t));
        await ps_.size((currentBrush && currentBrush.px) || sliderToPx(size.value));
      }
      else await ps_.carryBrush(t);
      if (t === 'wetBrushTool') { const w = store.get('wet', 50); await ps_.toolOpts(wetOpts(w), 'Wet'); op.value = w; opV.textContent = 'Wet ' + w + '%'; }
      else if (syncRail) syncRail();
    } catch (e) { log('tool', t, e); try { await ps_.tool(t); } catch (x) {} }
  });
  markTool('paintbrushTool');
  // always start on the brush (a leftover smudge/eraser/move tool looks like 'the pen does nothing'); selecting a
  // tool needs an open document, so also do it when one is opened or created
  ps_.tool('paintbrushTool').catch(() => {});
  let brushOnOpen = true;
  action.addNotificationListener(['open', 'make'], (ev, d) => {
    if (!brushOnOpen || (d && d._target && d._target[0] && d._target[0]._ref && d._target[0]._ref !== 'document')) return;
    brushOnOpen = false; ps_.tool('paintbrushTool').catch(() => { brushOnOpen = true; });
  });
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
  const opLabel = () => (activeTool === 'wetBrushTool' ? 'Wet ' : '');
  const op = vslider($('#opacity'), { min: 1, max: 100, value: 100,
    onInput: (v) => { opV.textContent = opLabel() + Math.round(v) + '%'; },
    onChange: (v) => {
      if (activeTool === 'wetBrushTool') { store.set('wet', Math.round(v)); ps_.toolOpts(wetOpts(v), 'Wet').catch((e) => log('wet', e)); }
      else ps_.opacity(Math.round(v)).catch((e) => log('opacity', e));
    } });
  showSize(); opV.textContent = '100%';
  // ---- what the pen sends: global switches; pressure/tilt/button/eraser are cut at the source (pen relay),
  // stroke-derived inputs (direction, fade) and pen features this pen lacks pause the brush links that use them
  const INPUTS = [['pressure', 'Pressure', [2]], ['tilt', 'Tilt', [3]], ['rotation', 'Rotation', [7, 8]], ['wheel', 'Wheel', [4]],
                  ['direction', 'Direction', [5, 6]], ['fade', 'Fade', [1]], ['barrel', 'Button', []], ['eraser', 'Eraser', []]];
  let inputs = Object.assign({ pressure: true, tilt: true, rotation: true, wheel: true, direction: true, fade: true, barrel: true, eraser: true }, store.get('penInputs', {}));
  let caps = { pressure: true, tilt: true, rotation: false, wheel: false, barrel: true, eraser: true };
  const box = $('#penInputs');
  const writeInputs = async () => { try { const d = await lfs.getDataFolder(); const f = await d.createFile('pen-inputs.json', { overwrite: true }); await f.write(JSON.stringify(inputs)); } catch (e) { log('inputs', e); } };
  const readCaps = async () => { try { const d = await lfs.getDataFolder(); const f = await d.getEntry('pen-caps.json'); caps = Object.assign(caps, JSON.parse(await f.read())); } catch (e) {} };
  const paintInputs = () => {
    box.innerHTML = '';
    INPUTS.forEach(([id, label]) => {
      const sent = caps[id] !== false || ['direction', 'fade'].includes(id);
      const t = el('div', 'b ptog' + (inputs[id] && sent ? ' on' : '') + (sent ? '' : ' na'), label);
      t.title = sent ? (inputs[id] ? label + ' is sent to Photoshop. Tap to stop sending it.' : label + ' is off. Tap to send it again.') : label + ': not sent by this pen.';
      if (sent) t.onclick = async () => { inputs[id] = !inputs[id]; store.set('penInputs', inputs); paintInputs(); await writeInputs(); await applyInputs(); };
      box.appendChild(t);
    });
  };
  // pause or restore brush links driven by inputs that are off (uses the brush's own settings to restore)
  const OFF0 = { _obj: '$brVr', $bVTy: 0, $fStp: 25, jitter: { _unit: 'percentUnit', _value: 0 }, minimum: { _unit: 'percentUnit', _value: 0 } };
  const applyInputs = async () => {
    try {
      const cur = await nativeOptions(); const nat = (currentBrush && currentBrush.native) || {};
      const offCodes = new Set(INPUTS.filter(([id]) => !inputs[id] && !['pressure', 'tilt', 'barrel', 'eraser'].includes(id)).flatMap(([, , c]) => c));
      const patch = {};
      ['$szVr', '$opVr', '$prVr', 'angleDynamics', 'roundnessDynamics', 'textureDepthDynamics', 'scatterDynamics', 'countDynamics'].forEach((k) => {
        if (!(k in cur)) return;
        const n = nat[k] || cur[k];
        if (n && offCodes.has(n.$bVTy)) patch[k] = Object.assign({}, n, { $bVTy: 0 });
        else if (n && n.$bVTy && cur[k].$bVTy === 0) patch[k] = n;   // input back on: restore
      });
      if (Object.keys(patch).length) await ps_.toolOpts(patch, 'Pen inputs');
    } catch (e) { log('inputs', e); }
  };
  readCaps().then(paintInputs); writeInputs(); setInterval(() => readCaps().then(paintInputs), 10000);
  applyPressure = applyInputs;
  loadPressure = () => ({ tilt: false });
  let fxNow = { paper: false, wet: false, layer: false };
  fxNowRef = () => fxNow;
  const fxEls = { paper: $('#fxPaper'), wet: $('#fxWet'), layer: $('#fxLayer') };
  const paintFx = () => {
    Object.keys(fxEls).forEach((k) => fxEls[k].classList.toggle('on', !!fxNow[k]));
    fxEls.paper.classList.toggle('own', !!fxNow.own && !fxNow.paper);
    fxEls.paper.textContent = 'Paper';   // dashed border = the brush's own grain (rail is too narrow for more text)
    fxEls.paper.title = fxNow.own && !fxNow.paper ? "This brush brings its own paper grain. Tap to use InkStudio paper instead." : 'Paper grain: texture shows through';
  };
  setFx = async (fx) => {
    fxNow = fx; paintFx();
    try { if (fx.paper) await ensurePaper(); await ps_.toolOpts(fxPatch(fx), 'Media'); } catch (e) { log('fx', e); }
  };
  Object.keys(fxEls).forEach((k) => fxEls[k].onclick = async () => {
    const fx = Object.assign({}, fxNow, { [k]: !fxNow[k] });
    if (lastBrushKey) { const m = store.get('fx', {}); m[lastBrushKey] = { paper: fx.paper, wet: fx.wet, layer: fx.layer }; store.set('fx', m); }   // remembered per brush (tilt is a pen setting)
    if (k === 'paper' && fxNow.paper && fxNow.own && currentBrush) {
      // back to the maker's grain: re-select the preset, then re-apply size and pressure
      try { await ps_.brush(currentBrush.name, await currentTool()); await ps_.size(currentBrush.px); applyPressure && await applyPressure(); } catch (e) { log('restore grain', e); }
    }
    setFx(fx);
  });
  paintFx();
  // finishing: Photoshop's Oil Paint filter on a merged copy, so the painting underneath stays untouched
  // finishing: Photoshop's Oil Paint filter on a merged copy in Soft Light (paint gains relief, white paper stays clean);
  // the painting underneath is untouched, hide or delete the layer to undo the look
  $('#impasto').onclick = () => { const im = impastoSettings(); return play([
    { _obj: 'make', _target: [{ _ref: 'layer' }] },
    { _obj: 'mergeVisible', duplicate: true },
    { _obj: 'oilPaint', stylization: im.stylization, cleanliness: im.cleanliness, brushScale: im.brushScale, microBrush: im.microBrush, lightingOn: !!im.lightingOn, lightDirection: Math.round(im.lightDirection), specularity: im.specularity },
    { _obj: 'set', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }], to: { _obj: 'layer', name: 'Impasto (oil paint)' } },
    { _obj: 'set', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }], to: { _obj: 'layer', mode: { _enum: 'blendMode', _value: im.blend }, opacity: { _unit: 'percentUnit', _value: im.opacity } } },
  ], 'Impasto').catch((e) => log('impasto', e)); };
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
      if (o && o.opacity != null && activeTool !== 'wetBrushTool') { op.value = o.opacity; opV.textContent = Math.round(o.opacity) + '%'; }
      // the switches show what the brush actually does right now (presets and the Brush panel can change it)
      if (o) {
        const on = (k, c) => o[k] && o[k].$bVTy === c;
        $('#fxWet').classList.toggle('on', !!o.wetEdges);
        $('#fxLayer').classList.toggle('on', !!(o.mode && o.mode._value === 'multiply'));
        if (!o.useTexture) { $('#fxPaper').classList.remove('on'); $('#fxPaper').classList.remove('own'); }
      }
    } catch (e) {}
  };
  action.addNotificationListener(['set', 'select'], () => { syncRail(); clearTimeout(inspT); inspT = setTimeout(() => { renderInspector(); renderBrushPanel(); }, 250); });
}


/* dev hook: <plugin data>/cmd.json -> runs one command, answer in cmd.out (lets tests drive the panel without the mouse) */
async function devHook() {
  try {
    const d = await lfs.getDataFolder();
    const f = await d.getEntry('cmd.json').catch(() => null);
    if (!f) return;
    const c = JSON.parse(await f.read()); await f.delete();
    let out = 'ok';
    try {
      if (c.op === 'select') {
        const p = LIB.packs.find((x) => x.id === c.pack); const fl = p.files[c.file || 0];
        await useBrush(p, fl, c.brush || fl.brushes[0], null).catch((e) => { out = 'ERR ' + (e.message || e); });
      } else if (c.op === 'fx') { await setFx(c.fx); }
      else if (c.op === 'opts') { const o = await nativeOptions(); out = JSON.stringify((c.keys || Object.keys(o)).reduce((a, k) => (a[k] = o[k], a), {})); }
      else if (c.op === 'click') { const r = document.getElementById(c.id).onclick(); if (r && r.then) await r; }
      else if (c.op === 'favs') { (c.add || []).forEach((k) => favs.add(k)); store.set('favs', [...favs]); render(); out = 'favs ' + favs.size; }
      else if (c.op === 'feel') { await applyFeel(c.id); }
      else if (c.op === 'delfeel') { Object.keys(store.get('myFeels', {})).filter((k) => store.get('myFeels', {})[k].name === c.name).forEach(deleteFeel); }
      else if (c.op === 'savefeel') { await saveFeel(c.name); out = JSON.stringify(Object.keys(store.get('myFeels', {}))); }
      else if (c.op === 'savebrush') { await saveBrushToPhotoshop(c.name); out = $('#status').textContent; }
      else if (c.op === 'strip') {
        await renderStrip(); out = stripUrl ? 'strip ' + stripUrl.length : 'no strip';
        if (stripUrl) { const bin = atob(stripUrl.split(',')[1]); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const sf = await d.createFile('strip.jpg', { overwrite: true }); await sf.write(u.buffer, { format: storage.formats.binary }); }
      }
      else if (c.op === 'state') { out = JSON.stringify({ bpOpen, bpHelp }); }
      else if (c.op === 'mine') { out = JSON.stringify(store.get('myBrushes', [])); }
      else if (c.op === 'unmine') { await play([{ _obj: 'delete', _target: [{ _ref: 'brush', _name: c.name }] }]).catch(() => {}); store.set('myBrushes', store.get('myBrushes', []).filter((x) => x.name !== c.name)); }
      else if (c.op === 'names') { const n = await presetNames(); out = n.length + ' ' + JSON.stringify(n.slice(-5)); }
      else if (c.op === 'tool') { document.querySelector(`.tool[data-tool="${c.tool}"]`).onclick(); }
      else if (c.op === 'ui') { for (const a of c.do) {   // dev: drive the UI without the mouse (screenshots for the manual)
          const n = !a.sel ? null : a.text ? Array.from(document.querySelectorAll(a.sel)).find((x) => x.textContent.includes(a.text)) : document.querySelector(a.sel);
          if (a.click) { if (n.onclick) await n.onclick({ stopPropagation() {}, target: n }); else n.click(); }
          if ('top' in a) n.scrollTop = a.top;
          if (a.panel) await require('uxp').entrypoints.getPanel(a.panel).show();
          if (a.wait) await new Promise((r) => setTimeout(r, a.wait));
          if (a.eval) out = String(await (new Function('return (async () => {' + a.eval + '})()'))());
        } }
      else out = 'ERR unknown op ' + c.op;
    } catch (e) { out = 'ERR ' + (e.stack || e); }
    const o = await d.createFile('cmd.out', { overwrite: true }); await o.write(out + '\n' + LOG.slice(-5).join('\n'));
  } catch (e) {}
}
setInterval(devHook, 700);

/* ---------- panel entrypoints ---------- */
const mount = (id) => ({
  show(ev) {
    log('show', id, ev && (ev.node ? 'node' : typeof ev));
    const node = (ev && ev.node) || ev || document.body;
    const part = document.getElementById(id);
    if (part && part.parentNode !== node && node.appendChild) node.appendChild(part);
  },
});
try { entrypoints.setup({ panels: { library: mount('library'), rail: mount('rail'), brushpanel: mount('brushpanel') } }); log('setup ok'); } catch (e) { log('setup', e); }
try { initLibrary(); log('library ok'); } catch (e) { log('initLibrary', e); }
try { initRail(); log('rail ok'); } catch (e) { log('initRail', e); }
