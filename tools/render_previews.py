"""Render real stroke previews with Photoshop for packs in a catalogued library.
Usage: render_previews.py <library_dir> <pack_id> [<pack_id> ...]   (Photoshop must be running)
Writes <library>/.inkstudio/strokes/<pack>/<file#>-<brush#>.png and adds 'strokes' lists to catalog.json."""
import sys, os, json, subprocess
lib, ids = sys.argv[1], sys.argv[2:]
inks = os.path.join(lib, '.inkstudio'); catp = os.path.join(inks, 'catalog.json')
jsx = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'jsx', 'render-strokes.jsx')
cat = json.load(open(catp))
def js(v): return json.dumps(v)
for p in cat['packs']:
    if p['id'] not in ids: continue
    for fi, f in enumerate(p['files']):
        out = os.path.join(inks, 'strokes', p['id'], str(fi)); os.makedirs(out, exist_ok=True)
        pre = f"var BRUSHES={js(f['brushes'])}; var OUT_DIR={js(out)}; "
        if not p.get('builtin'): pre += f"app.load(new File({js(os.path.realpath(os.path.join(lib, f['file'])))})); "
        script = 'with timeout of 3600 seconds\ntell application id "com.adobe.Photoshop" to do javascript ' + js(pre) + ' & (read POSIX file ' + js(jsx) + ')\nend timeout'
        r = subprocess.run(['osascript', '-e', script], capture_output=True, text=True)
        print(p['id'], fi, (r.stdout or r.stderr).strip()[:300], flush=True)
        f['strokes'] = [f"strokes/{p['id']}/{fi}/{i}.png" if os.path.exists(os.path.join(out, f'{i}.png')) else None for i in range(len(f['brushes']))]
    tmp = catp + '.tmp'; json.dump(cat, open(tmp, 'w'), indent=1); os.replace(tmp, catp)
