"""Minimal binary-FBX (v7100-7700) node-tree parser. No external dependencies.

Only what the converter needs: nested nodes with typed properties. ASCII FBX is
not supported (every file in assets/ is binary v7400).
"""
import struct
import zlib


def _read_node(b, pos, ver):
    if ver >= 7500:
        end, nprops, plen = struct.unpack_from('<QQQ', b, pos)
        pos += 24
    else:
        end, nprops, plen = struct.unpack_from('<III', b, pos)
        pos += 12
    nlen = b[pos]
    pos += 1
    if end == 0:
        return None, pos
    name = b[pos:pos + nlen].decode('latin1')
    pos += nlen
    props = []
    for _ in range(nprops):
        t = chr(b[pos])
        pos += 1
        if t in 'YCFDIL':
            fmt = {'Y': '<h', 'C': '<?', 'F': '<f', 'D': '<d', 'I': '<i', 'L': '<q'}[t]
            props.append(struct.unpack_from(fmt, b, pos)[0])
            pos += struct.calcsize(fmt)
        elif t in 'fdilb':
            n, enc, clen = struct.unpack_from('<III', b, pos)
            pos += 12
            raw = b[pos:pos + clen]
            pos += clen
            if enc == 1:
                raw = zlib.decompress(raw)
            esz = {'f': 4, 'd': 8, 'i': 4, 'l': 8, 'b': 1}[t]
            fmt = {'f': 'f', 'd': 'd', 'i': 'i', 'l': 'q', 'b': '?'}[t]
            props.append(struct.unpack('<%d%s' % (n, fmt), raw[:n * esz]))
        elif t in 'SR':
            ln = struct.unpack_from('<I', b, pos)[0]
            pos += 4
            raw = b[pos:pos + ln]
            pos += ln
            props.append(raw.decode('latin1') if t == 'S' else raw)
        else:
            raise ValueError('unsupported FBX property type %r' % t)
    children = []
    while pos < end:
        c, pos = _read_node(b, pos, ver)
        if c is None:
            break
        children.append(c)
    return (name, props, children), end


def parse(path):
    """Return (version, [top-level nodes]); a node is (name, props, children)."""
    b = open(path, 'rb').read()
    if not b.startswith(b'Kaydara FBX Binary'):
        raise ValueError('%s is not a binary FBX file' % path)
    ver = struct.unpack_from('<I', b, 23)[0]
    pos, nodes = 27, []
    while pos < len(b) - 100:
        n, pos = _read_node(b, pos, ver)
        if n is None:
            break
        nodes.append(n)
    return ver, nodes


def find(nodes, name):
    return [n for n in nodes if n[0] == name]
