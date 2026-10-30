#!/usr/bin/env python3
"""Convert one skinned FBX character from assets/ into a runtime GLB (+ metadata JSON).

Needs only numpy (no Blender, no FBX SDK). The original FBX and texture are never modified.

    python3 tools/fbx_to_glb.py \
        "assets/Fantasy_Heroes_Free/FBX/Characters/Hero.fbx" \
        "assets/Fantasy_Heroes_Free/Texture/Texture.png" \
        public/models/hero.glb [--no-animations]

What it does:
  * reads the FBX hierarchy (FBX Lcl TRS, XYZ Euler order), mesh, skin clusters and UVs
  * un-welds corner normals/UVs into an indexed glTF mesh, keeps the 4 strongest bone
    influences per vertex and renormalises them (the FBX has up to 8, un-normalised)
  * lifts the model so the lowest vertex sits exactly on y = 0 (sole on the ground)
  * embeds the original PNG texture unchanged and uses NEAREST sampling (palette texture)
  * optionally adds the procedurally authored Idle/Walk/Run clips from tools/gait.py,
    because the source FBX files contain NO animation data at all
"""
import json
import math
import os
import sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fbx_scene
from glb_writer import GlbBuilder, FLOAT, USHORT, UINT, UBYTE, ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER
from qmath import mat3_to_quat


def build_rig(sc, lift):
    """Return dict with node list, joint list, global bind matrices (lifted)."""
    g = fbx_scene.global_matrices(sc)
    P = np.eye(4)
    P[1, 3] = lift
    for r in sc.roots:
        pass
    return g, P


def convert(fbx_path, png_path, out_path, with_animations=True):
    sc = fbx_scene.load(fbx_path)
    meshes = [m for m in sc.meshes if m.skin]
    if not meshes:
        raise SystemExit('no skinned mesh found')
    g = fbx_scene.global_matrices(sc)

    # ---- bind-pose world vertices of every skinned mesh (a character may be split into body + armour / weapon
    # parts that share one skeleton and one texture; they are merged into a single glTF primitive)
    world_parts, n_rots = [], []
    for mesh in meshes:
        Mg = g[mesh.model_uid]
        world_parts.append((Mg[:3, :3] @ mesh.vertices.T).T + Mg[:3, 3])
        n_rots.append(Mg[:3, :3])  # pure rotation for these assets (checked below)
        if abs(np.linalg.det(Mg[:3, :3]) - 1.0) > 1e-4:
            raise SystemExit('mesh node %s has scale/mirroring; not supported by this converter' % mesh.name)
    offsets = np.cumsum([0] + [len(p) for p in world_parts])
    world_v = np.concatenate(world_parts)
    # lift so the lowest vertex (sole) is at y = 0
    lift = float(-world_v[:, 1].min())
    world_v[:, 1] += lift
    mesh = meshes[0]  # the body (first) mesh names the glTF mesh/node

    # ---- node table: every FBX Model except the mesh model itself
    bone_uids = [u for u in sc.order if sc.bones[u].kind.split('\x00')[0] != 'Mesh']
    node_index = {u: i for i, u in enumerate(bone_uids)}
    joint_uids = [u for u in bone_uids if sc.bones[u].kind.split('\x00')[0] == 'LimbNode']
    joint_index = {u: i for i, u in enumerate(joint_uids)}
    skel_roots = [u for u in sc.roots if u in node_index]
    if len(skel_roots) != 1:
        raise SystemExit('expected a single skeleton root, found %d' % len(skel_roots))

    nodes = []
    for u in bone_uids:
        b = sc.bones[u]
        m = b.local_matrix()
        if u == skel_roots[0]:
            m = np.array(m)
            m[1, 3] += 0.0  # root keeps its own transform; lift applied to world below
            lift_m = np.eye(4)
            lift_m[1, 3] = lift
            m = lift_m @ m
        q = mat3_to_quat(m[:3, :3] / np.linalg.norm(m[:3, :3], axis=0))
        s = np.linalg.norm(m[:3, :3], axis=0)
        node = {'name': b.name}
        if not np.allclose(m[:3, 3], 0):
            node['translation'] = [float(x) for x in m[:3, 3]]
        if abs(q[3]) < 0.999999:
            node['rotation'] = [float(x) for x in q]
        if not np.allclose(s, 1.0, atol=1e-6):
            node['scale'] = [float(x) for x in s]
        kids = [node_index[c] for c in b.children if c in node_index]
        if kids:
            node['children'] = kids
        nodes.append(node)

    # lifted global bind matrices for joints
    lift_m = np.eye(4)
    lift_m[1, 3] = lift
    ibm = []
    for u in joint_uids:
        ibm.append(np.linalg.inv(lift_m @ g[u]).T.ravel())  # glTF is column-major
    # ---- unweld + triangulate
    corner_key = {}
    pos_out, nrm_out, uv_out, src_vertex = [], [], [], []
    indices = []
    for mi, m in enumerate(meshes):
        n_rot = n_rots[mi]
        for poly, corners in zip(m.polys, m.poly_corner):
            tri_corners = [(0, i, i + 1) for i in range(1, len(poly) - 1)]
            for tri in tri_corners:
                for t in tri:
                    vid, cid = poly[t], corners[t]
                    n = m.normals[cid] if m.normals is not None else (0, 1, 0)
                    uv = m.uvs[cid] if m.uvs is not None else (0, 0)
                    gid = int(offsets[mi]) + vid  # vertex id in the merged vertex list
                    key = (gid, tuple(np.round(n, 5)), tuple(np.round(uv, 6)))
                    idx = corner_key.get(key)
                    if idx is None:
                        idx = len(pos_out)
                        corner_key[key] = idx
                        pos_out.append(world_v[gid])
                        nrm = n_rot @ np.asarray(n)
                        nrm_out.append(nrm / (np.linalg.norm(nrm) or 1))
                        uv_out.append((uv[0], 1.0 - uv[1]))  # FBX origin bottom-left -> glTF top-left
                        src_vertex.append(gid)
                    indices.append(idx)
    pos_out = np.array(pos_out)
    nrm_out = np.array(nrm_out)
    uv_out = np.array(uv_out)
    src_vertex = np.array(src_vertex)

    # ---- skin weights: top-4 per source vertex, renormalised
    per_vertex = [[] for _ in range(len(world_v))]
    for mi, m in enumerate(meshes):
        for buid, idx, w, _, _ in m.skin:
            j = joint_index[buid]
            for vi, wi in zip(idx, w):
                if wi > 0:
                    per_vertex[int(offsets[mi]) + vi].append((wi, j))
    joints4 = np.zeros((len(world_v), 4), dtype=np.uint16)
    weights4 = np.zeros((len(world_v), 4), dtype=np.float32)
    dropped = 0.0
    for vi, lst in enumerate(per_vertex):
        lst.sort(reverse=True)
        total = sum(w for w, _ in lst) or 1.0
        top = lst[:4]
        dropped = max(dropped, 1.0 - sum(w for w, _ in top) / total)
        s = sum(w for w, _ in top) or 1.0
        for k, (w, j) in enumerate(top):
            joints4[vi, k] = j
            weights4[vi, k] = w / s
    unweighted = [vi for vi, lst in enumerate(per_vertex) if not lst]
    if unweighted:
        raise SystemExit('%d vertices have no skin weights' % len(unweighted))

    # ---- assemble glTF
    gb = GlbBuilder()
    nverts = len(pos_out)
    idx_comp = USHORT if nverts < 65535 else UINT
    attrs = {
        'POSITION': gb.accessor(pos_out, FLOAT, 'VEC3', ARRAY_BUFFER, minmax=True),
        'NORMAL': gb.accessor(nrm_out, FLOAT, 'VEC3', ARRAY_BUFFER),
        'TEXCOORD_0': gb.accessor(uv_out, FLOAT, 'VEC2', ARRAY_BUFFER),
        'JOINTS_0': gb.accessor(joints4[src_vertex], USHORT, 'VEC4', ARRAY_BUFFER),
        'WEIGHTS_0': gb.accessor(weights4[src_vertex], FLOAT, 'VEC4', ARRAY_BUFFER),
    }
    idx_acc = gb.accessor(np.array(indices), idx_comp, 'SCALAR', ELEMENT_ARRAY_BUFFER)
    ibm_acc = gb.accessor(np.array(ibm), FLOAT, 'MAT4')

    png = open(png_path, 'rb').read()
    img_view = gb.image(png)

    mesh_node_index = len(nodes)
    root_nodes = [node_index[skel_roots[0]], mesh_node_index]
    nodes.append({'name': sc.bones[mesh.model_uid].name, 'mesh': 0, 'skin': 0})

    gltf = {
        'scene': 0,
        'scenes': [{'name': 'Scene', 'nodes': root_nodes}],
        'nodes': nodes,
        'meshes': [{'name': mesh.name, 'primitives': [{'attributes': attrs, 'indices': idx_acc, 'material': 0, 'mode': 4}]}],
        'skins': [{'name': 'Armature', 'joints': [node_index[u] for u in joint_uids],
                   'skeleton': node_index[skel_roots[0]], 'inverseBindMatrices': ibm_acc}],
        'materials': [{'name': 'Palette', 'pbrMetallicRoughness': {
            'baseColorTexture': {'index': 0}, 'metallicFactor': 0.0, 'roughnessFactor': 1.0}}],
        'textures': [{'sampler': 0, 'source': 0}],
        'samplers': [{'magFilter': 9728, 'minFilter': 9728, 'wrapS': 33071, 'wrapT': 33071}],
        'images': [{'bufferView': img_view, 'mimeType': 'image/png', 'name': os.path.basename(png_path)}],
    }

    meta = {
        'source': os.path.relpath(fbx_path).replace('\\', '/'),
        'texture': os.path.relpath(png_path).replace('\\', '/'),
        'height': float(world_v[:, 1].max()),
        'liftApplied': lift,
        'forward': '+Z (glTF convention; verified from toe-ankle vector)',
        'joints': [sc.bones[u].name for u in joint_uids],
        'vertices': nverts,
        'triangles': len(indices) // 3,
        'maxDroppedWeightFraction': dropped,
        'clips': {},
    }

    if with_animations:
        import gait
        rig = gait.Rig.from_scene(sc, g, lift, node_index)
        anims, clip_meta = gait.build_all(rig)
        gltf['animations'] = []
        for a in anims:
            samplers, channels = [], []
            t_acc = gb.accessor(a['times'], FLOAT, 'SCALAR', minmax=True)
            for bone, tr in a['tracks'].items():
                node = rig.node_index[bone]
                if 'rotation' in tr:
                    samplers.append({'input': t_acc, 'output': gb.accessor(tr['rotation'], FLOAT, 'VEC4'), 'interpolation': 'LINEAR'})
                    channels.append({'sampler': len(samplers) - 1, 'target': {'node': node, 'path': 'rotation'}})
                if 'translation' in tr:
                    samplers.append({'input': t_acc, 'output': gb.accessor(tr['translation'], FLOAT, 'VEC3'), 'interpolation': 'LINEAR'})
                    channels.append({'sampler': len(samplers) - 1, 'target': {'node': node, 'path': 'translation'}})
            gltf['animations'].append({'name': a['name'], 'samplers': samplers, 'channels': channels})
        meta['clips'] = clip_meta

    data = gb.build(gltf)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'wb') as f:
        f.write(data)
    meta_path = os.path.splitext(out_path)[0] + '.meta.json'
    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=2)
    print('wrote', out_path, len(data), 'bytes;', nverts, 'vertices,', len(indices) // 3, 'triangles,',
          len(joint_uids), 'joints, lift', round(lift, 4), '| max dropped weight', round(dropped, 4))
    print('wrote', meta_path)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 3:
        raise SystemExit(__doc__)
    convert(args[0], args[1], args[2], with_animations='--no-animations' not in sys.argv)
