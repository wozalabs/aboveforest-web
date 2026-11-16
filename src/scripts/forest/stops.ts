/** Where the featured trees stand and where the camera stops to look at them (plain numbers, no three.js). */
import { FEATURED_TREES } from '../../data/trees';
import { heightAt, trailHeight, trailX, WORLD } from './terrain';

const WORLD_TRAIL = { start: WORLD.trailStart, end: WORLD.exit.z };

export const EYE = 2.3;

export function treeSpot(i: number) {
  const t = FEATURED_TREES[i];
  const x = trailX(t.z) + t.side * t.offset;
  return { x, y: heightAt(x, t.z), z: t.z };
}

export function stopSpot(i: number) {
  const t = FEATURED_TREES[i];
  const z = t.z + 16;
  const lat = -t.side * 1.4;
  return { z, lat, x: trailX(z) + lat, y: trailHeight(z) + EYE };
}

/**
 * How "physical" the world is at a point (0 = only the LiDAR point cloud, 1 = real ground, grass and
 * light): a band along the trail and a pool around each featured tree. The ground shader repeats it.
 */
export const PHYS = { band: [3.5, 9.5] as const, pool: [9, 16] as const };

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function physicalAt(x: number, z: number) {
  const d = Math.abs(x - trailX(z));
  const along = smooth(WORLD_TRAIL.end - 10, WORLD_TRAIL.end, z) * smooth(WORLD_TRAIL.start + 14, WORLD_TRAIL.start, z);
  let m = (1 - smooth(PHYS.band[0], PHYS.band[1], d)) * along;
  for (let i = 0; i < FEATURED_TREES.length; i++) {
    const t = treeSpot(i);
    m = Math.max(m, 1 - smooth(PHYS.pool[0], PHYS.pool[1], Math.hypot(x - t.x, z - t.z)));
  }
  return m;
}
