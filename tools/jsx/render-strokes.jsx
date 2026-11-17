// Render one pressure stroke per brush with Photoshop itself -> PNG previews.
// Inputs (set before this file): BRUSHES (array of preset names), OUT_DIR (folder), SIZE (px, optional)
// Writes OUT_DIR/<index>.png (480x120) and returns "done <n> ok, <m> failed: names".
function s(x) { return stringIDToTypeID(x); }
function c(x) { return charIDToTypeID(x); }
function presetNames() { var r = new ActionReference(); r.putProperty(s('property'), s('presetManager')); r.putEnumerated(s('application'), s('ordinal'), s('targetEnum')); var l = executeActionGet(r).getList(s('presetManager')).getObjectValue(0).getList(s('name')); var a = []; for (var i = 0; i < l.count; i++) a.push(l.getString(i)); return a; }
// load the pack, remembering exactly which preset names it adds (deleted again by name at the end;
// index-based deletes are unsafe because each .abr also adds a group)
var ADDED = [];
if (typeof LOAD_PATH != 'undefined') {
  var had = {}, pre0 = presetNames(); for (var q = 0; q < pre0.length; q++) had[pre0[q]] = 1;
  app.load(new File(LOAD_PATH));
  var post = presetNames(); for (var q2 = 0; q2 < post.length; q2++) if (!had[post[q2]]) ADDED.push(post[q2]);
}
var ru = app.preferences.rulerUnits; app.preferences.rulerUnits = Units.PIXELS;
var keepDoc = app.documents.length ? app.activeDocument : null;
var keepFg = app.foregroundColor;
var W = 960, H = 240, K = 72 / 144;
var doc = app.documents.add(W, H, 144, 'inkstudio-previews', NewDocumentMode.RGB, DocumentFill.WHITE);
var paint = doc.artLayers.add();
function opts() { var r = new ActionReference(); r.putProperty(s('property'), s('currentToolOptions')); r.putEnumerated(s('application'), s('ordinal'), s('targetEnum')); return executeActionGet(r).getObjectValue(s('currentToolOptions')); }
function setOpts(t) { var d = new ActionDescriptor(), r = new ActionReference(); r.putClass(s('paintbrushTool')); d.putReference(c('null'), r); d.putObject(s('to'), s('currentToolOptions'), t); executeAction(s('set'), d, DialogModes.NO); }
function selectTool() { var r = new ActionReference(); r.putClass(s('paintbrushTool')); var d = new ActionDescriptor(); d.putReference(c('null'), r); executeAction(s('select'), d, DialogModes.NO); }
function selectBrush(n) {
  var tries = [n, n.replace(/\.(jpe?g|png|tiff?|bmp|psd)$/i, '')];
  for (var t = 0; t < tries.length; t++) { try { var r = new ActionReference(); r.putName(s('brush'), tries[t]); var d = new ActionDescriptor(); d.putReference(c('null'), r); executeAction(s('select'), d, DialogModes.NO); return; } catch (e) { if (t == tries.length - 1) throw e; } }
}
var pts = [];
for (var i = 0; i <= 48; i++) {
  var t = i / 48, x = W * (0.08 + 0.84 * t), y = H * (0.5 + 0.28 * Math.sin(t * Math.PI * 2));
  var p = new PathPointInfo(); p.kind = PointKind.CORNERPOINT; p.anchor = [x * K, y * K]; p.leftDirection = p.anchor; p.rightDirection = p.anchor; pts.push(p);
}
var sp = new SubPathInfo(); sp.closed = false; sp.operation = ShapeOperation.SHAPEADD; sp.entireSubPath = pts;
var ok = 0, failed = [];
var col = new SolidColor(); col.rgb.hexValue = '1e1e1e'; app.foregroundColor = col;
selectTool();
for (var b = 0; b < BRUSHES.length; b++) {
  try {
    selectBrush(BRUSHES[b]);
    var o = opts();
    var br = o.getObjectValue(s('brush'));
    var want = typeof SIZE != 'undefined' ? SIZE : 36;
    br.putUnitDouble(s('diameter'), s('pixelsUnit'), Math.min(want, br.getUnitDoubleValue(s('diameter'))) || want);
    o.putObject(s('brush'), o.getObjectType(s('brush')), br);
    o.putBoolean(s('usePressureOverridesSize'), true); o.putInteger(s('opacity'), 100);
    setOpts(o);
    doc.activeLayer = paint; paint.clear ? null : null;
    doc.selection.selectAll(); doc.selection.clear(); doc.selection.deselect();
    var tp = doc.pathItems.add('ink-preview', [sp]);
    tp.select();
    var d = new ActionDescriptor(), r = new ActionReference();
    r.putEnumerated(c('Path'), c('Ordn'), c('Trgt')); d.putReference(c('null'), r);
    d.putClass(c('Usng'), s('paintbrushTool')); d.putBoolean(s('pressure'), true);
    executeAction(c('Strk'), d, DialogModes.NO);
    tp.remove();
    var png = new PNGSaveOptions(); png.compression = 9;
    var dup = doc.duplicate('p', true); dup.resizeImage(UnitValue(480, 'px'), null, 72, ResampleMethod.BICUBIC);
    dup.saveAs(new File(OUT_DIR + '/' + b + '.png'), png, true); dup.close(SaveOptions.DONOTSAVECHANGES);
    app.activeDocument = doc;
    ok++;
  } catch (e) { failed.push(BRUSHES[b]); try { for (var j = doc.pathItems.length - 1; j >= 0; j--) doc.pathItems[j].remove(); } catch (x) {} }
}
doc.close(SaveOptions.DONOTSAVECHANGES);
// leave the Brushes panel as it was: remove the presets this run appended
for (var a2 = 0; a2 < ADDED.length; a2++) { try { var rr = new ActionReference(); rr.putName(s('brush'), ADDED[a2]); var dd = new ActionDescriptor(); dd.putReference(c('null'), rr); executeAction(s('delete'), dd, DialogModes.NO); } catch (e) {} }
if (keepDoc) app.activeDocument = keepDoc;
app.foregroundColor = keepFg; app.preferences.rulerUnits = ru;
'done ' + ok + ' ok, ' + failed.length + ' failed: ' + failed.slice(0, 10).join(' | ');
