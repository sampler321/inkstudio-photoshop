// export a flattened, downscaled copy of the active document to OUT_PATH (png)
var src = app.activeDocument;
var dup = src.duplicate('inkstudio-export', true);
if (typeof CROP != 'undefined') { app.preferences.rulerUnits = Units.PIXELS; dup.crop(CROP); } else dup.resizeImage(UnitValue(1200, 'px'), null, 72, ResampleMethod.BICUBIC);
var o = new PNGSaveOptions(); dup.saveAs(new File(OUT_PATH), o, true); dup.close(SaveOptions.DONOTSAVECHANGES);
app.activeDocument = src; 'exported';
