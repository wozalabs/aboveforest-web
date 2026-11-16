/**
 * Plants the forest: where every tree, shrub, fern, grass tuft, rock and log goes. Deterministic
 * (seeded), computed once on the main thread in a few milliseconds.
 *
 * Stands follow the trail: meadow at the forest edge, beech and oak, a birch clearing with an alder
 * hollow, then a pine and larch plantation. Boundaries wobble with noise so they read as natural
 * ecotones rather than lines.
 */
import { FEATURED_TREES, type TreeModel } from '../../data/trees';
import { clamp, fbm, rng, smoothstep } from './noise';
import { SPECIES, STANDS } from './species';
import { clearingCentre, heightAt, hollowCentre, trailX, WORLD } from './terrain';
import { physicalAt, stopSpot, treeSpot } from './stops';

export type Plant = {
  model: TreeModel;
  x: number;
  y: number;
  z: number;
  rot: number;
  /** Uniform height scale applied to the model (target height / model height is resolved later). */
  height: number;
  /** Horizontal stretch, for variety. */
  spread: number;
  /** Instance colour (multiplies the leaves). */
  color: [number, number, number];
  featured?: number;
};

export type Scatter = { x: number; y: number; z: number; rot: number; scale: number; tone: number };

export type Quality = {
  /** Multiplies spacing far from the trail (bigger = fewer trees). */
  farSpacing: number;
  nearSpacing: number;
  grass: number;
  ferns: number;
  /** How far from the trail the forest extends sideways. */
  width: number;
};

export type Layout = {
  plants: Plant[];
  grass: Scatter[];
  ferns: Scatter[];
  rocks: Scatter[];
  logs: Scatter[];
  shade: Shade;
};

type Stand = keyof typeof STANDS;

function standAt(x: number, z: number): Stand {
  const wobble = fbm(x * 0.03 + 11, z * 0.03 - 4, 3) * 14;
  const zz = z + wobble;
  const ho = hollowCentre();
  if (Math.hypot(x - ho.x, z - ho.z) < WORLD.hollow.r * 1.35 + wobble * 0.4) return 'hollow';
  if (zz > WORLD.edge && Math.abs(x - trailX(z)) + wobble * 1.4 < WORLD.glade) return 'meadow';
  if (zz > WORLD.broadleafEnd) return 'broadleaf';
  if (zz > WORLD.broadleafEnd) return 'broadleaf';
  if (zz > WORLD.clearingEnd) return 'clearing';
  return 'conifer';
}

function pick<T>(list: [T, number][], r: number): T {
  let acc = 0;
  for (const [v, w] of list) {
    acc += w;
    if (r <= acc) return v;
  }
  return list[list.length - 1][0];
}

/** Spatial hash for minimum-distance placement with a variable radius. */
function createHash(cell: number) {
  const map = new Map<number, { x: number; z: number; r: number }[]>();
  const key = (i: number, j: number) => (i + 2048) * 4096 + (j + 2048);
  return {
    add(x: number, z: number, r: number) {
      const k = key(Math.floor(x / cell), Math.floor(z / cell));
      const list = map.get(k);
      if (list) list.push({ x, z, r });
      else map.set(k, [{ x, z, r }]);
    },
    /** `own`: only this point's radius counts (understory next to trees). */
    free(x: number, z: number, r: number, reach: number, own = false) {
      const ci = Math.floor(x / cell);
      const cj = Math.floor(z / cell);
      const n = Math.ceil(reach / cell);
      for (let i = ci - n; i <= ci + n; i++) {
        for (let j = cj - n; j <= cj + n; j++) {
          const list = map.get(key(i, j));
          if (!list) continue;
          for (const p of list) {
            const min = own ? r : Math.max(r, p.r);
            if ((p.x - x) ** 2 + (p.z - z) ** 2 < min * min) return false;
          }
        }
      }
      return true;
    },
  };
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Sea-green leaves turning warm: early autumn on a few deciduous trees. */
function leafColor(model: TreeModel, r: () => number): [number, number, number] {
  const s = SPECIES[model];
  const v = 0.86 + r() * 0.24;
  if (r() < s.autumn) {
    const k = 0.35 + r() * 0.45;
    return [v * (1 + 0.55 * k), v * (1 + 0.12 * k), v * (1 - 0.45 * k)];
  }
  const hue = (r() - 0.5) * 0.12;
  return [v * (1 + hue), v, v * (1 - hue * 0.6)];
}

export function plantForest(q: Quality): Layout {
  const r = rng(20261106);
  const plants: Plant[] = [];
  const hash = createHash(8);
  const maxR = 30;

  // Featured trees first, with a wide berth so nothing crowds them, and a clear sight line.
  const sightLines = FEATURED_TREES.map((t, i) => {
    const p = treeSpot(i);
    const cam = stopSpot(i);
    plants.push({
      model: t.model,
      x: p.x,
      y: p.y,
      z: p.z,
      rot: r() * Math.PI * 2,
      height: t.height,
      spread: 1,
      color: leafColor(t.model, () => 0.5),
      featured: i,
    });
    hash.add(p.x, p.z, 6.5);
    return { ax: cam.x, az: cam.z, bx: p.x, bz: p.z };
  });

  const cl = clearingCentre();
  const zMin = -400;
  const zMax = 170;
  const xMax = q.width;

  // Dart throwing. Spacing grows away from the trail; the pine stand is planted in loose rows.
  const attempts = 150000;
  for (let n = 0; n < attempts; n++) {
    const z = zMin + r() * (zMax - zMin);
    const tx = trailX(z);
    const x = tx + (r() * 2 - 1) * xMax;
    const d = Math.abs(x - tx);
    const onTrail = z < WORLD.trailStart + 30 && z > WORLD.trailEnd - 20;
    if (onTrail && d < 3.6) continue;
    if (Math.hypot(x - cl.x, z - cl.z) < WORLD.clearing.r * (0.75 + 0.3 * r())) continue;
    if (Math.hypot(x - trailX(WORLD.exit.z), z - WORLD.exit.z) < WORLD.exit.r) continue;
    if (d < 20 && sightLines.some((s) => distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < 3.2)) continue;
    // Cheap early-out before any noise: closer than the tightest spacing to an existing tree.
    if (!hash.free(x, z, 3.9, 8, true)) continue;

    const stand = standAt(x, z);
    let spacing = stand === 'meadow' ? 15 : stand === 'clearing' ? 6.8 : stand === 'hollow' ? 6 : stand === 'conifer' ? 4.9 : 5.3;
    // Groves and gaps: density drifts across the stand, so it never reads as a planted park.
    spacing *= 0.82 + 0.5 * Math.max(0, fbm(x * 0.045 - 21, z * 0.045 + 5, 3) + 0.5);
    const far = smoothstep(30, 70, d);
    spacing *= q.nearSpacing + (q.farSpacing - q.nearSpacing) * far;
    // Meadow thins out further from the forest edge.
    if (stand === 'meadow' && r() < 0.5) continue;

    let px = x;
    let pz = z;
    if (stand === 'conifer') {
      // Rows: snap loosely to a rotated grid.
      const a = 0.21;
      const u = px * Math.cos(a) - pz * Math.sin(a);
      const v = px * Math.sin(a) + pz * Math.cos(a);
      const row = 5.2 * (q.nearSpacing + (q.farSpacing - q.nearSpacing) * far);
      const vu = Math.round(v / row) * row + (r() - 0.5) * 1.2;
      px = u * Math.cos(a) + vu * Math.sin(a);
      pz = -u * Math.sin(a) + vu * Math.cos(a);
      if (Math.abs(px - trailX(pz)) < 3.6 && pz < WORLD.trailStart && pz > WORLD.trailEnd - 20) continue;
    }

    if (!hash.free(px, pz, spacing, maxR)) continue;
    hash.add(px, pz, spacing);

    const model = pick(STANDS[stand], r());
    const s = SPECIES[model];
    // Trees at the meadow edge and in the clearing grow a little shorter and wider.
    const open = stand === 'meadow' ? 0.82 : 1;
    const height = (s.height[0] + (s.height[1] - s.height[0]) * r()) * open;
    plants.push({
      model,
      x: px,
      y: heightAt(px, pz),
      z: pz,
      rot: r() * Math.PI * 2,
      height,
      spread: 0.9 + r() * 0.22,
      color: leafColor(model, r),
    });
  }

  // Understory: holly under the beeches, shrubs along edges and the trail.
  const under = createHash(4);
  let shrubs = 0;
  for (let n = 0; n < 9000 && shrubs < 420; n++) {
    const z = WORLD.trailEnd - 30 + r() * (WORLD.trailStart + 60 - (WORLD.trailEnd - 30));
    const tx = trailX(z);
    const x = tx + (r() * 2 - 1) * 34;
    const d = Math.abs(x - tx);
    if (d < 2.4) continue;
    if (sightLines.some((s) => distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < 2.2)) continue;
    const stand = standAt(x, z);
    const holly = stand === 'broadleaf' && r() < 0.4;
    const p = stand === 'conifer' ? 0.25 : stand === 'meadow' ? 0.45 : 0.8;
    if (r() > p * (1 - smoothstep(10, 46, d) * 0.6)) continue;
    const sp = holly ? 4.5 : 3.6;
    if (!under.free(x, z, sp, 8) || !hash.free(x, z, holly ? 3 : 2, maxR, true)) continue;
    under.add(x, z, sp);
    shrubs++;
    const model: TreeModel = holly ? 'tree-perenne' : 'arbusto';
    const s = SPECIES[model];
    plants.push({
      model,
      x,
      y: heightAt(x, z),
      z,
      rot: r() * Math.PI * 2,
      height: s.height[0] + (s.height[1] - s.height[0]) * r(),
      spread: 0.85 + r() * 0.4,
      color: leafColor(model, r),
    });
  }

  const shade = buildShade(plants);

  // Grass: in the open and along the trail edges, sparse in deep shade and under pines.
  const grass: Scatter[] = [];
  for (let n = 0; n < q.grass * 4 && grass.length < q.grass; n++) {
    const z = WORLD.trailEnd - 12 + r() * (WORLD.trailStart + 50 - (WORLD.trailEnd - 12));
    const tx = trailX(z);
    const x = tx + (r() * 2 - 1) * 16;
    const d = Math.abs(x - tx);
    if (d < 0.55 + r() * 0.6) continue;
    const phys = physicalAt(x, z);
    if (phys < 0.05) continue;
    const stand = standAt(x, z);
    const occ = shade.sample(x, z).canopy;
    let p = (1 - occ * 0.6) * phys;
    if (stand === 'conifer') p *= 0.35;
    p *= 1 - smoothstep(6, 24, d) * 0.55;
    p = Math.max(p, smoothstep(2.4, 0.8, d) * 0.9 * phys); // trail edges
    if (r() > p) continue;
    grass.push({ x, y: heightAt(x, z), z, rot: r() * Math.PI * 2, scale: 0.6 + r() * 0.75, tone: r() });
  }

  // Ferns: they like shade and the damp hollow.
  const ferns: Scatter[] = [];
  for (let n = 0; n < q.ferns * 5 && ferns.length < q.ferns; n++) {
    const z = WORLD.trailEnd - 20 + r() * (WORLD.edge + 10 - (WORLD.trailEnd - 20));
    const tx = trailX(z);
    const x = tx + (r() * 2 - 1) * 16;
    const d = Math.abs(x - tx);
    if (d < 1.4) continue;
    const phys = physicalAt(x, z);
    if (phys < 0.1) continue;
    if (sightLines.some((s) => distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < 1.2)) continue;
    const stand = standAt(x, z);
    const occ = shade.sample(x, z).canopy;
    let p = (0.25 + occ * 0.7) * phys;
    if (stand === 'hollow') p += 0.4;
    if (stand === 'conifer') p *= 0.6;
    if (r() > p) continue;
    ferns.push({ x, y: heightAt(x, z), z, rot: r() * Math.PI * 2, scale: 0.7 + r() * 0.7, tone: r() });
  }

  const rocks: Scatter[] = [];
  for (let n = 0; n < 3000 && rocks.length < 60; n++) {
    const z = WORLD.trailEnd - 20 + r() * (WORLD.trailStart - WORLD.trailEnd + 40);
    const tx = trailX(z);
    const x = tx + (r() * 2 - 1) * 14;
    if (Math.abs(x - tx) < 1.6) continue;
    if (physicalAt(x, z) < 0.4) continue;
    const stand = standAt(x, z);
    if (stand === 'meadow' && r() < 0.6) continue;
    const scale = 0.35 + r() ** 2 * 1.6;
    rocks.push({ x, y: heightAt(x, z) - scale * 0.35, z, rot: r() * Math.PI * 2, scale, tone: r() });
  }

  const logs: Scatter[] = [];
  for (let n = 0; n < 2000 && logs.length < 9; n++) {
    const z = WORLD.trailEnd + r() * (WORLD.edge - WORLD.trailEnd);
    const tx = trailX(z);
    const x = tx + (r() < 0.5 ? -1 : 1) * (4 + r() * 6);
    if (physicalAt(x, z) < 0.5) continue;
    if (sightLines.some((s) => distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < 3)) continue;
    if (!hash.free(x, z, 3.5, maxR, true)) continue;
    logs.push({ x, y: heightAt(x, z) + 0.2, z, rot: r() * Math.PI, scale: 0.7 + r() * 0.6, tone: r() });
  }

  return { plants, grass, ferns, rocks, logs, shade };
}

/* ------------------------------------------------------------------------------------------------
 * Canopy shade map: every crown splats a soft disc. The ground, grass and trunks read it (dark under
 * dense crowns, sun flecks in gaps), and the camera reads it to know how deep in the forest it is.
 * --------------------------------------------------------------------------------------------- */
export type Shade = {
  /** World rectangle covered: x0, z0, size x, size z. */
  rect: [number, number, number, number];
  res: number;
  /** RGBA bytes: R = canopy cover, G = trunk contact shadow. */
  data: Uint8Array;
  sample(x: number, z: number): { canopy: number; contact: number };
};

function buildShade(plants: Plant[]): Shade {
  const res = 256;
  const x0 = -300;
  const z0 = -340;
  const sx = 600;
  const sz = 520;
  const canopy = new Float32Array(res * res);
  const contact = new Float32Array(res * res);
  const px = sx / res;
  const pz = sz / res;
  for (const p of plants) {
    const s = SPECIES[p.model];
    const radius = Math.max(1, p.height * s.crown * p.spread);
    const strength = p.model === 'arbusto' ? 0.25 : 0.75;
    splat(canopy, (p.x - x0) / px, (p.z - z0) / pz, radius / px, strength);
    if (p.model !== 'arbusto') splat(contact, (p.x - x0) / px, (p.z - z0) / pz, 1.6 / px, 0.9);
  }
  function splat(buf: Float32Array, cx: number, cz: number, rad: number, a: number) {
    const reach = Math.ceil(rad * 1.6);
    const i0 = Math.max(0, Math.floor(cx - reach));
    const i1 = Math.min(res - 1, Math.ceil(cx + reach));
    const j0 = Math.max(0, Math.floor(cz - reach));
    const j1 = Math.min(res - 1, Math.ceil(cz + reach));
    const inv = 1 / (2 * (rad * 0.75) ** 2);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d2 = (i - cx) ** 2 + (j - cz) ** 2;
        buf[j * res + i] += a * Math.exp(-d2 * inv);
      }
    }
  }
  const data = new Uint8Array(res * res * 4);
  for (let k = 0; k < res * res; k++) {
    data[k * 4] = Math.round((1 - Math.exp(-canopy[k] * 1.4)) * 255);
    data[k * 4 + 1] = Math.round(Math.min(1, contact[k]) * 255);
    data[k * 4 + 2] = 0;
    data[k * 4 + 3] = 255;
  }
  return withSampler({ rect: [x0, z0, sx, sz], res, data });
}

/** Rebuilds the sampler around shade data (it does not survive the trip back from the worker). */
export function withSampler(raw: Omit<Shade, 'sample'>): Shade {
  const { rect, res, data } = raw;
  const [x0, z0, sx, sz] = rect;
  return {
    rect,
    res,
    data,
    sample(x, z) {
      const fx = clamp(((x - x0) / sx) * res - 0.5, 0, res - 1.001);
      const fz = clamp(((z - z0) / sz) * res - 0.5, 0, res - 1.001);
      const i = Math.floor(fx);
      const j = Math.floor(fz);
      const u = fx - i;
      const v = fz - j;
      const at = (ii: number, jj: number, c: number) => data[(jj * res + ii) * 4 + c] / 255;
      const bil = (c: number) =>
        (at(i, j, c) * (1 - u) + at(i + 1, j, c) * u) * (1 - v) + (at(i, j + 1, c) * (1 - u) + at(i + 1, j + 1, c) * u) * v;
      return { canopy: bil(0), contact: bil(1) };
    },
  };
}
