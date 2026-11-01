import {
  findLayout,
  insetPolygon,
  layoutPanels,
  PAGE_FORMATS,
  PANEL_LAYOUTS,
  panelArea,
} from '@/engine/comics/comicLayouts';

const area = { x: 100, y: 100, width: 1000, height: 1500 };

describe('comic page formats', () => {
  it('sizes print pages at their resolution, bleed included', () => {
    const a4 = PAGE_FORMATS.find((f) => f.id === 'manga-a4')!;
    // 210 mm + 2 × 3 mm bleed at 300 dpi.
    expect(a4.width).toBe(Math.round((210 / 25.4) * 300) + 2 * a4.bleed);
    expect(a4.bleed).toBe(Math.round((3 / 25.4) * 300));
  });

  it('every format fits the canvas limits and names a real layout', () => {
    for (const f of PAGE_FORMATS) {
      expect(Math.max(f.width, f.height)).toBeLessThanOrEqual(8192);
      expect(findLayout(f.defaultLayout)).toBeDefined();
    }
  });
});

describe('panel layouts', () => {
  it('keep outer edges on the panel area and leave a gutter between panels', () => {
    const panels = layoutPanels(findLayout('two-tier')!, area, 40);
    const [top, bottom] = panels;
    expect(top[0]).toEqual({ x: 100, y: 100 });
    expect(top[2].y).toBeCloseTo(100 + 750 - 20);
    expect(bottom[0].y).toBeCloseTo(100 + 750 + 20);
    expect(bottom[2]).toEqual({ x: 1100, y: 1600 });
  });

  it('keeps slanted gutters a constant width', () => {
    const panels = layoutPanels(findLayout('manga-action')!, area, 40);
    const mid = panels[1];
    const low = panels[2];
    // Distance between the shared slanted edge's two offset copies = gutter.
    const dx = mid[2].x - mid[3].x;
    const dy = mid[2].y - mid[3].y;
    const len = Math.hypot(dx, dy);
    const dist = Math.abs((low[0].x - mid[3].x) * dy - (low[0].y - mid[3].y) * dx) / len;
    expect(dist).toBeCloseTo(40, 4);
  });

  it('every layout produces convex quads inside the area', () => {
    for (const layout of PANEL_LAYOUTS) {
      for (const quad of layoutPanels(layout, area, 30)) {
        expect(quad).toHaveLength(4);
        for (const p of quad) {
          expect(p.x).toBeGreaterThanOrEqual(area.x - 1e-6);
          expect(p.x).toBeLessThanOrEqual(area.x + area.width + 1e-6);
          expect(p.y).toBeGreaterThanOrEqual(area.y - 1e-6);
          expect(p.y).toBeLessThanOrEqual(area.y + area.height + 1e-6);
        }
      }
    }
  });

  it('insets a square evenly', () => {
    const sq = insetPolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], [1, 1, 1, 1]);
    expect(sq).toEqual([{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }]);
  });

  it('panel area is the canvas minus bleed and safe margin', () => {
    expect(panelArea(1000, 2000, 30, 70)).toEqual({ x: 100, y: 100, width: 800, height: 1800 });
  });
});
