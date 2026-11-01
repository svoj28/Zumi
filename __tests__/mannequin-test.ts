import {
  BODIES,
  buildFigure,
  DEFAULT_CAMERA,
  hitJoint,
  makeProjector,
  mirrorPose,
  POSE_PRESETS,
  presetPose,
  restExtent,
  rotateJoint,
  solve,
  type Vec3,
} from '@/engine/figure/mannequin';

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('mannequin proportions', () => {
  it.each(Object.values(BODIES))('$label is $heads heads tall', (body) => {
    const { top, ground } = restExtent(body);
    expect(top - ground).toBeCloseTo(body.heads, 0);
  });

  it('male shoulders are wider and hips narrower than female ones', () => {
    const m = solve(BODIES.male, {});
    const w = solve(BODIES.female, {});
    expect(dist(m.shoulderL.p, m.shoulderR.p)).toBeGreaterThan(dist(w.shoulderL.p, w.shoulderR.p));
    expect(dist(m.hipL.p, m.hipR.p)).toBeLessThan(dist(w.hipL.p, w.hipR.p));
  });
});

describe('posing', () => {
  it('every preset keeps bone lengths', () => {
    const body = BODIES.male;
    const rest = solve(body, {});
    for (const p of POSE_PRESETS) {
      const f = solve(body, presetPose(p.id));
      expect(dist(f.shoulderL.p, f.elbowL.p)).toBeCloseTo(dist(rest.shoulderL.p, rest.elbowL.p), 6);
      expect(dist(f.kneeR.p, f.ankleR.p)).toBeCloseTo(dist(rest.kneeR.p, rest.ankleR.p), 6);
    }
  });

  it('reaching up lifts the elbow above the shoulder', () => {
    const f = solve(BODIES.male, presetPose('reach'));
    expect(f.elbowL.p[1]).toBeGreaterThan(f.shoulderL.p[1]);
  });

  it('mirroring swaps left and right', () => {
    const body = BODIES.male;
    const pose = presetPose('fight');
    const a = solve(body, pose);
    const b = solve(body, mirrorPose(pose));
    expect(b.wristR.p[0]).toBeCloseTo(-a.wristL.p[0], 6);
    expect(b.wristR.p[1]).toBeCloseTo(a.wristL.p[1], 6);
    expect(b.wristR.p[2]).toBeCloseTo(a.wristL.p[2], 6);
  });

  it('dragging around a joint swings its bone on screen, keeping its length', () => {
    const body = BODIES.male;
    const proj = makeProjector(body, { ...DEFAULT_CAMERA, yaw: 0, pitch: 0, distance: Infinity }, 300, 400);
    const sh = proj.project(solve(body, {}).shoulderL.p);
    const before = proj.project(solve(body, {}).elbowL.p);
    const after = proj.project(solve(body, rotateJoint(body, {}, 'shoulderL', -Math.PI / 2, proj)).elbowL.p);
    expect(Math.hypot(after.x - sh.x, after.y - sh.y)).toBeCloseTo(Math.hypot(before.x - sh.x, before.y - sh.y), 4);
    expect(Math.abs(after.y - sh.y)).toBeLessThan(1);
  });
});

describe('view and guides', () => {
  it('fits the figure in the frame with one ruler tick per head', () => {
    const body = BODIES.female;
    const proj = makeProjector(body, { ...DEFAULT_CAMERA, yaw: 0, pitch: 0, distance: Infinity }, 300, 400);
    const geo = buildFigure(body, {}, proj);
    const [top, bottom] = geo.guides.ruler.axis;
    expect(top.y).toBeGreaterThan(0);
    expect(bottom.y).toBeLessThan(400);
    expect(geo.guides.ruler.ticks.length).toBe(9); // 0..7 heads, plus the half head at the feet
  });

  it('draws far parts first and finds joints under a finger', () => {
    const body = BODIES.male;
    const proj = makeProjector(body, DEFAULT_CAMERA, 300, 400);
    const geo = buildFigure(body, presetPose('walk'), proj);
    for (let i = 1; i < geo.prims.length; i++) expect(geo.prims[i].z).toBeGreaterThanOrEqual(geo.prims[i - 1].z);
    const knee = geo.guides.joints.find((j) => j.name === 'kneeL')!;
    expect(hitJoint(geo.guides, knee.p.x + 3, knee.p.y - 2, 16)).toBe('kneeL');
    expect(hitJoint(geo.guides, -500, -500, 16)).toBeNull();
  });
});
