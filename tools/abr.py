"""Minimal Photoshop .abr (v6+) reader: brush names + sampled tip images."""
import struct, re, sys, os
from PIL import Image

def sections(b):
    i = 4
    while i + 12 <= len(b):
        if b[i:i+4] != b'8BIM': break
        key = b[i+4:i+8]; ln = struct.unpack('>I', b[i+8:i+12])[0]
        yield key, i+12, ln
        i += 12 + ln + ((4 - ln % 4) % 4)

def packbits(data, pos, n):
    out = bytearray()
    while len(out) < n and pos < len(data):
        c = data[pos]; pos += 1
        if c > 128:
            out += bytes([data[pos]]) * (257 - c); pos += 1
        elif c < 128:
            out += data[pos:pos+c+1]; pos += c + 1
    return bytes(out[:n]), pos

def samples(b, sub, off, ln):
    end = off + ln; i = off; out = {}
    while i + 4 < end:
        sz = struct.unpack('>I', b[i:i+4])[0]; i += 4; nxt = i + sz + ((4 - sz % 4) % 4)
        idl = b[i]; uid = b[i+1:i+1+idl].decode('latin1')
        p = i + 1 + idl + (8 if sub == 1 else 8 + 256)  # skip to bounds
        try:
            t, l, bo, r = struct.unpack('>4i', b[p:p+16]); depth = struct.unpack('>H', b[p+16:p+18])[0]; comp = b[p+18]
            w, h = r - l, bo - t; p += 19
            if 0 < w < 10000 and 0 < h < 10000 and depth == 8:
                if comp == 0: px = b[p:p+w*h]
                else:
                    p += 2 * h; px = bytearray()
                    for _ in range(h):
                        row, p = packbits(b, p, w); px += row
                out[uid] = Image.frombytes('L', (w, h), bytes(px[:w*h]).ljust(w*h, b'\0'))
        except Exception: pass
        i = nxt
    return out

def names(b, off, ln):
    d = b[off:off+ln]; res = []
    for m in re.finditer(rb'Nm  TEXT(....)', d):
        n = struct.unpack('>I', m.group(1))[0]
        s = d[m.end():m.end()+2*n].decode('utf-16-be', 'ignore').rstrip('\0')
        res.append(s)
    return res

def read(path, with_images=True):
    b = open(path, 'rb').read()
    ver, sub = struct.unpack('>HH', b[:4])
    if ver < 6: return {'version': ver, 'names': [], 'samples': {}}
    nm, sm = [], {}
    for k, o, l in sections(b):
        if k == b'desc': nm = names(b, o, l)
        elif k == b'samp' and with_images: sm = samples(b, sub, o, l)
    return {'version': ver, 'names': nm, 'samples': sm}

if __name__ == '__main__':
    r = read(sys.argv[1]); print(r['version'], len(r['names']), len(r['samples'])); print(r['names'][:10])
    os.makedirs(sys.argv[2], exist_ok=True) if len(sys.argv) > 2 else None
    for i, (k, im) in enumerate(list(r['samples'].items())[:6]):
        if len(sys.argv) > 2: im.save(f'{sys.argv[2]}/{i}.png')
