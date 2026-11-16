/**
 * The stands (forest management units) of the map in proposal D's hero: an irregular tessellation of
 * the field, so every area touches its neighbours and there are no gaps (a Voronoi diagram of jittered
 * seeds, clipped to the field). Each stand carries the figures shown when you hover it.
 *
 * Shared by the page (an accessible list of the same data) and the 3D scene. Deterministic, so the
 * build and the browser produce the same map. Figures are illustrative sample values for the prototype.
 */
import { Delaunay } from 'd3-delaunay';

export const FIELD = { W: 88, D: 60 };
/** Scene units² to hectares: the field is about 1,300 ha. */
const HA_PER_UNIT2 = 0.25;

const SPECIES = [
  { name: 'European beech', latin: 'Fagus sylvatica', type: 'Broadleaf', height: [20, 30] },
  { name: 'Pedunculate oak', latin: 'Quercus robur', type: 'Broadleaf', height: [17, 26] },
  { name: 'Maritime pine', latin: 'Pinus pinaster', type: 'Conifer', height: [18, 28] },
  { name: 'Scots pine', latin: 'Pinus sylvestris', type: 'Conifer', height: [16, 27] },
  { name: 'Silver birch', latin: 'Betula pendula', type: 'Broadleaf', height: [12, 20] },
  { name: 'Sweet chestnut', latin: 'Castanea sativa', type: 'Broadleaf', height: [14, 22] },
  { name: 'Black alder', latin: 'Alnus glutinosa', type: 'Riparian', height: [12, 19] },
] as const;

export type Stand = {
  id: string;
  /** Polygon in field coordinates (x, z), closed (last point = first). */
  polygon: [number, number][];
  centroid: [number, number];
  species: string;
  latin: string;
  type: string;
  share: number;
  area: number;
  trees: number;
  height: number;
  carbon: number;
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function areaAndCentroid(poly: [number, number][]) {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[i + 1];
    const f = x0 * z1 - x1 * z0;
    a += f;
    cx += (x0 + x1) * f;
    cz += (z0 + z1) * f;
  }
  a /= 2;
  return { area: Math.abs(a), centroid: [cx / (6 * a), cz / (6 * a)] as [number, number] };
}

function build(): Stand[] {
  const r = rng(23);
  const { W, D } = FIELD;
  const cols = 7;
  const rows = 5;
  const seeds: [number, number][] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const cw = W / cols;
      const ch = D / rows;
      seeds.push([-W / 2 + (i + 0.5 + (r() - 0.5) * 0.8) * cw, -D / 2 + (j + 0.5 + (r() - 0.5) * 0.8) * ch]);
    }
  }
  const voronoi = Delaunay.from(seeds).voronoi([-W / 2, -D / 2, W / 2, D / 2]);
  return seeds.map((_, i) => {
    const polygon = (voronoi.cellPolygon(i) as [number, number][]).map(([x, z]) => [x, z] as [number, number]);
    const { area, centroid } = areaAndCentroid(polygon);
    const sp = SPECIES[Math.floor(r() * SPECIES.length)];
    const ha = area * HA_PER_UNIT2;
    const density = 260 + r() * 420;
    return {
      id: `Stand ${1004}-${String(i + 11).padStart(2, '0')}`,
      polygon,
      centroid,
      species: sp.name,
      latin: sp.latin,
      type: sp.type,
      share: Math.round(45 + r() * 45),
      area: Math.round(ha * 100) / 100,
      trees: Math.round((ha * density) / 10) * 10,
      height: Math.round((sp.height[0] + r() * (sp.height[1] - sp.height[0])) * 10) / 10,
      carbon: Math.round(ha * (60 + r() * 120)),
    };
  });
}

export const STANDS = build();

/** Which stand contains a point (the nearest seed of a Voronoi diagram is the cell it lies in). */
export function standAt(x: number, z: number) {
  const { W, D } = FIELD;
  if (Math.abs(x) > W / 2 || Math.abs(z) > D / 2) return -1;
  let best = -1;
  let bestD = Infinity;
  // Point-in-polygon on the (convex) cells: robust and still cheap for a few dozen stands.
  for (let i = 0; i < STANDS.length; i++) {
    const p = STANDS[i].polygon;
    let inside = true;
    let sign = 0;
    for (let k = 0; k < p.length - 1; k++) {
      const c = (p[k + 1][0] - p[k][0]) * (z - p[k][1]) - (p[k + 1][1] - p[k][1]) * (x - p[k][0]);
      if (c !== 0) {
        const s = Math.sign(c);
        if (sign === 0) sign = s;
        else if (s !== sign) {
          inside = false;
          break;
        }
      }
    }
    if (inside) return i;
    const d = (STANDS[i].centroid[0] - x) ** 2 + (STANDS[i].centroid[1] - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
