"""Read the full settings of every brush preset in a .abr file (the 'desc' section, Photoshop's ActionDescriptor
binary format) - no Photoshop needed. Keys come out as Photoshop string IDs where known, else 4-char codes.
Usage: abrdesc.py <file.abr> [index]   -> prints the presets (or one) as JSON"""
import struct, json, sys

class R:
    def __init__(s, b, p=0): s.b, s.p = b, p
    def u32(s): v = struct.unpack('>I', s.b[s.p:s.p+4])[0]; s.p += 4; return v
    def i32(s): v = struct.unpack('>i', s.b[s.p:s.p+4])[0]; s.p += 4; return v
    def f64(s): v = struct.unpack('>d', s.b[s.p:s.p+8])[0]; s.p += 8; return v
    def raw(s, n): v = s.b[s.p:s.p+n]; s.p += n; return v
    def key(s):
        n = s.u32()
        return s.raw(4 if n == 0 else n).decode('latin1').strip()
    def ustr(s):
        n = s.u32(); v = s.raw(2 * n).decode('utf-16-be', 'ignore').rstrip('\0'); return v

UNITS = {'#Ang': 'angle', '#Rsl': 'density', '#Rlt': 'distance', '#Nne': 'none', '#Prc': 'percent', '#Pxl': 'pixels',
         '#Pnt': 'points', '#Mlm': 'mm'}

def value(r, t):
    if t in ('Objc', 'GlbO'): return obj(r)
    if t == 'VlLs': n = r.u32(); return [value(r, r.raw(4).decode('latin1')) for _ in range(n)]
    if t == 'doub': return r.f64()
    if t == 'UntF': u = r.raw(4).decode('latin1'); return {'unit': UNITS.get(u, u), 'value': r.f64()}
    if t == 'UnFl': u = r.raw(4).decode('latin1'); n = r.u32(); return {'unit': UNITS.get(u, u), 'values': [r.f64() for _ in range(n)]}
    if t == 'TEXT': return r.ustr()
    if t == 'enum': return {'enumType': r.key(), 'value': r.key()}
    if t == 'long': return r.i32()
    if t == 'comp': return struct.unpack('>q', r.raw(8))[0]
    if t == 'bool': return bool(r.raw(1)[0])
    if t in ('type', 'GlbC'): r.ustr(); return {'class': r.key()}
    if t == 'tdta': n = r.u32(); r.raw(n); return {'rawdata': n}
    if t == 'alis': n = r.u32(); r.raw(n); return {'alias': n}
    if t == 'Pth ': n = r.u32(); r.raw(n); return {'path': n}
    if t == 'obj ':
        n = r.u32(); items = []
        for _ in range(n):
            rt = r.raw(4).decode('latin1')
            if rt == 'prop': r.ustr(); c = r.key(); k = r.key(); items.append({'prop': k, 'class': c})
            elif rt == 'Clss': r.ustr(); items.append({'class': r.key()})
            elif rt == 'Enmr': r.ustr(); c = r.key(); et = r.key(); ev = r.key(); items.append({'class': c, 'enum': ev})
            elif rt == 'rele': r.ustr(); c = r.key(); items.append({'class': c, 'offset': r.i32()})
            elif rt == 'Idnt': items.append({'id': r.i32()})
            elif rt == 'indx': items.append({'index': r.i32()})
            elif rt == 'name': r.ustr(); c = r.key(); items.append({'class': c, 'name': r.ustr()})
            else: raise ValueError('ref ' + rt)
        return {'ref': items}
    raise ValueError('type %r at %d' % (t, r.p))

def obj(r):
    name = r.ustr(); cls = r.key(); n = r.u32(); d = {'_class': cls}
    if name: d['_name'] = name
    for _ in range(n):
        k = r.key(); t = r.raw(4).decode('latin1')
        d[k] = value(r, t)
    return d

def presets(path):
    """All brush presets of a .abr (v6+) with their full settings, in file order."""
    b = open(path, 'rb').read()
    if struct.unpack('>H', b[:2])[0] < 6: return []
    i = 4
    while i + 12 <= len(b) and b[i:i+4] == b'8BIM':
        k = b[i+4:i+8]; ln = struct.unpack('>I', b[i+8:i+12])[0]
        if k == b'desc':
            r = R(b, i + 12); r.u32()          # descriptor version (16)
            top = obj(r)
            lst = top.get('Brsh') or next((v for v in top.values() if isinstance(v, list)), [])
            return [p for p in lst if isinstance(p, dict)]
        i += 12 + ln + ((4 - ln % 4) % 4)
    return []

if __name__ == '__main__':
    ps = presets(sys.argv[1])
    print(len(ps), 'presets')
    if len(sys.argv) > 2: print(json.dumps(ps[int(sys.argv[2])], indent=1)[:6000])
    else: print(json.dumps(ps[0], indent=1)[:4000])

# ---- pen profile: what a preset does with the pen, in plain terms (used by the catalogue and the panel) ----
CONTROL = {1: 'fade', 2: 'pressure', 3: 'tilt', 4: 'stylus wheel', 5: 'initial direction', 6: 'direction',
           7: 'initial rotation', 8: 'rotation', 9: 'control 9'}   # stored values, see docs/brush-settings-reference.md
DYN = {'szVr': 'size', 'opVr': 'opacity', 'prVr': 'flow', 'angleDynamics': 'angle', 'roundnessDynamics': 'roundness',
       'textureDepthDynamics': 'grain depth', 'scatterDynamics': 'scatter', 'countDynamics': 'dab count',
       'clVr': 'colour', 'wtVr': 'wetness', 'mxVr': 'mix'}

def _pct(v): return v.get('value') if isinstance(v, dict) else v

def profile(p):
    out = {'drives': {}, 'random': {}, 'tip': None, 'hidden': [], 'tool': None}
    b = p.get('Brsh', {}) if isinstance(p.get('Brsh'), dict) else {}
    out['tip'] = {'sampledBrush': 'image', 'computedBrush': 'round', 'dBrush': 'bristle', 'dTips': 'erodible'}.get(b.get('_class'), b.get('_class'))
    if b.get('_class') == 'dTips' and b.get('dtipsType') == 1: out['tip'] = 'airbrush'   # dtipsType 0 erodible, 1 airbrush
    for sect in (p, p.get('dualBrush') if isinstance(p.get('dualBrush'), dict) else {}):
        for k, label in DYN.items():
            v = sect.get(k)
            if not isinstance(v, dict): continue
            lab = label if sect is p else 'dual ' + label
            if v.get('bVTy'): out['drives'].setdefault(CONTROL.get(v['bVTy'], str(v['bVTy'])), []).append(lab)
            if (_pct(v.get('jitter')) or 0) > 0: out['random'][lab] = _pct(v.get('jitter'))
    if p.get('useTipDynamics') is False: out['drives'] = {c: [x for x in ls if x not in ('size', 'angle', 'roundness')] for c, ls in out['drives'].items()}
    if out['tip'] == 'bristle': out['hidden'].append('bristle physics: pressure and tilt spread the bristles (denser, wider, darker)')
    if out['tip'] == 'erodible': out['hidden'].append('erodible tip: wears flat as you draw; pressure widens it')
    if out['tip'] == 'airbrush': out['hidden'].append('airbrush tip: sprays; light pressure spreads widest, tilt stretches the spray')
    if p.get('useBrushPose') and p.get('overridePosePressure'): out['hidden'].append('brush pose overrides pen pressure with a fixed value (%s)' % _pct(p.get('brushPosePressure')))
    if p.get('useBrushPose') and (p.get('overridePoseTiltX') or p.get('overridePoseTiltY') or p.get('overridePoseAngle')): out['hidden'].append('brush pose overrides pen tilt/angle')
    if p.get('useColorDynamics'): out['hidden'].append('colour dynamics: hue/brightness vary %s' % ('per dab' if p.get('colorDynamicsPerTip') else 'per stroke'))
    if p.get('Wtdg'): out['hidden'].append('wet edges: pigment pools at the stroke edge')
    if p.get('Rpt'): out['hidden'].append('build-up (airbrush): paint keeps flowing while the pen rests')
    if p.get('Nose'): out['hidden'].append('noise on soft edges')
    if p.get('useTexture'): out['hidden'].append('own paper grain (%s)' % ((p.get('textureBlendMode') or {}).get('value')))
    if isinstance(p.get('dualBrush'), dict) and p['dualBrush'].get('useDualBrush'): out['hidden'].append('dual brush: a second tip cuts into the first')
    to = p.get('toolOptions')
    if isinstance(to, dict):
        tool = {'PbTl': 'brush', 'SmTl': 'smudge', 'ErTl': 'eraser', 'wetBrushTool': 'mixer brush', 'MixB': 'mixer brush', 'PcTl': 'pencil', 'ABTl': 'art history brush'}.get(to.get('_class'), to.get('_class'))
        out['tool'] = tool
        if tool not in ('brush', None): out['hidden'].append('switches the tool to ' + tool)
        for k, label in DYN.items():   # tool-level dynamics travel with the preset too
            v = to.get(k)
            if isinstance(v, dict) and v.get('bVTy'): out['drives'].setdefault(CONTROL.get(v['bVTy'], str(v['bVTy'])), []).append('tool ' + label)
            if isinstance(v, dict) and (_pct(v.get('jitter')) or 0) > 0: out['random']['tool ' + label] = _pct(v.get('jitter'))
        fl = to.get('flow') if 'flow' in to else to.get('Prs')
        if isinstance(fl, (int, float)) and fl < 100: out['hidden'].append('%s %d%%' % ('flow' if 'flow' in to else 'strength', fl))
    if (_pct(p.get('minimumDiameter')) or 0) > 0 and 'size' in sum(out['drives'].values(), []): out['hidden'].append('never thinner than %d%%' % _pct(p['minimumDiameter']))
    return out

def clean_name(n):
    import re
    if n.startswith('$$$/') and '=' in n: n = n.split('=', 1)[1]
    return n
