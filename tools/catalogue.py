"""Index a brush library: <library>/<pack>/**/*.abr -> <library>/.inkstudio/catalog.json + tips/ + covers/.
Usage: catalogue.py <library_dir> [envato_meta.json] [covers_dir]
Optional Envato metadata (title/author/description/tags) and cover images are matched by pack folder name."""
import sys, os, json, re, hashlib
sys.path.insert(0, os.path.dirname(__file__))
import abr, abrdesc
from PIL import Image, ImageOps
import shutil
ONLY = None
if '--only' in sys.argv:
    i = sys.argv.index('--only'); ONLY = set(sys.argv[i+1].split(',')); del sys.argv[i:i+2]
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
    if ONLY is not None and d not in ONLY: continue
    files = []
    for root, _, fs in os.walk(pd):
        for f in sorted(fs):
            if not f.lower().endswith('.abr'): continue
            p = os.path.join(root, f)
            if '/.inkstudio' in p: continue
            try: r = abr.read(p)
            except Exception as e: r = {'version': 0, 'names': [], 'samples': {}}
            nm = list(dict.fromkeys(r['names']))
            # full preset settings: exact names in file order + a pen profile per brush
            try: pres = abrdesc.presets(p)
            except Exception: pres = []
            profs = {}
            if pres:
                pn = [abrdesc.clean_name(x.get('Nm', '')) for x in pres]
                if len(set(pn)) == len(pn) and all(pn): nm = pn
                for x, n2 in zip(pres, pn): profs[n2] = abrdesc.profile(x)
            real = [n for n in nm if not re.match(r'(?i)sampled brush \d+', n)]
            nm = real or nm
            key = hashlib.md5(p.encode()).hexdigest()[:10]; tips = []
            for i, im in enumerate(list(r['samples'].values())):
                t = ImageOps.invert(im); t.thumbnail((96, 96)); fn = f'tips/{key}_{i}.png'; t.save(f'{out}/{fn}', optimize=True); tips.append(fn)
            files.append({'file': os.path.relpath(p, lib), 'version': r['version'], 'brushes': nm, 'count': max(len(nm), len(r['samples'])), 'tips': tips, 'pen': [profs.get(n2) for n2 in nm]})
    m = meta.get(d) or next((v for k, v in meta.items() if d.startswith(k) or k.startswith(d)), None)
    pj = os.path.join(pd, 'pack.json')   # a pack can describe itself: {title, author, description, tags}
    if os.path.exists(pj):
        try: m = {**(m or {'id': None}), **json.load(open(pj))}
        except Exception: pass
    covers = []
    if m and cov:
        for i in range(4):
            src = f"{cov}/{m.get('id')}_{i}.jpg"
            if os.path.exists(src):
                im = Image.open(src).convert('RGB'); im.thumbnail((480, 320)); fn = f"covers/{d}_{i}.jpg"; im.save(f'{out}/{fn}', quality=82); covers.append(fn)
    packs.append({'covers': covers, 'id': d, 'title': (m.get('title') if m else None) or d.replace('-', ' ').title(), 'author': m and m.get('author'),
                  'description': m and m.get('description'), 'tags': m and m.get('tags'), 'builtin': bool(m and m.get('builtin')), 'envato': m and m.get('id'),
                  'files': files, 'count': sum(f['count'] for f in files)})
    print(d, packs[-1]['count'], 'meta' if m else 'NOMETA', flush=True)
# keep rendered stroke previews from the previous catalogue where a file's brush names are unchanged
if os.path.exists(f'{out}/catalog.json'):
    prev = {p['id']: p for p in json.load(open(f'{out}/catalog.json'))['packs']}
    for p in packs:
        o = prev.get(p['id'])
        if not o: continue
        of = {f['file']: f for f in o['files']}
        for f in p['files']:
            if f['file'] in of and of[f['file']].get('strokes') and of[f['file']]['brushes'] == f['brushes']:
                f['strokes'] = of[f['file']]['strokes']
if ONLY is not None and os.path.exists(f'{out}/catalog.json'):   # merge re-indexed packs into the existing catalogue
    old = json.load(open(f'{out}/catalog.json'))['packs']; new = {p['id']: p for p in packs}
    packs = [new.pop(p['id'], p) for p in old] + list(new.values()); packs.sort(key=lambda p: p['id'])
tmp = f'{out}/catalog.json.tmp'; json.dump({'packs': packs}, open(tmp, 'w'), indent=1); os.replace(tmp, f'{out}/catalog.json')
print('PACKS', len(packs), 'BRUSHES', sum(p['count'] for p in packs))
