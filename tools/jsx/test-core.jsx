// load an .abr (append), select a brush by name, set size; report the result
function s(x){return stringIDToTypeID(x)}
var f = new File(arguments_path);
var out = [];
try {
  var d = new ActionDescriptor(), r = new ActionReference();
  r.putEnumerated(s('brush'), s('ordinal'), s('allEnum')); d.putReference(charIDToTypeID('null'), r);
  d.putPath(s('to'), f); d.putBoolean(s('append'), true);
  executeAction(s('set'), d, DialogModes.NO); out.push('loaded');
} catch(e){ out.push('load ERR '+e) }
try {
  var d2 = new ActionDescriptor(), r2 = new ActionReference(); r2.putClass(s('paintbrushTool')); d2.putReference(charIDToTypeID('null'), r2);
  executeAction(s('select'), d2, DialogModes.NO);
  var d3 = new ActionDescriptor(), r3 = new ActionReference(); r3.putName(s('brush'), arguments_brush); d3.putReference(charIDToTypeID('null'), r3);
  executeAction(s('select'), d3, DialogModes.NO); out.push('selected');
} catch(e){ out.push('select ERR '+e) }
try {
  var d4 = new ActionDescriptor(), r4 = new ActionReference(); r4.putEnumerated(s('brush'), s('ordinal'), s('targetEnum')); d4.putReference(charIDToTypeID('null'), r4);
  var b = new ActionDescriptor(); b.putUnitDouble(s('masterDiameter'), s('pixelsUnit'), 123); d4.putObject(s('to'), s('brush'), b);
  executeAction(s('set'), d4, DialogModes.NO); out.push('sized');
} catch(e){ out.push('size ERR '+e) }
try {
  var ref = new ActionReference(); ref.putProperty(s('property'), s('currentToolOptions')); ref.putEnumerated(s('application'), s('ordinal'), s('targetEnum'));
  var o = executeActionGet(ref).getObjectValue(s('currentToolOptions'));
  var br = o.getObjectValue(s('brush'));
  out.push('name=' + (br.hasKey(s('name')) ? br.getString(s('name')) : '?') + ' diam=' + br.getUnitDoubleValue(s('diameter')) + ' opacity=' + o.getInteger(s('opacity')));
} catch(e){ out.push('get ERR '+e) }
out.join(' | ');
