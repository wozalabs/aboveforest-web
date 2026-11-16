/**
 * The camera rig: one number, the shot index `k` (0 … SHOT_COUNT − 1, fractional in between), gives
 * a camera position and a look target. The air legs (hero → trail, trail → sky) are crane moves;
 * on the trail the camera walks at eye height and turns its head towards each featured tree.
 */
import { Vector3 } from 'three';
import { FEATURED_TREES } from '../../data/trees';
import { SHOT } from '../../data/timeline';
import { heightAt, trailHeight, trailX, WORLD } from './terrain';
import { smoothstep } from './noise';

import { EYE, stopSpot, treeSpot } from './stops';

export type Walk = { z: number; lat: number; eye: number; dir: Vector3 };

export function featuredPosition(i: number) {
  const p = treeSpot(i);
  return new Vector3(p.x, p.y, p.z);
}

export function stopCamera(i: number) {
  const s = stopSpot(i);
  return { z: s.z, lat: s.lat, pos: new Vector3(s.x, s.y, s.z) };
}

function ahead(z: number, lift = 0.06) {
  const dz = -8;
  return new Vector3(trailX(z + dz) - trailX(z), lift * 8, dz).normalize();
}

/** Direction from yaw (around y, 0 = towards −z) and pitch (radians, up positive). */
function fromAngles(yaw: number, pitch: number, out: Vector3) {
  return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}
function anglesOf(dir: Vector3) {
  return { yaw: Math.atan2(-dir.x, -dir.z), pitch: Math.asin(Math.max(-1, Math.min(1, dir.y))) };
}
function bezier(a: Vector3, b: Vector3, c: Vector3, t: number, out: Vector3) {
  const u = 1 - t;
  return out.set(0, 0, 0).addScaledVector(a, u * u).addScaledVector(b, 2 * u * t).addScaledVector(c, t * t);
}
const DEG = Math.PI / 180;

/**
 * The air legs are one continuous crane move each, never a swing: the camera keeps facing down the
 * trail (−z) and only its height and pitch change. Down: a glide that lands on the trail head as it
 * levels out. Up: through the gap in the canopy, turning round to look back over the trail.
 */
type Crane = { a: Vector3; b: Vector3; c: Vector3; yaw0: number; yaw1: number; pitch0: number; pitch1: number; turn: [number, number] };

export function createRig() {
  let aim = 0.8;
  let walks: Walk[] = [];
  let down: Crane;
  let up: Crane;

  function build() {
    const enterZ = 60;
    const enter: Walk = { z: enterZ, lat: 0, eye: EYE, dir: ahead(enterZ, 0.05) };
    const stops: Walk[] = FEATURED_TREES.map((tree, i) => {
      const cam = stopCamera(i);
      const target = featuredPosition(i).add(new Vector3(0, tree.height * 0.3, 0));
      const toTree = target.clone().sub(cam.pos).normalize();
      const dir = ahead(cam.z, 0.1).lerp(toTree, aim).normalize();
      return { z: cam.z, lat: cam.lat, eye: EYE, dir };
    });
    const endZ = WORLD.exit.z + 6;
    const end: Walk = { z: endZ, lat: 0, eye: EYE, dir: ahead(endZ, 0.2) };
    walks = [enter, ...stops, end];

    const enterA = anglesOf(enter.dir);
    down = {
      a: new Vector3(trailX(132) - 4, heightAt(trailX(132), 132) + 70, 132),
      b: new Vector3(trailX(92), trailHeight(92) + 5, 92),
      c: walkPos(enter),
      yaw0: 0,
      yaw1: enterA.yaw,
      pitch0: -30 * DEG,
      pitch1: enterA.pitch,
      turn: [0.12, 0.96],
    };

    const ex = trailX(WORLD.exit.z);
    const g = heightAt(ex, WORLD.exit.z);
    const endA = anglesOf(end.dir);
    up = {
      a: walkPos(end),
      b: new Vector3(ex, g + 46, WORLD.exit.z - 22),
      c: new Vector3(ex + 8, g + 88, WORLD.exit.z - 72),
      // Turn round while rising, to end looking back over the trail you walked.
      yaw0: endA.yaw,
      yaw1: Math.PI,
      pitch0: endA.pitch,
      pitch1: -30 * DEG,
      turn: [0, 0.75],
    };
  }

  function walkPos(w: Walk) {
    return new Vector3(trailX(w.z) + w.lat, trailHeight(w.z) + w.eye, w.z);
  }

  const tmpA = new Vector3();
  const tmpB = new Vector3();

  function crane(c: Crane, t: number, pos: Vector3, look: Vector3) {
    bezier(c.a, c.b, c.c, t, pos);
    const k = smoothstep(c.turn[0], c.turn[1], t);
    fromAngles(c.yaw0 + (c.yaw1 - c.yaw0) * k, c.pitch0 + (c.pitch1 - c.pitch0) * k, tmpA);
    look.copy(pos).addScaledVector(tmpA, 20);
  }

  /** Camera position and look target for shot index k. */
  function at(k: number, pos: Vector3, look: Vector3) {
    if (k <= SHOT.enter) return crane(down, Math.max(0, k) / SHOT.enter, pos, look);
    if (k >= SHOT.trailEnd) return crane(up, Math.min(1, (k - SHOT.trailEnd) / (SHOT.riseTop - SHOT.trailEnd)), pos, look);
    const i = Math.floor(k - SHOT.enter);
    const t = k - SHOT.enter - i;
    const a = walks[i];
    const b = walks[Math.min(walks.length - 1, i + 1)];
    const z = a.z + (b.z - a.z) * t;
    const lat = a.lat + (b.lat - a.lat) * t;
    const eye = a.eye + (b.eye - a.eye) * t;
    pos.set(trailX(z) + lat, trailHeight(z) + eye, z);
    // Head turn: from tree A to the trail ahead, then from the trail to tree B.
    const fwd = ahead(z, 0.07);
    if (t < 0.5) tmpA.copy(a.dir).lerp(fwd, smoothstep(0, 0.5, t));
    else tmpA.copy(fwd).lerp(b.dir, smoothstep(0.5, 1, t));
    tmpB.copy(tmpA).normalize();
    look.copy(pos).addScaledVector(tmpB, 20);
  }

  build();
  return {
    at,
    /** How much the stop shots turn towards the tree (portrait screens centre it). */
    setAim(value: number) {
      if (Math.abs(value - aim) < 1e-3) return;
      aim = value;
      build();
    },
  };
}
