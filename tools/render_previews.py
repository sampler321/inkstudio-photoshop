"""Render real stroke previews with Photoshop for packs in a catalogued library.
Usage: render_previews.py <library_dir> <pack_id> [<pack_id> ...]   (Photoshop must be running)
Writes <library>/.inkstudio/strokes/<pack>/<file#>-<brush#>.png and adds 'strokes' lists to catalog.json."""
import sys, os, json, subprocess
import time, re
WHEN_IDLE = '--when-idle' in sys.argv; sys.argv = [a for a in sys.argv if a != '--when-idle']
lib, ids = sys.argv[1], sys.argv[2:]
def idle_seconds():
    out = subprocess.run(['ioreg', '-c', 'IOHIDSystem'], capture_output=True, text=True).stdout
    m = re.search(r'HIDIdleTime"\s*=\s*(\d+)', out); return int(m.group(1)) / 1e9 if m else 0
inks = os.path.join(lib, '.inkstudio'); catp = os.path.join(inks, 'catalog.json')
jsx = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'jsx', 'render-strokes.jsx')
cat = json.load(open(catp))
def kind(p):   # stamps and effects look like their tip image; stroke brushes need a painted preview
    t = (p['title'] + ' ' + p['id']).lower()
    if 'stamp' in t: return 'stamp'
    if re.search(r'splatter|splash|stain|spray|drop|blot|texture|grunge|halftone|xresch|bokeh|effect', t): return 'effect'
    return 'stroke'
if ids == ['strokes']:
    ids = [p['id'] for p in sorted(cat['packs'], key=lambda p: p['id']) if kind(p) == 'stroke' and not all(f.get('strokes') for f in p['files'])]
    print('to render (stroke brushes only):', len(ids), 'packs', flush=True)
if ids == ['all']:   # drawing media first, stamps last, skip packs that already have previews
    def rank(p):
        t = (p['title'] + ' ' + p['id']).lower()
        return (1 if 'stamp' in t else 0, 0 if re.search(r'pencil|ink|pen|marker|watercol|gouache|oil|acrylic|charcoal|pastel|chalk|crayon|paint', t) else 1, p['id'])
    ids = [p['id'] for p in sorted(cat['packs'], key=rank) if not all(f.get('strokes') for f in p['files'])]
    print('to render:', len(ids), 'packs', flush=True)
def js(v): return json.dumps(v)
order = {i: n for n, i in enumerate(ids)}
for p in sorted(cat['packs'], key=lambda p: order.get(p['id'], 1e9)):
    if p['id'] not in ids: continue
    while WHEN_IDLE and idle_seconds() < 120: time.sleep(20)   # only while nobody is using the Mac
    for fi, f in enumerate(p['files']):
        out = os.path.join(inks, 'strokes', p['id'], str(fi)); os.makedirs(out, exist_ok=True)
        pre = f"var BRUSHES={js(f['brushes'])}; var OUT_DIR={js(out)}; "
        if not p.get('builtin'): pre += f"var LOAD_PATH={js(os.path.realpath(os.path.join(lib, f['file'])))}; "
        script = 'with timeout of 3600 seconds\ntell application id "com.adobe.Photoshop" to do javascript ' + js(pre) + ' & (read POSIX file ' + js(jsx) + ')\nend timeout'
        r = subprocess.run(['osascript', '-e', script], capture_output=True, text=True)
        print(p['id'], fi, (r.stdout or r.stderr).strip()[:300], flush=True)
        f['strokes'] = [f"strokes/{p['id']}/{fi}/{i}.png" if os.path.exists(os.path.join(out, f'{i}.png')) else None for i in range(len(f['brushes']))]
    tmp = catp + '.tmp'; json.dump(cat, open(tmp, 'w'), indent=1); os.replace(tmp, catp)
