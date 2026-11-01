/**
 * Poseable 3D artist's mannequin (pure maths, no Skia).
 *
 * Units are head heights ("heads"). The figure faces +Z (toward the default camera), +Y is up and
 * +X is the figure's left. Each joint has a local rotation (3x3, row-major) applied to everything
 * below it; positions come from forward kinematics. The camera orbits the figure and projects
 * with optional perspective. Geometry is returned in screen space, depth-sorted, together with
 * the construction guidelines artists draw from.
 */

export type Vec3 = [number, number, number];
export type Mat3 = number[];
export interface P2 {
  x: number;
  y: number;
}

// ---- 3x3 matrices ------------------------------------------------------------------------

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array<number>(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  }
  return r;
}

export function apply3(m: Mat3, v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

export function transpose3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

const rad = (d: number) => (d * Math.PI) / 180;

export function rotX(deg: number): Mat3 {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
export function rotY(deg: number): Mat3 {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
export function rotZ(deg: number): Mat3 {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Euler angles (degrees) → matrix, applied Z, then X, then Y. */
export function fromEuler([x, y, z]: Vec3): Mat3 {
  return mul3(rotY(y), mul3(rotX(x), rotZ(z)));
}

/** Rotation by `angle` radians around unit `axis` (Rodrigues). */
export function axisAngle(axis: Vec3, angle: number): Mat3 {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

// ---- body ----------------------------------------------------------------------------------

export type JointName =
  | 'pelvis' | 'spine' | 'neck' | 'head'
  | 'shoulderL' | 'elbowL' | 'wristL' | 'shoulderR' | 'elbowR' | 'wristR'
  | 'hipL' | 'kneeL' | 'ankleL' | 'hipR' | 'kneeR' | 'ankleR';

export const JOINTS: readonly JointName[] = [
  'pelvis', 'spine', 'neck', 'head',
  'shoulderL', 'elbowL', 'wristL', 'shoulderR', 'elbowR', 'wristR',
  'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR',
];

export type BodyType = 'male' | 'female' | 'child';

export interface Body {
  type: BodyType;
  label: string;
  /** Height in heads (what the proportion ruler counts). */
  heads: number;
  parent: Record<JointName, JointName | null>;
  /** Offset of each joint from its parent, in the parent's frame. */
  offset: Record<JointName, Vec3>;
  hand: number;
  foot: { length: number; height: number; back: number };
  radius: { neck: number; upperArm: [number, number]; forearm: [number, number]; thigh: [number, number]; calf: [number, number]; abdomen: number };
  head: { radius: number; center: Vec3 };
  ribcage: { size: Vec3; center: Vec3 };
  pelvisBox: { size: Vec3; center: Vec3 };
}

const PARENT: Record<JointName, JointName | null> = {
  pelvis: null,
  spine: 'pelvis',
  neck: 'spine',
  head: 'neck',
  shoulderL: 'spine',
  elbowL: 'shoulderL',
  wristL: 'elbowL',
  shoulderR: 'spine',
  elbowR: 'shoulderR',
  wristR: 'elbowR',
  hipL: 'pelvis',
  kneeL: 'hipL',
  ankleL: 'kneeL',
  hipR: 'pelvis',
  kneeR: 'hipR',
  ankleR: 'kneeR',
};

interface BodySpec {
  type: BodyType;
  label: string;
  heads: number;
  spine: number;
  chest: number;
  neck: number;
  shoulderW: number;
  hipW: number;
  upperArm: number;
  forearm: number;
  hand: number;
  thigh: number;
  calf: number;
  ankle: number;
  headR: number;
  rib: Vec3;
  pelvis: Vec3;
  limb: number;
  abdomen: number;
}

function makeBody(s: BodySpec): Body {
  const k = s.limb;
  return {
    type: s.type,
    label: s.label,
    heads: s.heads,
    parent: PARENT,
    offset: {
      pelvis: [0, 0, 0],
      spine: [0, s.spine, 0],
      neck: [0, s.chest, 0],
      head: [0, s.neck, 0.02],
      shoulderL: [s.shoulderW, s.chest * 0.9, -0.05],
      elbowL: [0, -s.upperArm, 0],
      wristL: [0, -s.forearm, 0],
      shoulderR: [-s.shoulderW, s.chest * 0.9, -0.05],
      elbowR: [0, -s.upperArm, 0],
      wristR: [0, -s.forearm, 0],
      hipL: [s.hipW, -0.08, 0],
      kneeL: [0, -s.thigh, 0],
      ankleL: [0, -s.calf, 0],
      hipR: [-s.hipW, -0.08, 0],
      kneeR: [0, -s.thigh, 0],
      ankleR: [0, -s.calf, 0],
    },
    hand: s.hand,
    foot: { length: s.hand * 1.4, height: s.ankle, back: 0.22 },
    radius: {
      neck: 0.21 * k,
      upperArm: [0.19 * k, 0.14 * k],
      forearm: [0.15 * k, 0.1 * k],
      thigh: [0.33 * k, 0.22 * k],
      calf: [0.23 * k, 0.13 * k],
      abdomen: s.abdomen,
    },
    head: { radius: s.headR, center: [0, s.headR * 1.5, 0.06] },
    ribcage: { size: s.rib, center: [0, s.rib[1] / 2, 0] },
    pelvisBox: { size: s.pelvis, center: [0, 0.05, 0] },
  };
}

export const BODIES: Record<BodyType, Body> = {
  male: makeBody({
    type: 'male', label: 'Male', heads: 8, spine: 1.15, chest: 1.35, neck: 0.32, shoulderW: 0.82, hipW: 0.45,
    upperArm: 1.45, forearm: 1.25, hand: 0.75, thigh: 1.95, calf: 1.82, ankle: 0.15, headR: 0.46,
    rib: [1.35, 1.25, 0.9], pelvis: [1.2, 0.75, 0.85], limb: 1, abdomen: 0.42,
  }),
  female: makeBody({
    type: 'female', label: 'Female', heads: 7.5, spine: 1.05, chest: 1.25, neck: 0.32, shoulderW: 0.7, hipW: 0.52,
    upperArm: 1.35, forearm: 1.15, hand: 0.68, thigh: 1.85, calf: 1.7, ankle: 0.14, headR: 0.45,
    rib: [1.15, 1.15, 0.8], pelvis: [1.38, 0.78, 0.85], limb: 0.92, abdomen: 0.36,
  }),
  child: makeBody({
    type: 'child', label: 'Child', heads: 5, spine: 0.72, chest: 0.85, neck: 0.18, shoulderW: 0.55, hipW: 0.32,
    upperArm: 0.85, forearm: 0.75, hand: 0.45, thigh: 1.05, calf: 0.95, ankle: 0.1, headR: 0.48,
    rib: [0.95, 0.85, 0.7], pelvis: [0.9, 0.55, 0.65], limb: 0.78, abdomen: 0.34,
  }),
};

// ---- poses ---------------------------------------------------------------------------------

/** A pose: each joint's local rotation. Missing joints are not rotated. */
export type Pose = Partial<Record<JointName, Mat3>>;
type EulerPose = Partial<Record<JointName, Vec3>>;

const EULER_POSES: Record<string, { label: string; joints: EulerPose }> = {
  stand: { label: 'Standing', joints: { shoulderL: [0, 0, 8], shoulderR: [0, 0, -8], elbowL: [-10, 0, 0], elbowR: [-10, 0, 0] } },
  contrapposto: {
    label: 'Contrapposto',
    joints: {
      pelvis: [0, 0, 5], spine: [0, 0, -9], neck: [0, 0, 4], head: [0, 12, 0],
      hipL: [0, 0, -5], hipR: [-10, 0, 3], kneeR: [18, 0, 0],
      shoulderL: [0, 0, 10], shoulderR: [-8, 0, -14], elbowR: [-25, 0, 0], elbowL: [-12, 0, 0],
    },
  },
  walk: {
    label: 'Walking',
    joints: {
      pelvis: [0, -6, 0], spine: [-3, 10, 0],
      hipL: [-25, 0, 0], kneeL: [10, 0, 0], ankleL: [-8, 0, 0], hipR: [20, 0, 0], kneeR: [28, 0, 0], ankleR: [12, 0, 0],
      shoulderL: [22, 0, 6], elbowL: [-18, 0, 0], shoulderR: [-24, 0, -6], elbowR: [-30, 0, 0],
    },
  },
  run: {
    label: 'Running',
    joints: {
      pelvis: [-10, -8, 0], spine: [-14, 12, 0], neck: [10, 0, 0],
      hipL: [-70, 0, 0], kneeL: [80, 0, 0], ankleL: [-10, 0, 0], hipR: [35, 0, 0], kneeR: [55, 0, 0], ankleR: [25, 0, 0],
      shoulderL: [45, 0, 10], elbowL: [-95, 0, 0], shoulderR: [-55, 0, -10], elbowR: [-95, 0, 0],
    },
  },
  sit: {
    label: 'Sitting',
    joints: {
      spine: [6, 0, 0], hipL: [-90, 0, 4], kneeL: [90, 0, 0], hipR: [-90, 0, -4], kneeR: [90, 0, 0],
      shoulderL: [-20, 0, 8], elbowL: [-55, 0, 0], shoulderR: [-20, 0, -8], elbowR: [-55, 0, 0],
    },
  },
  crouch: {
    label: 'Crouching',
    joints: {
      pelvis: [-20, 0, 0], spine: [-25, 0, 0], neck: [20, 0, 0],
      hipL: [-95, 0, 12], kneeL: [135, 0, 0], ankleL: [-35, 0, 0], hipR: [-80, 0, -12], kneeR: [125, 0, 0], ankleR: [-30, 0, 0],
      shoulderL: [-50, 0, 10], elbowL: [-40, 0, 0], shoulderR: [-40, 0, -10], elbowR: [-50, 0, 0],
    },
  },
  reach: {
    label: 'Reaching up',
    joints: { spine: [0, 0, -8], neck: [-15, 0, 0], shoulderL: [0, 0, 165], elbowL: [-10, 0, 0], shoulderR: [0, 0, -20], elbowR: [-15, 0, 0], hipR: [0, 0, -4] },
  },
  fight: {
    label: 'Fighting stance',
    joints: {
      pelvis: [0, 25, 0], spine: [-6, -15, 0], head: [0, -12, 0],
      hipL: [-25, 0, 12], kneeL: [25, 0, 0], hipR: [18, 0, -10], kneeR: [15, 0, 0],
      shoulderL: [-75, 0, 25], elbowL: [-105, 0, 0], shoulderR: [-35, 0, -25], elbowR: [-125, 0, 0],
    },
  },
  think: {
    label: 'Thinking',
    joints: {
      head: [12, -10, 0], spine: [-5, 0, 0], shoulderR: [-40, 0, -5], elbowR: [-140, 0, 0],
      shoulderL: [-25, 0, -20], elbowL: [-95, 0, 0], hipR: [-6, 0, 0], kneeR: [10, 0, 0],
    },
  },
};

export const POSE_PRESETS: readonly { id: string; label: string }[] = Object.entries(EULER_POSES).map(([id, p]) => ({ id, label: p.label }));

export function presetPose(id: string): Pose {
  const joints = EULER_POSES[id]?.joints ?? {};
  const out: Pose = {};
  for (const [name, e] of Object.entries(joints) as [JointName, Vec3][]) out[name] = fromEuler(e);
  return out;
}

const MIRROR: Record<JointName, JointName> = {
  pelvis: 'pelvis', spine: 'spine', neck: 'neck', head: 'head',
  shoulderL: 'shoulderR', elbowL: 'elbowR', wristL: 'wristR', shoulderR: 'shoulderL', elbowR: 'elbowL', wristR: 'wristL',
  hipL: 'hipR', kneeL: 'kneeR', ankleL: 'ankleR', hipR: 'hipL', kneeR: 'kneeL', ankleR: 'ankleL',
};

/** The same pose with left and right swapped (mirrored across the figure's YZ plane). */
export function mirrorPose(pose: Pose): Pose {
  // M R M with M = diag(-1, 1, 1).
  const flip = (m: Mat3): Mat3 => [m[0], -m[1], -m[2], -m[3], m[4], m[5], -m[6], m[7], m[8]];
  const out: Pose = {};
  for (const [name, m] of Object.entries(pose) as [JointName, Mat3][]) out[MIRROR[name]] = flip(m);
  return out;
}

// ---- forward kinematics -------------------------------------------------------------------

export interface JointFrame {
  /** World position (heads). */
  p: Vec3;
  /** World rotation of the joint (its children are placed in this frame). */
  r: Mat3;
}

export function solve(body: Body, pose: Pose): Record<JointName, JointFrame> {
  const out = {} as Record<JointName, JointFrame>;
  for (const j of JOINTS) {
    const local = pose[j] ?? IDENTITY3;
    const parent = body.parent[j];
    if (!parent) {
      out[j] = { p: [0, 0, 0], r: local };
    } else {
      const pf = out[parent];
      out[j] = { p: add(pf.p, apply3(pf.r, body.offset[j])), r: mul3(pf.r, local) };
    }
  }
  return out;
}

/** Top of the head and the ground (soles) in the rest pose, in heads. */
export function restExtent(body: Body): { top: number; ground: number } {
  const f = solve(body, {});
  const top = f.head.p[1] + body.head.center[1] + body.head.radius;
  const ground = f.ankleL.p[1] - body.foot.height;
  return { top, ground };
}

// ---- camera ------------------------------------------------------------------------------

export interface Camera {
  /** Orbit angles, degrees: yaw turns around the figure, pitch looks from above (+) or below. */
  yaw: number;
  pitch: number;
  /** Extra zoom on top of fitting the figure to the frame. */
  zoom: number;
  /** Camera distance in heads (perspective strength); Infinity for no perspective. */
  distance: number;
  /** Screen pan, points. */
  panX: number;
  panY: number;
}

export const DEFAULT_CAMERA: Camera = { yaw: 25, pitch: 8, zoom: 1, distance: 14, panX: 0, panY: 0 };

export interface Projector {
  /** World → camera space (x right, y up, z toward the viewer). */
  view: Mat3;
  project: (v: Vec3) => P2 & { z: number; s: number };
  /** World direction toward the viewer. */
  toViewer: Vec3;
}

/** Fits the figure into a W x H frame and projects world points (heads) to screen points. */
export function makeProjector(body: Body, cam: Camera, W: number, H: number): Projector {
  const { top, ground } = restExtent(body);
  const midY = (top + ground) / 2;
  const scale = ((H * 0.86) / (top - ground)) * cam.zoom;
  const view = mul3(rotX(cam.pitch), rotY(-cam.yaw));
  const D = cam.distance;
  return {
    view,
    toViewer: apply3(transpose3(view), [0, 0, 1]),
    project: (v) => {
      const c = apply3(view, [v[0], v[1] - midY, v[2]]);
      const s = Number.isFinite(D) ? D / Math.max(0.5, D - c[2]) : 1;
      return { x: W / 2 + cam.panX + c[0] * scale * s, y: H / 2 + cam.panY - c[1] * scale * s, z: c[2], s: scale * s };
    },
  };
}

// ---- screen geometry -----------------------------------------------------------------------

export type Prim =
  | { kind: 'capsule'; a: P2; b: P2; ra: number; rb: number; z: number; part: string }
  | { kind: 'sphere'; c: P2; r: number; z: number; part: string }
  | { kind: 'box'; faces: { pts: P2[]; shade: number }[]; edges: [P2, P2][]; z: number; part: string };

export interface FigureGuides {
  centerLine: P2[];
  /** Head cross: the face's centre line and the eye line, split into visible / hidden runs. */
  headFront: P2[][];
  headBack: P2[][];
  shoulderLine: [P2, P2];
  hipLine: [P2, P2];
  /** Proportion ruler: the axis and one tick per head. */
  ruler: { axis: [P2, P2]; ticks: [P2, P2][] };
  actionLine: P2[];
  joints: { name: JointName; p: P2 }[];
  /** Construction boxes (ribcage, pelvis) edges. */
  boxes: [P2, P2][];
}

export interface FigureGeometry {
  prims: Prim[];
  guides: FigureGuides;
}

const LIGHT: Vec3 = normalize([-0.4, 0.7, 0.6]);

/** Builds the depth-sorted body primitives and the guidelines for a pose seen by a camera. */
export function buildFigure(body: Body, pose: Pose, proj: Projector): FigureGeometry {
  const f = solve(body, pose);
  const P = (v: Vec3) => proj.project(v);
  const at = (j: JointName, local: Vec3): Vec3 => add(f[j].p, apply3(f[j].r, local));
  const prims: Prim[] = [];

  const capsule = (part: string, a: Vec3, b: Vec3, ra: number, rb: number) => {
    const pa = P(a);
    const pb = P(b);
    prims.push({ kind: 'capsule', part, a: pa, b: pb, ra: ra * pa.s, rb: rb * pb.s, z: (pa.z + pb.z) / 2 });
  };

  const box = (part: string, j: JointName, center: Vec3, size: Vec3) => {
    const [w, h, d] = size.map((v) => v / 2);
    const corners: Vec3[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push(at(j, [center[0] + sx * w, center[1] + sy * h, center[2] + sz * d]));
    const sp = corners.map(P);
    // Corner index = (sx>0)*4 + (sy>0)*2 + (sz>0).
    const faceIdx: [number[], Vec3][] = [
      [[1, 3, 7, 5], [0, 0, 1]], [[0, 4, 6, 2], [0, 0, -1]],
      [[4, 5, 7, 6], [1, 0, 0]], [[0, 2, 3, 1], [-1, 0, 0]],
      [[2, 6, 7, 3], [0, 1, 0]], [[0, 1, 5, 4], [0, -1, 0]],
    ];
    const faces: { pts: P2[]; shade: number }[] = [];
    for (const [idx, n] of faceIdx) {
      const wn = apply3(f[j].r, n);
      const facing = wn[0] * proj.toViewer[0] + wn[1] * proj.toViewer[1] + wn[2] * proj.toViewer[2];
      if (facing <= 0.02) continue;
      const lit = Math.max(0, wn[0] * LIGHT[0] + wn[1] * LIGHT[1] + wn[2] * LIGHT[2]);
      faces.push({ pts: idx.map((i) => sp[i]), shade: 0.55 + 0.45 * lit });
    }
    const edges: [P2, P2][] = [];
    for (let a = 0; a < 8; a++) for (const bit of [1, 2, 4]) if (!(a & bit)) edges.push([sp[a], sp[a | bit]]);
    prims.push({ kind: 'box', part, faces, edges, z: sp.reduce((s, p) => s + p.z, 0) / 8 });
  };

  const r = body.radius;
  // Torso.
  box('pelvis', 'pelvis', body.pelvisBox.center, body.pelvisBox.size);
  box('ribcage', 'spine', body.ribcage.center, body.ribcage.size);
  capsule('abdomen', at('pelvis', [0, 0.3, 0]), at('spine', [0, 0.15, 0]), r.abdomen, r.abdomen * 0.95);
  capsule('neck', at('neck', [0, -0.1, 0]), f.head.p, r.neck, r.neck);
  // Head (cranium + jaw).
  const headC = at('head', body.head.center);
  const hc = P(headC);
  prims.push({ kind: 'sphere', part: 'head', c: hc, r: body.head.radius * hc.s, z: hc.z });
  capsule('jaw', at('head', [0, body.head.radius * 1.1, 0.16]), at('head', [0, body.head.radius * 0.45, body.head.radius * 0.62]), body.head.radius * 0.55, body.head.radius * 0.3);
  // Limbs.
  for (const side of ['L', 'R'] as const) {
    const sh = `shoulder${side}` as JointName;
    const el = `elbow${side}` as JointName;
    const wr = `wrist${side}` as JointName;
    const hp = `hip${side}` as JointName;
    const kn = `knee${side}` as JointName;
    const an = `ankle${side}` as JointName;
    capsule(`upperArm${side}`, f[sh].p, f[el].p, r.upperArm[0], r.upperArm[1]);
    capsule(`forearm${side}`, f[el].p, f[wr].p, r.forearm[0], r.forearm[1]);
    box(`hand${side}`, wr, [0, -body.hand / 2, 0], [0.15, body.hand, body.hand * 0.55]);
    capsule(`thigh${side}`, f[hp].p, f[kn].p, r.thigh[0], r.thigh[1]);
    capsule(`calf${side}`, f[kn].p, f[an].p, r.calf[0], r.calf[1]);
    const ft = body.foot;
    box(`foot${side}`, an, [0, -ft.height / 2, ft.length / 2 - ft.back], [r.calf[1] * 2.2, ft.height, ft.length]);
    const shoulderP = P(f[sh].p);
    prims.push({ kind: 'sphere', part: `shoulderBall${side}`, c: shoulderP, r: r.upperArm[0] * 1.15 * shoulderP.s, z: shoulderP.z });
  }
  // Far parts first.
  prims.sort((a, b) => a.z - b.z);

  // ---- guides --------------------------------------------------------------------------
  const centerLine = [
    P(at('pelvis', [0, 0.05, body.pelvisBox.size[2] / 2])),
    P(at('spine', [0, 0.1, body.ribcage.size[2] * 0.45])),
    P(at('spine', [0, body.ribcage.size[1] * 0.55, body.ribcage.size[2] / 2])),
    P(at('spine', [0, body.ribcage.size[1], body.ribcage.size[2] * 0.4])),
    P(at('neck', [0, 0.05, r.neck])),
  ];

  const headFront: P2[][] = [];
  const headBack: P2[][] = [];
  const R = body.head.radius * 1.002;
  const circle = (pointAt: (t: number) => Vec3, normalAt: (t: number) => Vec3) => {
    let run: P2[] = [];
    let runVisible: boolean | null = null;
    for (let i = 0; i <= 48; i++) {
      const t = (i / 48) * Math.PI * 2;
      const wn = apply3(f.head.r, normalAt(t));
      const visible = wn[0] * proj.toViewer[0] + wn[1] * proj.toViewer[1] + wn[2] * proj.toViewer[2] > 0;
      const p = P(at('head', pointAt(t)));
      if (runVisible !== null && visible !== runVisible) {
        (runVisible ? headFront : headBack).push(run);
        run = [run[run.length - 1]];
      }
      run.push(p);
      runVisible = visible;
    }
    if (run.length > 1 && runVisible !== null) (runVisible ? headFront : headBack).push(run);
  };
  const hcx = body.head.center;
  // Vertical centre line of the face (great circle in the head's YZ plane).
  circle((t) => [hcx[0], hcx[1] + Math.cos(t) * R, hcx[2] + Math.sin(t) * R], (t) => [0, Math.cos(t), Math.sin(t)]);
  // Eye line, a little below the cranium centre, wrapping around the head.
  const eyeY = -0.12 * R;
  const eyeR = Math.sqrt(R * R - eyeY * eyeY);
  circle((t) => [hcx[0] + Math.sin(t) * eyeR, hcx[1] + eyeY, hcx[2] + Math.cos(t) * eyeR], (t) => [Math.sin(t), eyeY / R, Math.cos(t)]);

  const extend = (a: Vec3, b: Vec3, k: number): [P2, P2] => {
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    return [P([a[0] - d[0] * k, a[1] - d[1] * k, a[2] - d[2] * k]), P([b[0] + d[0] * k, b[1] + d[1] * k, b[2] + d[2] * k])];
  };

  // Proportion ruler beside the figure, in the rest frame (it measures the design height).
  const { top, ground } = restExtent(body);
  const unit = (top - ground) / body.heads;
  const rulerX = -(body.offset.shoulderL[0] + 1.1);
  const ticks: [P2, P2][] = [];
  for (let i = 0; i <= Math.floor(body.heads + 1e-6); i++) {
    const y = top - i * unit;
    ticks.push([P([rulerX - 0.18, y, 0]), P([rulerX + 0.18, y, 0])]);
  }
  if (body.heads % 1 !== 0) ticks.push([P([rulerX - 0.18, ground, 0]), P([rulerX + 0.18, ground, 0])]);

  // Action line: head → chest → pelvis → the lower (weight-bearing) foot.
  const lowFoot = f.ankleL.p[1] <= f.ankleR.p[1] ? f.ankleL.p : f.ankleR.p;
  const actionLine = catmullRom([headC, f.neck.p, at('spine', [0, body.ribcage.size[1] / 2, 0]), f.pelvis.p, lowFoot].map(P), 10);

  const boxes: [P2, P2][] = [];
  for (const p of prims) if (p.kind === 'box' && (p.part === 'ribcage' || p.part === 'pelvis')) boxes.push(...p.edges);

  return {
    prims,
    guides: {
      centerLine,
      headFront,
      headBack,
      shoulderLine: extend(f.shoulderR.p, f.shoulderL.p, 0.35),
      hipLine: extend(f.hipR.p, f.hipL.p, 0.6),
      ruler: { axis: [P([rulerX, top, 0]), P([rulerX, ground, 0])], ticks },
      actionLine,
      joints: JOINTS.map((name) => ({ name, p: P(f[name].p) })),
      boxes,
    },
  };
}

/** Smooth curve through points (Catmull-Rom), `steps` samples per segment. */
export function catmullRom(pts: P2[], steps: number): P2[] {
  if (pts.length < 3) return pts;
  const out: P2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const q = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: q(p0.x, p1.x, p2.x, p3.x), y: q(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ---- posing --------------------------------------------------------------------------------

/**
 * Turns joint `j` so its bone follows a drag around the joint on screen: the screen-space angle
 * the finger swept (radians, clockwise on screen) becomes a rotation around the viewing axis.
 * With `twist`, the bone turns around its own length instead.
 */
export function rotateJoint(body: Body, pose: Pose, j: JointName, angle: number, proj: Projector, twist = false): Pose {
  const f = solve(body, pose);
  const parent = body.parent[j];
  const parentR = parent ? f[parent].r : IDENTITY3;
  let axisWorld: Vec3;
  if (twist) {
    const child = JOINTS.find((c) => body.parent[c] === j);
    axisWorld = normalize(child ? apply3(f[j].r, body.offset[child]) : apply3(f[j].r, [0, 1, 0]));
  } else {
    // Clockwise on screen (y down) is a positive turn around the axis pointing away from the viewer.
    axisWorld = [-proj.toViewer[0], -proj.toViewer[1], -proj.toViewer[2]];
  }
  const axisLocal = normalize(apply3(transpose3(parentR), axisWorld));
  return { ...pose, [j]: mul3(axisAngle(axisLocal, angle), pose[j] ?? IDENTITY3) };
}

/** Joint whose screen position is within `radius` of (x, y), nearest first; null if none. */
export function hitJoint(guides: FigureGuides, x: number, y: number, radius: number): JointName | null {
  let best: JointName | null = null;
  let bestD = radius * radius;
  for (const j of guides.joints) {
    const d = (j.p.x - x) ** 2 + (j.p.y - y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = j.name;
    }
  }
  return best;
}
