"""Extract a skinned-character scene (hierarchy, meshes, skin, texture) from an FBX."""
import math
import os
import numpy as np
from fbx_parse import parse, find


def euler_xyz_to_matrix(rx, ry, rz):
    """FBX default rotation order eEulerXYZ in degrees -> 3x3 (column-vector, R = Rz*Ry*Rx)."""
    ax, ay, az = (math.radians(v) for v in (rx, ry, rz))
    cx, sx, cy, sy, cz, sz = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay), math.cos(az), math.sin(az)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


class Bone:
    def __init__(self, uid, name, kind):
        self.uid, self.name, self.kind = uid, name, kind
        self.t = np.zeros(3)
        self.rot = np.eye(3)
        self.s = np.ones(3)
        self.parent = None  # uid
        self.children = []
        self.pre = np.eye(3)

    def local_matrix(self):
        m = np.eye(4)
        m[:3, :3] = self.pre @ self.rot @ np.diag(self.s)
        m[:3, 3] = self.t
        return m


class Mesh:
    def __init__(self):
        self.model_uid = None
        self.name = ''
        self.vertices = None      # (n,3) mesh-local
        self.polys = []           # list of lists of vertex ids
        self.poly_corner = []     # list of lists of corner indices into the by-polygon-vertex arrays
        self.normals = None       # (corners,3)
        self.uvs = None           # (corners,2)
        self.skin = []            # list of (bone_uid, indexes, weights, transform, transform_link)


class Scene:
    pass


def _props(node):
    out = {}
    p70 = find(node[2], 'Properties70')
    if p70:
        for p in p70[0][2]:
            out[p[1][0]] = p[1][4:]
    return out


def _corner_values(layer, nvals_per, ncorners, polys_corner_to_vertex):
    """Resolve a LayerElement into one value row per polygon corner."""
    d = {c[0]: c[1] for c in layer[2]}
    mapping = d['MappingInformationType'][0]
    ref = d['ReferenceInformationType'][0]
    key = 'Normals' if layer[0] == 'LayerElementNormal' else 'UV'
    data = np.array(d[key][0], dtype=np.float64).reshape(-1, nvals_per)
    if ref == 'IndexToDirect':
        idx = np.array(d[key + 'Index'][0], dtype=np.int64)
        if mapping == 'ByPolygonVertex':
            return data[idx]
        if mapping in ('ByVertice', 'ByVertex'):
            return data[idx][polys_corner_to_vertex]
        raise ValueError('unsupported mapping ' + mapping)
    if mapping == 'ByPolygonVertex':
        return data
    if mapping in ('ByVertice', 'ByVertex'):
        return data[polys_corner_to_vertex]
    raise ValueError('unsupported mapping ' + mapping)


def load(path):
    ver, nodes = parse(path)
    obj = find(nodes, 'Objects')[0][2]
    conns = find(nodes, 'Connections')[0][2]
    s = Scene()
    s.path = path
    s.bones = {}
    s.order = []
    for n in obj:
        if n[0] != 'Model':
            continue
        uid = n[1][0]
        name = n[1][1].split('\x00')[0]
        kind = n[1][2]
        b = Bone(uid, name, kind)
        pr = _props(n)
        if 'Lcl Translation' in pr:
            b.t = np.array(pr['Lcl Translation'][:3], dtype=np.float64)
        if 'Lcl Rotation' in pr:
            b.rot = euler_xyz_to_matrix(*pr['Lcl Rotation'][:3])
        if 'Lcl Scaling' in pr:
            b.s = np.array(pr['Lcl Scaling'][:3], dtype=np.float64)
        if 'PreRotation' in pr:
            b.pre = euler_xyz_to_matrix(*pr['PreRotation'][:3])
        if 'RotationOrder' in pr and pr['RotationOrder'][0] not in (0, None):
            raise ValueError('%s: non-XYZ rotation order unsupported' % name)
        s.bones[uid] = b
        s.order.append(uid)
    geoms, deformers, clusters, materials, textures, videos = {}, {}, {}, {}, {}, {}
    for n in obj:
        uid = n[1][0] if n[1] else None
        if n[0] == 'Geometry':
            geoms[uid] = n
        elif n[0] == 'Deformer':
            (deformers if n[1][2] == 'Skin' else clusters)[uid] = n
        elif n[0] == 'Material':
            materials[uid] = n
        elif n[0] == 'Texture':
            textures[uid] = n
        elif n[0] == 'Video':
            videos[uid] = n
    # hierarchy + connection maps
    src_to_dst = {}
    for c in conns:
        kind, a, b = c[1][0], c[1][1], c[1][2]
        src_to_dst.setdefault(a, []).append((kind, b, c[1][3] if len(c[1]) > 3 else None))
        if kind == 'OO' and a in s.bones and b in s.bones:
            s.bones[a].parent = b
            s.bones[b].children.append(a)
    s.roots = [u for u in s.order if s.bones[u].parent is None]
    # meshes
    s.meshes = []
    model_for_geom = {}
    for a, lst in src_to_dst.items():
        if a in geoms:
            for kind, b, _ in lst:
                if b in s.bones:
                    model_for_geom[a] = b
    for guid, g in geoms.items():
        m = Mesh()
        m.model_uid = model_for_geom.get(guid)
        m.name = g[1][1].split('\x00')[0]
        ch = {c[0]: c for c in g[2]}
        m.vertices = np.array(ch['Vertices'][1][0], dtype=np.float64).reshape(-1, 3)
        pvi = list(ch['PolygonVertexIndex'][1][0])
        cur, corners, polys, pcorners = [], [], [], []
        for i, v in enumerate(pvi):
            end = v < 0
            cur.append(~v if end else v)
            corners.append(i)
            if end:
                polys.append(cur)
                pcorners.append(corners)
                cur, corners = [], []
        m.polys, m.poly_corner = polys, pcorners
        corner_vertex = np.array([(~v if v < 0 else v) for v in pvi], dtype=np.int64)
        layer_n = [c for c in g[2] if c[0] == 'LayerElementNormal']
        layer_u = [c for c in g[2] if c[0] == 'LayerElementUV']
        m.normals = _corner_values(layer_n[0], 3, len(pvi), corner_vertex) if layer_n else None
        m.uvs = _corner_values(layer_u[0], 2, len(pvi), corner_vertex) if layer_u else None
        s.meshes.append(m)
    # skin: geometry <- skin <- clusters <- bone
    skin_for_geom = {}
    cluster_for_skin = {}
    bone_for_cluster = {}
    for a, lst in src_to_dst.items():
        for kind, b, _ in lst:
            if a in deformers and b in geoms:
                skin_for_geom[b] = a
            if a in clusters and b in deformers:
                cluster_for_skin.setdefault(b, []).append(a)
            if a in s.bones and b in clusters:
                bone_for_cluster[b] = a
    for guid, m in zip(geoms.keys(), s.meshes):
        skin = skin_for_geom.get(guid)
        if skin is None:
            continue
        for cu in cluster_for_skin.get(skin, []):
            cn = clusters[cu]
            cc = {c[0]: c for c in cn[2]}
            if 'Indexes' not in cc:
                continue
            idx = np.array(cc['Indexes'][1][0], dtype=np.int64)
            w = np.array(cc['Weights'][1][0], dtype=np.float64)
            T = np.array(cc['Transform'][1][0], dtype=np.float64).reshape(4, 4).T
            TL = np.array(cc['TransformLink'][1][0], dtype=np.float64).reshape(4, 4).T
            m.skin.append((bone_for_cluster[cu], idx, w, T, TL))
    # texture file (first Video/Texture)
    s.texture_file = None
    for v in videos.values():
        for c in v[2]:
            if c[0] in ('RelativeFilename', 'FileName') and c[1] and c[1][0]:
                s.texture_file = c[1][0]
                break
    if s.texture_file is None:
        for t in textures.values():
            for c in t[2]:
                if c[0] in ('RelativeFilename', 'FileName') and c[1] and c[1][0]:
                    s.texture_file = c[1][0]
    gs = find(nodes, 'GlobalSettings')
    s.unit_scale = 1.0
    if gs:
        p70 = find(gs[0][2], 'Properties70')
        if p70:
            for p in p70[0][2]:
                if p[1][0] == 'UnitScaleFactor':
                    s.unit_scale = p[1][4]
    return s


def global_matrices(scene):
    g = {}

    def rec(uid, parent_m):
        m = parent_m @ scene.bones[uid].local_matrix()
        g[uid] = m
        for c in scene.bones[uid].children:
            rec(c, m)
    for r in scene.roots:
        rec(r, np.eye(4))
    return g
