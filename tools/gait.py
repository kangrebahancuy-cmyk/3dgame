"""Procedural Idle / Walk / Run clips for the 27-bone Blender-metarig humanoid shared by every
character in assets/ (the FBX files contain NO animation data, so these clips are authored here).

Method (all in the model's glTF space: +Y up, +Z forward, +X = the character's left):
  * Leg bones use 2-bone analytic IK with a forward knee pole. During stance the ankle moves
    backwards at a constant reference speed `v_ref` (so the runtime can scale playback to ground
    speed without foot sliding); during swing a Hermite curve with matching boundary velocity
    carries it to the next touchdown, lifted along an arc.
  * Pelvis height is a soft-minimum of the reach limits of both legs (always <= the true limit, and
    continuous), so planted feet never leave the ground and there are no pops at lift-off.
  * Spine / arms use forward kinematics: a *world-axis* rotation is applied on top of the inherited
    parent orientation (local' = P^-1 * R_world * P * L_rest). This works regardless of the
    bone-local axis conventions of the rig.
  * The rest pose is a T-pose, so the arms are first lowered with a roll about the forward axis.

Output: keyframes at 60 Hz, LINEAR interpolation, last key == first key (seamless loop).
"""
import math
import numpy as np
from qmath import (mat3_to_quat, quat_to_mat3, quat_mul, quat_conj, axis_angle, make_continuous)

FPS = 60
X = np.array([1.0, 0, 0])
Y = np.array([0, 1.0, 0])
Z = np.array([0, 0, 1.0])
DEG = math.pi / 180.0
TWO_PI = 2 * math.pi


def smoothstep(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def softmin(values, k=120.0):
    m = min(values)
    return m - math.log(sum(math.exp(-k * (v - m)) for v in values)) / k


def rot_from_to(a, b):
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    d = float(np.dot(a, b))
    if d < -0.999999:
        return axis_angle(np.cross(a, X if abs(a[0]) < 0.9 else Y), math.pi)
    q = np.array([*np.cross(a, b), 1.0 + d])
    return q / np.linalg.norm(q)


def hermite(p0, p1, m0, m1, s):
    s2, s3 = s * s, s * s * s
    return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1


class Rig:
    """Hierarchy + rest pose of the character."""

    @staticmethod
    def from_scene(sc, g, lift, node_index):
        r = Rig()
        r.names, r.parent, r.rest_t, r.rest_q, r.node_index = [], {}, {}, {}, {}
        root_uid = [u for u in sc.roots if u in node_index][0]
        lift_m = np.eye(4)
        lift_m[1, 3] = lift

        def walk(u, parent_name):
            b = sc.bones[u]
            m = b.local_matrix()
            if u == root_uid:
                m = lift_m @ m
            q = mat3_to_quat(m[:3, :3] / np.linalg.norm(m[:3, :3], axis=0))
            r.names.append(b.name)
            r.parent[b.name] = parent_name
            r.rest_t[b.name] = m[:3, 3].copy()
            r.rest_q[b.name] = q
            r.node_index[b.name] = node_index[u]
            for c in b.children:
                if c in node_index:
                    walk(c, b.name)
        walk(root_uid, None)
        r.armature = r.names[0]
        r.root = 'spine'  # pelvis root bone
        r.rest_world_q, r.rest_world_p = {}, {}
        for n in r.names:
            p = r.parent[n]
            if p is None:
                wq, wp = r.rest_q[n], r.rest_t[n]
            else:
                wq = quat_mul(r.rest_world_q[p], r.rest_q[n])
                wp = r.rest_world_p[p] + quat_to_mat3(r.rest_world_q[p]) @ r.rest_t[n]
            r.rest_world_q[n], r.rest_world_p[n] = wq / np.linalg.norm(wq), wp
        return r


class Pose:
    """One evaluated frame. Bones must be set parents-first."""

    def __init__(self, rig):
        self.rig = rig
        self.local_q, self.local_t, self.wq, self.wp = {}, {}, {}, {}

    def _finish(self, n, lq, lt=None):
        rig = self.rig
        lt = rig.rest_t[n] if lt is None else lt
        p = rig.parent[n]
        if p is None:
            wq, wp = lq, lt
        else:
            wq = quat_mul(self.wq[p], lq)
            wp = self.wp[p] + quat_to_mat3(self.wq[p]) @ lt
        self.local_q[n], self.local_t[n] = lq, lt
        self.wq[n], self.wp[n] = wq / np.linalg.norm(wq), wp

    def rest(self, n):
        self._finish(n, self.rig.rest_q[n])

    def extra(self, n, r_world):
        Wp = self.wq[self.rig.parent[n]]
        self._finish(n, quat_mul(quat_mul(quat_conj(Wp), quat_mul(r_world, Wp)), self.rig.rest_q[n]))

    def absolute(self, n, w_target):
        self._finish(n, quat_mul(quat_conj(self.wq[self.rig.parent[n]]), w_target))

    def root_move(self, n, world_pos, r_world):
        p = self.rig.parent[n]
        Wp = self.wq[p]
        lt = quat_to_mat3(Wp).T @ (world_pos - self.wp[p])
        lq = quat_mul(quat_mul(quat_conj(Wp), quat_mul(r_world, Wp)), self.rig.rest_q[n])
        self._finish(n, lq, lt)


def leg_ik(H, A, l1, l2):
    d = A - H
    dist = float(np.linalg.norm(d))
    u = d / dist
    dist_c = min(max(dist, abs(l1 - l2) + 1e-3), (l1 + l2) * 0.9995)
    cosa = (l1 * l1 + dist_c * dist_c - l2 * l2) / (2 * l1 * dist_c)
    a = math.acos(min(1.0, max(-1.0, cosa)))
    p = Z - np.dot(Z, u) * u                       # knee points forward
    p = p / np.linalg.norm(p) if np.linalg.norm(p) > 1e-6 else X.copy()
    t_dir = math.cos(a) * u + math.sin(a) * p
    K = H + l1 * t_dir
    A_eff = H + u * dist_c
    s_dir = (A_eff - K) / np.linalg.norm(A_eff - K)
    return t_dir, s_dir, dist - dist_c


class Gait:
    def __init__(self, rig, name, T, v_ref, duty, lift, arm_swing, elbow, lean, pelvis_yaw, spine_twist,
                 sway, hip_margin, arm_down, flight_hop=0.0, moving=True, breathe=0.0, toe_off=0.15):
        self.rig, self.name, self.T, self.v, self.d = rig, name, T, v_ref, duty
        self.lift, self.arm_swing, self.elbow, self.lean = lift, arm_swing * DEG, elbow * DEG, lean * DEG
        self.pelvis_yaw, self.spine_twist, self.sway = pelvis_yaw * DEG, spine_twist * DEG, sway
        self.hip_margin, self.arm_down = hip_margin, arm_down * DEG
        self.flight_hop, self.moving, self.breathe, self.toe_off = flight_hop, moving, breathe, toe_off
        self.travel = v_ref * duty * T          # ankle travel during stance (m)
        w = rig.rest_world_p
        self.l1 = float(np.linalg.norm(w['shin.L'] - w['thigh.L']))
        self.l2 = float(np.linalg.norm(w['foot.L'] - w['shin.L']))
        self.pelvis_rest = w[rig.root].copy()
        self.ankle_rest = {s: w['foot.' + s].copy() for s in 'LR'}
        self.ankle_y = float(self.ankle_rest['L'][1])
        self.zc = float(self.ankle_rest['L'][2])
        self.Lr = (self.l1 + self.l2) * 0.985
        self.hip_rest_z = float(w['thigh.L'][2])
        self.diag = []

    def foot_target(self, f, x):
        d, T, v = self.d, self.T, self.v
        zf, zb = self.zc + self.travel / 2, self.zc - self.travel / 2
        if not self.moving:
            return np.array([x, self.ankle_y, self.zc]), True, 0.0
        if f < d:
            return np.array([x, self.ankle_y, zf - v * f * T]), True, 0.0
        s = (f - d) / (1 - d)
        dur = (1 - d) * T
        z = hermite(zb, zf, -v * dur, -v * dur, s)
        y = self.ankle_y + self.lift * math.sin(math.pi * s ** 0.75) ** 2
        return np.array([x, y, z]), False, s

    def flight_envelope(self, phase):
        if self.d >= 0.5:
            return 0.0
        for start in (self.d, 0.5 + self.d):
            end = start + (0.5 - self.d)
            if start <= phase < end:
                return math.sin(math.pi * (phase - start) / (end - start))
        return 0.0

    def evaluate(self, phase):
        rig = self.rig
        P = Pose(rig)
        ph2 = TWO_PI * phase
        mv = 1.0 if self.moving else 0.0
        a_yaw = -self.pelvis_yaw * math.cos(ph2) * mv           # left hip forward at phase 0
        a_twist = self.spine_twist * math.cos(ph2) * mv         # shoulders counter-rotate
        sway_x = self.sway * math.sin(ph2 - 0.3 * mv)
        targets = {}
        for side, off, x in (('L', 0.0, self.ankle_rest['L'][0]), ('R', 0.5, self.ankle_rest['R'][0])):
            f = (phase + off) % 1.0
            A, planted, s = self.foot_target(f, x)
            targets[side] = (A, planted, s, f)
        # --- pelvis height: soft-min of the cap and each leg's reach limit
        cap = self.ankle_y + self.Lr * self.hip_margin
        limits = [cap]
        for side, hx in (('L', self.ankle_rest['L'][0] + sway_x), ('R', self.ankle_rest['R'][0] + sway_x)):
            A = targets[side][0]
            dz, dx = A[2] - self.hip_rest_z, A[0] - hx
            limits.append(A[1] + math.sqrt(max(self.Lr ** 2 - dz * dz - dx * dx, 1e-4)))
        limits[0] = cap + self.flight_hop * self.flight_envelope(phase)   # hop is a cap, never added past the reach limit
        hip_y = softmin(limits) if self.moving else cap
        w = rig.rest_world_p
        pelvis_pos = np.array([self.pelvis_rest[0] + sway_x, hip_y - (w['thigh.L'][1] - self.pelvis_rest[1]),
                               self.pelvis_rest[2]])
        P.rest(rig.armature)
        P.root_move(rig.root, pelvis_pos, quat_mul(axis_angle(Y, a_yaw), axis_angle(X, self.lean * 0.35)))
        # --- spine chain (idle adds breathing on the chest)
        br = self.breathe * math.sin(ph2)
        P.extra('spine.001', quat_mul(axis_angle(X, self.lean * 0.30), axis_angle(Y, a_twist * 0.30)))
        P.extra('spine.002', quat_mul(axis_angle(X, self.lean * 0.25 + br), axis_angle(Y, a_twist * 0.35)))
        P.extra('spine.003', quat_mul(axis_angle(X, self.lean * 0.20 + br * 0.6), axis_angle(Y, a_twist * 0.35)))
        head_yaw = (-(a_yaw + a_twist) * 0.55) if self.moving else 0.03 * math.sin(ph2 * 1.0 + 1.0)
        P.extra('spine.004', quat_mul(axis_angle(X, -self.lean * 0.70 - br * 0.5), axis_angle(Y, head_yaw)))
        P.rest('spine.005')
        P.rest('spine.006')
        # --- legs: IK, absolute orientations
        for side in 'LR':
            A, planted, s, f = targets[side]
            thigh, shin, foot = 'thigh.' + side, 'shin.' + side, 'foot.' + side
            H = P.wp[rig.root] + quat_to_mat3(P.wq[rig.root]) @ rig.rest_t[thigh]
            t_dir, s_dir, over = leg_ik(H, A, self.l1, self.l2)
            q_t = rot_from_to(w[shin] - w[thigh], t_dir)
            P.absolute(thigh, quat_mul(q_t, rig.rest_world_q[thigh]))
            q_s = rot_from_to(w[foot] - w[shin], s_dir)
            P.absolute(shin, quat_mul(q_s, rig.rest_world_q[shin]))
            pitch = 0.0
            if not planted:                      # swing: toe-off plantarflex -> neutral -> heel-strike dorsiflex
                pitch = self.toe_off * (1 - smoothstep(s * 2.0)) - 0.22 * smoothstep((s - 0.5) / 0.5)
            P.absolute(foot, quat_mul(axis_angle(X, pitch), rig.rest_world_q[foot]))
            P.rest('toe.' + side)
            P.rest('heel.02.' + side)
            self.diag.append(dict(phase=phase, side=side, planted=planted, over=over,
                                  target=A.copy(), actual=P.wp[foot].copy()))
        P.rest('pelvis.L')
        P.rest('pelvis.R')
        # --- arms: lower from T-pose, then swing about the lateral axis, elbow bends forward
        for side, sx in (('L', +1), ('R', -1)):
            leg_phase = (phase + (0.0 if side == 'L' else 0.5)) % 1.0
            swing = self.arm_swing * math.cos(TWO_PI * leg_phase) * mv
            idle_sway = 0.025 * math.sin(ph2 + (0.0 if side == 'L' else 1.2)) * (1 - mv)
            P.rest('shoulder.' + side)
            q_up = quat_mul(axis_angle(X, swing + idle_sway), axis_angle(Z, -sx * self.arm_down))
            P.extra('upper_arm.' + side, q_up)
            flex = self.elbow + self.arm_swing * 0.35 * max(0.0, -math.cos(TWO_PI * leg_phase)) * mv
            P.extra('forearm.' + side, axis_angle(X, -flex))
            P.rest('hand.' + side)
        return P


def sample_clip(g):
    n = int(round(g.T * FPS))
    times = np.linspace(0.0, g.T, n + 1)
    frames = [g.evaluate((i % n) / n) for i in range(n + 1)]
    return times, frames


def clip_diagnostics(g):
    """Foot-planting quality: ankle error vs target, stance ground speed, reach violations."""
    d = g.diag
    err = max(float(np.linalg.norm(x['actual'] - x['target'])) for x in d)
    over = max(x['over'] for x in d)
    out = {'maxAnkleError_m': err, 'maxReachShortfall_m': float(over)}
    if g.moving:
        n = int(round(g.T * FPS))
        for side in 'LR':
            seq = [x for x in d if x['side'] == side][: n + 1]       # one full cycle, in frame order
            speeds = []
            for a, b in zip(seq[:-1], seq[1:]):                       # consecutive frames, both planted
                if a['planted'] and b['planted']:
                    speeds.append(-(b['actual'][2] - a['actual'][2]) * FPS)
            pts = [x for x in seq if x['planted']]
            speed = np.array(speeds)
            out['stanceSpeed_' + side] = (float(speed.mean()), float(speed.min()), float(speed.max()))
            out['stanceAnkleY_' + side] = (float(min(p['actual'][1] for p in pts)), float(max(p['actual'][1] for p in pts)))
    return out


def build_all(rig):
    gaits = [
        Gait(rig, 'Idle', T=3.2, v_ref=0.0, duty=1.0, lift=0.0, arm_swing=0, elbow=14, lean=0,
             pelvis_yaw=0, spine_twist=0, sway=0.006, hip_margin=0.985, arm_down=82, moving=False, breathe=0.018),
        Gait(rig, 'Walk', T=0.60, v_ref=1.20, duty=0.62, lift=0.075, arm_swing=22, elbow=18, lean=3,
             pelvis_yaw=5, spine_twist=8, sway=0.012, hip_margin=0.975, arm_down=82),
        Gait(rig, 'Run', T=0.42, v_ref=3.40, duty=0.34, lift=0.150, arm_swing=48, elbow=80, lean=13,
             pelvis_yaw=7, spine_twist=11, sway=0.010, hip_margin=0.93, arm_down=80, flight_hop=0.035,
             toe_off=0.3),
    ]
    clips, meta = [], {}
    for g in gaits:
        times, frames = sample_clip(g)
        tracks = {}
        for b in rig.names:
            qs = make_continuous(np.array([fr.local_q[b] for fr in frames]))
            moving = np.abs(qs - qs[0]).max() > 1e-6 or np.abs(qs[0] - rig.rest_q[b]).max() > 1e-6
            if moving:
                tracks[b] = {'rotation': qs.astype(np.float32)}
        tracks.setdefault(rig.root, {})['translation'] = np.array([fr.local_t[rig.root] for fr in frames],
                                                                   dtype=np.float32)
        tracks[rig.root].setdefault('rotation', make_continuous(np.array([fr.local_q[rig.root] for fr in frames])).astype(np.float32))
        clips.append({'name': g.name, 'times': times.astype(np.float32), 'tracks': tracks})
        diag = clip_diagnostics(g)
        meta[g.name] = {
            'duration': float(g.T), 'loop': True,
            'referenceSpeed': float(g.v),           # ground speed (m/s) the foot-planted gait was authored for
            'distancePerCycle': float(g.v * g.T),   # metres travelled per full left+right cycle
            'dutyFactor': float(g.d), 'stanceTravel': float(g.travel), 'footPlanted': bool(g.moving),
            'authoredBy': 'tools/gait.py (procedural IK gait; the source FBX contains no animation)',
            'diagnostics': diag,
        }
        print('  clip %-5s T=%.2fs v_ref=%.2f m/s stance-travel=%.3f m  diag=%s' % (
            g.name, g.T, g.v, g.travel, {k: (np.round(v, 4).tolist() if not isinstance(v, float) else round(v, 5)) for k, v in diag.items()}))
    return clips, meta
