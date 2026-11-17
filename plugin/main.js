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
let inspT = null;
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
    p.tags.slice(0, 12).forEach((tg) => { const b = el('div', 'b tag', tg); b.onclick = () => { query = tg; $('#q').value = tg; tab = 'packs'; setTab(); render(); }; t.appendChild(b); });
    body.appendChild(t);
  }
  p.files.forEach((f) => {
    if (p.files.length > 1) body.appendChild(el('div', 'file', f.file.split('/').pop().replace(/\.abr$/i, '')));
    const names = f.brushes.length ? f.brushes : f.tips.map((_, i) => `Brush ${i + 1}`);
    // tip images show a brush best (the user's call); painted strokes only where there is no tip (computed brushes:
    // Photoshop's own, bristle tips)
    const useStrokes = f.strokes && f.strokes.some(Boolean) && (!f.tips.length || p.author === 'Adobe');
    if (useStrokes) {
      // Procreate-style rows: a real stroke rendered by Photoshop with this brush, name underneath
      const list = el('div', 'strokes');
      const LIMIT = 48;   // big packs (up to 500 brushes): show a first page, the rest on request
      const shown = showAll.has(p.id + f.file) ? names : names.slice(0, LIMIT);
      shown.forEach((b, i) => {
        const row = el('div', 'srow');
        const im = el('img', 'stroke');
        if (f.strokes[i]) lazyImg(im, LIB.root + '/.inkstudio/' + f.strokes[i]);
        else if (f.tips[i]) { lazyImg(im, LIB.root + '/.inkstudio/' + f.tips[i]); im.classList.add('tipOnly'); }   // no painted preview yet: show the tip
        else im.classList.add('blank');
        row.appendChild(im);
        const line = el('div', 'sline'); line.appendChild(el('div', 'name', b)); line.appendChild(star(key(p, f, b)));
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
    const shownT = showAll.has(p.id + f.file) ? names : names.slice(0, 60);
    shownT.forEach((b, i) => {
      const cell = el('div', 'cell');
      const im = el('img', 'tip');
      const tip = f.tips[Math.min(i, f.tips.length - 1)];
      if (tip && i < f.tips.length) lazyImg(im, LIB.root + '/.inkstudio/' + tip); else im.classList.add('blank');
      cell.appendChild(im);
      cell.appendChild(el('div', 'name', b));
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
    applyPressure && await applyPressure();
    const fx = Object.assign({ paper: false, wet: false, layer: false }, MEDIUM_FX[p.media.find((m) => MEDIUM_FX[m])] || {});
    if (native.useTexture) { fx.paper = false; fx.own = true; }       // maker's grain wins
    if (native.wetEdges) fx.wet = true;
    fx.tilt = !!store.get('pressure', {}).tilt;
    Object.assign(fx, store.get('fx', {})[key(p, f, b)] || {});
    setFx && await setFx(fx);
    lastBrushKey = key(p, f, b);
    activeTool = 'paintbrushTool';
    document.querySelectorAll('.tool').forEach((x) => x.classList.toggle('on', x.dataset.tool === 'paintbrushTool'));
    syncRail && syncRail();
    status(`${b}, ${px} px`);
    renderInspector();
    recent = [{ pack: p.id, file: f.file, brush: b }, ...recent.filter((r) => !(r.pack === p.id && r.brush === b))].slice(0, 40);
    store.set('recent', recent);
  } catch (e) { status('Could not select: ' + (e.message || e)); log('useBrush', b, e); throw e; }
}
function setTab() { document.querySelectorAll('#tabs .b').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab)); }


/* ---------- pen inspector: every way the current brush reacts to the pen, live from Photoshop, each switchable ---------- */
const CONTROL = { 1: 'Fade', 2: 'Pressure', 3: 'Tilt', 4: 'Stylus wheel', 5: 'Rotation', 6: 'Initial direction', 7: 'Direction', 8: 'Pressure', 9: 'Stylus wheel' };
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
  const groups = {};
  pr.rows.forEach((r) => (groups[r.control] = groups[r.control] || []).push(r));
  if (!pr.rows.length) body.appendChild(el('div', 'inspNone', 'Nothing on this brush follows the pen.'));
  Object.keys(groups).forEach((g) => {
    body.appendChild(el('div', 'inspGroup', g));
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
  const pS = $('#pSize'), pO = $('#pOpacity');
  const prs = store.get('pressure', { size: true, opacity: true });
  const paintP = () => { pS.classList.toggle('on', prs.size); pO.classList.toggle('on', prs.opacity); };
  // on = Photoshop's pressure overrides; off = also silence the brush's own pressure response, so off really means off
  const OFF = { _obj: '$brVr', $bVTy: 0, $fStp: 25, jitter: { _unit: 'percentUnit', _value: 0 }, minimum: { _unit: 'percentUnit', _value: 0 } };
  const applyP = async () => {
    try {
      const cur = await nativeOptions();
      const nat = (currentBrush && currentBrush.native) || {};
      const PRESS = Object.assign({}, OFF, { $bVTy: 2 });
      // on = the maker's own pressure settings (pressure added only where the brush had none); off = silent
      const set = (k, on) => { if (!(k in cur)) return; patch[k] = !on ? OFF : (nat[k] && nat[k].$bVTy ? nat[k] : PRESS); };
      const patch = { usePressureOverridesSize: prs.size, usePressureOverridesOpacity: prs.opacity };
      set('$szVr', prs.size);
      set('$opVr', prs.opacity); set('$prVr', prs.opacity);   // opacity switch: opacity, flow
      if (cur.useTexture) set('textureDepthDynamics', prs.opacity);   // ...and grain depth
      await ps_.toolOpts(patch, 'Pressure');
    } catch (e) { log('pressure', e); }
  };
  pS.onclick = () => { prs.size = !prs.size; store.set('pressure', prs); paintP(); applyP(); };
  pO.onclick = () => { prs.opacity = !prs.opacity; store.set('pressure', prs); paintP(); applyP(); };
  const pT = $('#pTilt');
  const paintT = () => pT.classList.toggle('on', !!prs.tilt);
  pT.onclick = () => { prs.tilt = !prs.tilt; store.set('pressure', prs); paintT(); if (setFx) setFx(Object.assign({}, fxNowRef(), { tilt: prs.tilt })); };
  paintP(); paintT();
  applyPressure = applyP;
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
  $('#impasto').onclick = () => play([
    { _obj: 'make', _target: [{ _ref: 'layer' }] },
    { _obj: 'mergeVisible', duplicate: true },
    { _obj: 'oilPaint', stylization: 4, cleanliness: 6, brushScale: 1, microBrush: 2, lightingOn: true, lightDirection: -60, specularity: 1.3 },
    { _obj: 'set', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }], to: { _obj: 'layer', name: 'Impasto (oil paint)' } },
    { _obj: 'set', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }], to: { _obj: 'layer', mode: { _enum: 'blendMode', _value: 'softLight' } } },
  ], 'Impasto').catch((e) => log('impasto', e));
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
    } catch (e) {}
  };
  action.addNotificationListener(['set', 'select'], () => { syncRail(); clearTimeout(inspT); inspT = setTimeout(renderInspector, 250); });
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
      else if (c.op === 'names') { const n = await presetNames(); out = n.length + ' ' + JSON.stringify(n.slice(-5)); }
      else if (c.op === 'tool') { document.querySelector(`.tool[data-tool="${c.tool}"]`).onclick(); }
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
try { entrypoints.setup({ panels: { library: mount('library'), rail: mount('rail') } }); log('setup ok'); } catch (e) { log('setup', e); }
try { initLibrary(); log('library ok'); } catch (e) { log('initLibrary', e); }
try { initRail(); log('rail ok'); } catch (e) { log('initRail', e); }
