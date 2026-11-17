"""Index a brush library: <library>/<pack>/**/*.abr -> <library>/.inkstudio/catalog.json + tips/ + covers/.
Usage: catalogue.py <library_dir> [envato_meta.json] [covers_dir]
Optional Envato metadata (title/author/description/tags) and cover images are matched by pack folder name."""
import sys, os, json, re, hashlib
sys.path.insert(0, os.path.dirname(__file__))
import abr
from PIL import Image, ImageOps
import shutil
lib = sys.argv[1]; meta_p = sys.argv[2] if len(sys.argv) > 2 else '-'; cov = sys.argv[3] if len(sys.argv) > 3 else None
out = os.path.join(lib, '.inkstudio'); os.makedirs(f'{out}/covers', exist_ok=True)
os.makedirs(f'{out}/tips', exist_ok=True)
meta = {}
if meta_p != '-':
    for m in json.load(open(meta_p)):
        meta[re.sub(r'[^a-z0-9]+', '-', m['title'].lower()).strip('-')] = m
packs = []
for d in sorted(os.listdir(lib)):
    pd = os.path.join(lib, d)
    if d.startswith('.') or not os.path.isdir(pd): continue
    files = []
    for root, _, fs in os.walk(pd):
        for f in sorted(fs):
            if not f.lower().endswith('.abr'): continue
            p = os.path.join(root, f)
            if '/.inkstudio' in p: continue
            try: r = abr.read(p)
            except Exception as e: r = {'version': 0, 'names': [], 'samples': {}}
            nm = list(dict.fromkeys(r['names']))
            key = hashlib.md5(p.encode()).hexdigest()[:10]; tips = []
            for i, im in enumerate(list(r['samples'].values())[:12]):
                t = ImageOps.invert(im); t.thumbnail((96, 96)); fn = f'tips/{key}_{i}.png'; t.save(f'{out}/{fn}', optimize=True); tips.append(fn)
            files.append({'file': os.path.relpath(p, lib), 'version': r['version'], 'brushes': nm, 'count': max(len(nm), len(r['samples'])), 'tips': tips})
    m = meta.get(d) or next((v for k, v in meta.items() if d.startswith(k) or k.startswith(d)), None)
    covers = []
    if m and cov:
        for i in range(4):
            src = f"{cov}/{m['id']}_{i}.jpg"
            if os.path.exists(src):
                im = Image.open(src).convert('RGB'); im.thumbnail((480, 320)); fn = f"covers/{d}_{i}.jpg"; im.save(f'{out}/{fn}', quality=82); covers.append(fn)
    packs.append({'covers': covers, 'id': d, 'title': m['title'] if m else d.replace('-', ' ').title(), 'author': m and m['author'],
                  'description': m and m['description'], 'tags': m and m['tags'], 'envato': m and m['id'],
                  'files': files, 'count': sum(f['count'] for f in files)})
    print(d, packs[-1]['count'], 'meta' if m else 'NOMETA', flush=True)
json.dump({'packs': packs}, open(f'{out}/catalog.json', 'w'), indent=1)
print('PACKS', len(packs), 'BRUSHES', sum(p['count'] for p in packs))
