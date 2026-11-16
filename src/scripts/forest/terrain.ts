/**
 * The ground: a gently rolling hillside crossed by a trail. Everything that stands on it (trees,
 * camera, grass) reads its height from `heightAt`, and the ground shader repeats `trailX` and the
 * zone limits in GLSL so the painted trail matches the walked one.
 */
import { fbm, smoothstep } from './noise';

export const WORLD = {
  /** Centre and size of the ground plane. Beyond ~380 m it is always hidden by mist. */
  cx: 0,
  cz: -50,
  size: 760,
  /** Trail: starts in the meadow, ends in a small clearing in the pine stand. */
  trailStart: 66,
  trailEnd: -162,
  /** Where the forest starts (meadow beyond), and the limits between stands. */
  edge: 44,
  /** Half-width of the meadow glade around the trail head (the forest closes in on both sides). */
  glade: 24,
  broadleafEnd: -36,
  clearingEnd: -104,
  /** The birch clearing and the wet hollow where the alders grow. */
  clearing: { z: -58, side: 1, offset: 11, r: 13 },
  hollow: { z: -90, side: -1, offset: 19, r: 20 },
  /** The clearing at the end of the trail where the camera rises out of the canopy. */
  exit: { z: -168, r: 10 },
} as const;

/** Trail centre line: x for a given z. Same formula in GLSL (ground.ts). */
export const trailX = (z: number) => 7 * Math.sin(z / 38) + 4 * Math.sin(z / 17 + 1);

export const trailX_GLSL = /* glsl */ `
float trailX(float z) { return 7.0 * sin(z / 38.0) + 4.0 * sin(z / 17.0 + 1.0); }
`;

export function clearingCentre() {
  const { z, side, offset } = WORLD.clearing;
  return { x: trailX(z) + side * offset, z };
}

export function hollowCentre() {
  const { z, side, offset } = WORLD.hollow;
  return { x: trailX(z) + side * offset, z };
}

export function heightAt(x: number, z: number) {
  // Long, soft undulations (wavelength ~90 m) plus a little detail.
  let h = fbm(x * 0.011 + 3.1, z * 0.011 - 7.4, 4) * 9;
  // The meadow is flatter.
  h *= 1 - 0.45 * smoothstep(WORLD.edge - 10, WORLD.edge + 20, z);
  // Hills far away frame the horizon from the air.
  const far = Math.hypot(x - WORLD.cx, (z - WORLD.cz) * 0.85);
  h += smoothstep(200, 360, far) * 38 * (0.6 + 0.4 * fbm(x * 0.006, z * 0.006, 2));
  // The trail sits in a shallow groove worn by walkers.
  const d = x - trailX(z);
  h -= 0.35 * Math.exp(-(d * d) / 6);
  // The wet hollow.
  const ho = hollowCentre();
  const dh = (x - ho.x) ** 2 + (z - ho.z) ** 2;
  h -= 2.4 * Math.exp(-dh / (2 * WORLD.hollow.r * WORLD.hollow.r));
  return h;
}

/** Height of the trail itself, smoothed so the walking camera does not bob. */
export function trailHeight(z: number) {
  let sum = 0;
  let w = 0;
  for (let i = -3; i <= 3; i++) {
    const zz = z + i * 1.5;
    const k = 1 - Math.abs(i) / 4;
    sum += heightAt(trailX(zz), zz) * k;
    w += k;
  }
  return sum / w;
}
