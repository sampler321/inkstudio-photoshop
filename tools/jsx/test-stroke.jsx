// stroke a test S-curve with the current brush (simulated pressure) on a temp layer "inkstudio-test"
var doc = app.activeDocument; var _ru = app.preferences.rulerUnits; app.preferences.rulerUnits = Units.PIXELS;
var _res = doc.resolution; var K = 72 / _res;   // path anchors are in points
var L = doc.artLayers.add(); L.name = 'inkstudio-test';
var pts = [], W = doc.width.as('px'), H = doc.height.as('px');
for (var i = 0; i <= 40; i++) {
  var t = i / 40, x = W * (0.12 + 0.7 * t), y = H * (0.35 + 0.18 * Math.sin(t * Math.PI * 2) + (TEST_ROW || 0) * 0.25);
  var p = new PathPointInfo(); p.kind = PointKind.CORNERPOINT; p.anchor = [x*K, y*K]; p.leftDirection = [x*K, y*K]; p.rightDirection = [x*K, y*K]; pts.push(p);
}
var sp = new SubPathInfo(); sp.closed = false; sp.operation = ShapeOperation.SHAPEADD; sp.entireSubPath = pts;
var tp = doc.pathItems.add('inkstudio-test-path', [sp]);
tp.select();
var d = new ActionDescriptor(), r = new ActionReference();
r.putEnumerated(charIDToTypeID('Path'), charIDToTypeID('Ordn'), charIDToTypeID('Trgt')); d.putReference(charIDToTypeID('null'), r);
d.putClass(charIDToTypeID('Usng'), stringIDToTypeID('paintbrushTool')); d.putBoolean(stringIDToTypeID('pressure'), true);
executeAction(charIDToTypeID('Strk'), d, DialogModes.NO);
tp.remove();
app.preferences.rulerUnits = _ru; 'stroked';
