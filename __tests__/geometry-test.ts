import { hexToHsv, hexToRgb, hsvToHex, normalizeHex, rgbToHex } from '@/engine/color/colorMath';
import { followStep, followTimeMs } from '@/engine/input/strokeInput';
import { canvasToScreen, screenToCanvas, type ViewTransform } from '@/engine/input/viewTransform';

describe('stabiliser', () => {
  it('glides toward the pointer and keeps catching up while it rests', () => {
    let tip = { x: 0, y: 0 };
    const distances: number[] = [];
    for (let i = 0; i < 30; i++) {
      tip = followStep(tip.x, tip.y, 100, 0, 16, 0.5);
      distances.push(100 - tip.x);
    }
    // Moves every frame, never overshoots, gets steadily closer.
    for (let i = 1; i < distances.length; i++) expect(distances[i]).toBeLessThan(distances[i - 1]);
    expect(tip.x).toBeLessThanOrEqual(100);
    expect(tip.y).toBe(0);
  });

  it('follows more slowly at a higher strength', () => {
    const weak = followStep(0, 0, 100, 0, 16, 0.1);
    const strong = followStep(0, 0, 100, 0, 16, 0.9);
    expect(weak.x).toBeGreaterThan(strong.x);
    expect(followTimeMs(1)).toBeGreaterThan(followTimeMs(0));
  });

  it('is frame-rate independent', () => {
    let a = { x: 0, y: 0 };
    for (let i = 0; i < 4; i++) a = followStep(a.x, a.y, 100, 0, 8, 0.6);
    const b = followStep(0, 0, 100, 0, 32, 0.6);
    expect(a.x).toBeCloseTo(b.x, 6);
  });
});
import { IDENTITY_TRANSFORM, isIdentityTransform, mapPoint } from '@/engine/layers/layerTransform';

describe('view transform', () => {
  const views: ViewTransform[] = [
    { tx: 0, ty: 0, scale: 1, rotation: 0 },
    { tx: 120, ty: -40, scale: 2.5, rotation: 0 },
    { tx: 300, ty: 200, scale: 0.3, rotation: Math.PI / 5 },
    { tx: -50, ty: 75, scale: 8, rotation: -2.4 },
  ];

  it.each(views)('screen ↔ canvas mapping is lossless (%o)', (view) => {
    for (const [x, y] of [[0, 0], [10, 20], [-333, 512.5], [4096, 4096]]) {
      const screen = canvasToScreen(view, x, y);
      const back = screenToCanvas(view, screen.x, screen.y);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
  });
});

describe('layer transform', () => {
  it('identity leaves points in place', () => {
    expect(isIdentityTransform(IDENTITY_TRANSFORM)).toBe(true);
    expect(mapPoint(IDENTITY_TRANSFORM, 12, 34)).toEqual({ x: 12, y: 34 });
  });

  it('applies flip, scale, rotation and translation', () => {
    const p = mapPoint({ tx: 10, ty: 0, scale: 2, rotation: Math.PI / 2, flipX: true, flipY: false }, 1, 0);
    // (1,0) → flip (-1,0) → scale (-2,0) → rotate 90° (0,-2) → translate (10,-2)
    expect(p.x).toBeCloseTo(10, 9);
    expect(p.y).toBeCloseTo(-2, 9);
  });
});

describe('colour maths', () => {
  it('normalises hex input', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex(' FF8A4C ')).toBe('#ff8a4c');
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
  });

  it.each(['#000000', '#ffffff', '#ff8a4c', '#1982c4', '#6a4c93', '#808080'])('round-trips %s through RGB and HSV', (hex) => {
    expect(rgbToHex(hexToRgb(hex))).toBe(hex);
    expect(hsvToHex(hexToHsv(hex))).toBe(hex);
  });

  it('clamps out-of-range channels', () => {
    expect(rgbToHex({ r: 300, g: -5, b: 127.6 })).toBe('#ff0080');
  });
});
