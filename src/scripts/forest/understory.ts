/**
 * Everything under the trees, all procedural and instanced (one draw call each):
 * grass tufts, fern clumps (frond texture drawn on a canvas), mossy rocks and fallen logs.
 */
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  Euler,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Scatter } from './layout';
import { patchUnderstory, type SharedUniforms } from './materials';
import { fbm, rng } from './noise';

const GRASS_H = 0.55;
const FERN_H = 0.75;

function tuftGeometry() {
  const r = rng(7);
  const parts: BufferGeometry[] = [];
  const base = new Color('#2f4a1a');
  const tip = new Color('#9cb860');
  for (let b = 0; b < 9; b++) {
    const a = r() * Math.PI * 2;
    const lean = 0.15 + r() * 0.4;
    const h = GRASS_H * (0.55 + r() * 0.5);
    const w = 0.035 + r() * 0.02;
    const ox = Math.cos(a) * r() * 0.12;
    const oz = Math.sin(a) * r() * 0.12;
    const pos: number[] = [];
    const col: number[] = [];
    const segs = 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const y = t * h;
      const bend = t * t * lean * h;
      const ww = w * (1 - t * 0.92);
      const cx = ox + Math.cos(a) * bend;
      const cz = oz + Math.sin(a) * bend;
      const px = -Math.sin(a) * ww;
      const pz = Math.cos(a) * ww;
      pos.push(cx - px, y, cz - pz, cx + px, y, cz + pz);
      const c = base.clone().lerp(tip, t);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const index: number[] = [];
    for (let i = 0; i < segs; i++) {
      const k = i * 2;
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setIndex(index);
    parts.push(g);
  }
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  // Normals pointing up light grass like a lawn, not like paper strips.
  const n = merged.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3);
  return merged;
}

function frondTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 256);
  ctx.strokeStyle = '#3e5a22';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(32, 256);
  ctx.lineTo(32, 6);
  ctx.stroke();
  for (let i = 0; i < 22; i++) {
    const t = i / 22;
    const y = 250 - t * 240;
    const len = 28 * Math.sin(Math.PI * (0.12 + t * 0.88)) * (1 - t * 0.35);
    const g = 0.75 + 0.25 * Math.sin(i * 1.7);
    ctx.fillStyle = `rgb(${Math.round(72 * g)}, ${Math.round(112 * g)}, ${Math.round(40 * g)})`;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(32 + (dir * len) / 2, y - 3, len / 2, 3.2, dir * -0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function fernGeometry() {
  const parts: BufferGeometry[] = [];
  const fronds = 7;
  for (let f = 0; f < fronds; f++) {
    const yaw = (f / fronds) * Math.PI * 2 + (f % 2) * 0.3;
    const segs = 6;
    const pos: number[] = [];
    const uv: number[] = [];
    let y = 0;
    let out = 0;
    const len = FERN_H * (1.2 + (f % 3) * 0.12);
    let theta = 0.35;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const w = 0.17;
      const cx = Math.cos(yaw) * out;
      const cz = Math.sin(yaw) * out;
      const px = -Math.sin(yaw) * w;
      const pz = Math.cos(yaw) * w;
      pos.push(cx - px, y, cz - pz, cx + px, y, cz + pz);
      uv.push(0, t, 1, t);
      const step = len / segs;
      out += Math.sin(theta) * step;
      y += Math.cos(theta) * step;
      theta += 0.24;
    }
    const index: number[] = [];
    for (let i = 0; i < segs; i++) {
      const k = i * 2;
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    parts.push(g);
  }
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  const n = merged.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.4, 1, n.getZ(i) * 0.4);
  return merged;
}

function rockGeometry() {
  const g = new IcosahedronGeometry(1, 3);
  const pos = g.getAttribute('position');
  const col: number[] = [];
  const v = new Vector3();
  const stone = new Color('#7d7a70');
  const moss = new Color('#4d6a2a');
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 + fbm(v.x * 1.4 + 3, v.z * 1.4 + v.y * 1.1, 3) * 0.45;
    v.multiplyScalar(k);
    v.y *= 0.62;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const n = g.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    const up = Math.max(0, n.getY(i));
    const c = stone.clone().lerp(moss, Math.min(1, up * up * 1.4));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return g;
}

function logGeometry() {
  const g = new CylinderGeometry(0.32, 0.4, 7, 10, 4);
  g.rotateZ(Math.PI / 2);
  const n = g.getAttribute('normal');
  const col: number[] = [];
  const bark = new Color('#4a3a2a');
  const moss = new Color('#4a6626');
  for (let i = 0; i < n.count; i++) {
    const up = Math.max(0, n.getY(i));
    const c = bark.clone().lerp(moss, Math.min(1, up * 1.2));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return g;
}

function instance(mesh: InstancedMesh, items: Scatter[], shape: (it: Scatter, m: Matrix4) => void, tone?: (it: Scatter, c: Color) => void) {
  const m = new Matrix4();
  const c = new Color();
  items.forEach((it, i) => {
    shape(it, m);
    mesh.setMatrixAt(i, m);
    if (tone) {
      tone(it, c);
      mesh.setColorAt(i, c);
    }
  });
  mesh.computeBoundingSphere();
  if (mesh.boundingSphere) mesh.boundingSphere.radius += 2;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

export function createUnderstory(shared: SharedUniforms, layout: { grass: Scatter[]; ferns: Scatter[]; rocks: Scatter[]; logs: Scatter[] }) {
  const group = new Group();
  group.name = 'understory';
  const q = new Quaternion();
  const e = new Euler();
  const p = new Vector3();
  const s = new Vector3();

  const grassMat = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  patchUnderstory(grassMat, shared, { height: GRASS_H, stiffness: 1, key: 'grass', fade: [32, 52] });
  const grass = instance(
    new InstancedMesh(tuftGeometry(), grassMat, layout.grass.length),
    layout.grass,
    (it, m) => {
      q.setFromEuler(e.set(0, it.rot, 0));
      m.compose(p.set(it.x, it.y - 0.02, it.z), q, s.setScalar(it.scale));
    },
    (it, c) => c.setRGB(0.8 + it.tone * 0.35, 0.85 + it.tone * 0.25, 0.75 + it.tone * 0.2),
  );

  const fernTex = frondTexture();
  const fernMat = new MeshLambertMaterial({ map: fernTex, side: DoubleSide, alphaTest: 0.5, alphaToCoverage: true });
  patchUnderstory(fernMat, shared, { height: FERN_H, stiffness: 1.6, key: 'fern', fade: [45, 70] });
  const ferns = instance(
    new InstancedMesh(fernGeometry(), fernMat, layout.ferns.length),
    layout.ferns,
    (it, m) => {
      q.setFromEuler(e.set(0, it.rot, 0));
      m.compose(p.set(it.x, it.y - 0.05, it.z), q, s.setScalar(it.scale));
    },
    (it, c) => c.setRGB(0.85 + it.tone * 0.3, 0.9 + it.tone * 0.2, 0.8 + it.tone * 0.1),
  );

  const rockMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  patchUnderstory(rockMat, shared, { height: 100, stiffness: 1000, key: 'rock' });
  const rocks = instance(
    new InstancedMesh(rockGeometry(), rockMat, layout.rocks.length),
    layout.rocks,
    (it, m) => {
      q.setFromEuler(e.set(0, it.rot, 0));
      m.compose(p.set(it.x, it.y, it.z), q, s.set(it.scale * 1.2, it.scale, it.scale));
    },
    (it, c) => c.setScalar(0.8 + it.tone * 0.35),
  );

  const logMat = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  patchUnderstory(logMat, shared, { height: 100, stiffness: 1000, key: 'log' });
  const logs = instance(new InstancedMesh(logGeometry(), logMat, layout.logs.length), layout.logs, (it, m) => {
    q.setFromEuler(e.set(0, it.rot, (it.tone - 0.5) * 0.08));
    m.compose(p.set(it.x, it.y, it.z), q, s.setScalar(it.scale));
  });

  grass.receiveShadow = ferns.receiveShadow = true;
  rocks.castShadow = rocks.receiveShadow = true;
  logs.castShadow = logs.receiveShadow = true;
  group.add(grass, ferns, rocks, logs);
  return {
    group,
    dispose() {
      for (const mesh of [grass, ferns, rocks, logs]) {
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose();
      }
      fernTex.dispose();
    },
  };
}
