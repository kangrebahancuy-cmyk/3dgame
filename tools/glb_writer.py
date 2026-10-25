"""Tiny dependency-free glTF 2.0 / GLB writer (numpy only) for skinned characters."""
import json
import struct
import numpy as np

FLOAT, USHORT, UINT, UBYTE = 5126, 5123, 5125, 5121
ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = 34962, 34963


class GlbBuilder:
    def __init__(self):
        self.bin = bytearray()
        self.views = []
        self.accessors = []

    def _view(self, data: bytes, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        view = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target:
            view['target'] = target
        self.bin += data
        self.views.append(view)
        return len(self.views) - 1

    def accessor(self, arr, comp, typ, target=None, minmax=False, normalized=False):
        arr = np.ascontiguousarray(arr)
        dtype = {FLOAT: '<f4', USHORT: '<u2', UINT: '<u4', UBYTE: 'u1'}[comp]
        arr = arr.astype(dtype)
        ncomp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[typ]
        count = arr.size // ncomp
        a = {'bufferView': self._view(arr.tobytes(), target), 'componentType': comp, 'count': count, 'type': typ}
        if normalized:
            a['normalized'] = True
        if minmax:
            flat = arr.reshape(count, ncomp)
            a['min'] = [float(x) for x in flat.min(0)]
            a['max'] = [float(x) for x in flat.max(0)]
        self.accessors.append(a)
        return len(self.accessors) - 1

    def image(self, png_bytes):
        return self._view(png_bytes)

    def build(self, gltf: dict) -> bytes:
        gltf = dict(gltf)
        gltf['asset'] = {'version': '2.0', 'generator': 'tools/fbx_to_glb.py (3DGAME)'}
        gltf['buffers'] = [{'byteLength': len(self.bin)}]
        gltf['bufferViews'] = self.views
        gltf['accessors'] = self.accessors
        js = json.dumps(gltf, separators=(',', ':')).encode('utf8')
        js += b' ' * ((4 - len(js) % 4) % 4)
        binc = bytes(self.bin) + b'\0' * ((4 - len(self.bin) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(binc)
        out = struct.pack('<III', 0x46546C67, 2, total)
        out += struct.pack('<II', len(js), 0x4E4F534A) + js
        out += struct.pack('<II', len(binc), 0x004E4942) + binc
        return out


def read_glb(path):
    """Return (json_dict, bin_bytes)."""
    b = open(path, 'rb').read()
    magic, ver, length = struct.unpack_from('<III', b, 0)
    assert magic == 0x46546C67 and ver == 2 and length == len(b), 'not a valid GLB 2.0'
    pos, js, binc = 12, None, b''
    while pos < len(b):
        clen, ctype = struct.unpack_from('<II', b, pos)
        pos += 8
        chunk = b[pos:pos + clen]
        pos += clen
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf8'))
        elif ctype == 0x004E4942:
            binc = chunk
    return js, binc


def read_accessor(gltf, binc, index):
    a = gltf['accessors'][index]
    v = gltf['bufferViews'][a['bufferView']]
    dtype = {FLOAT: '<f4', USHORT: '<u2', UINT: '<u4', UBYTE: 'u1'}[a['componentType']]
    ncomp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    arr = np.frombuffer(binc, dtype=dtype, count=a['count'] * ncomp, offset=off)
    return arr.reshape(a['count'], ncomp) if ncomp > 1 else arr
