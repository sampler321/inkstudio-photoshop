// define plugin/assets/paper-tooth.png as the "InkStudio Paper" pattern; returns its id
function s(x){return stringIDToTypeID(x)}
var keep = app.documents.length ? app.activeDocument : null;
var doc = app.open(new File(PAPER_PATH));
doc.selection.selectAll();
var d = new ActionDescriptor(), r = new ActionReference(); r.putClass(s('pattern')); d.putReference(charIDToTypeID('null'), r);
var r2 = new ActionReference(); r2.putProperty(s('property'), s('selection')); r2.putEnumerated(s('document'), s('ordinal'), s('targetEnum'));
d.putReference(s('using'), r2); d.putString(s('name'), 'InkStudio Paper');
var res = executeAction(s('make'), d, DialogModes.NO);
doc.close(SaveOptions.DONOTSAVECHANGES);
if (keep) app.activeDocument = keep;
var out = [];
for (var i = 0; i < res.count; i++) out.push(typeIDToStringID(res.getKey(i)));
'made; result keys: ' + out.join(',');
