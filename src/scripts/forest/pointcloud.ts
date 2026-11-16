/**
 * The digital forest: every tree that is not featured is drawn as a LiDAR-like point cloud.
 * Each species gets a template of points sampled from its own model (leaf cards and bark, area
 * weighted), and every tree is one instance of that template: one draw call per species, no
 * textures, no lighting. Points sway with the same wind as the real trees and fade into the mist.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { TreeModel } from '../../data/trees';
import type { Plant } from './layout';
import type { SharedUniforms } from './materials';
import { rng } from './noise';
import { SPECIES } from './species';
import type { TreeAsset } from './trees';

/** Random points on the triangles of a geometry, proportional to area. */
function sample(geometry: BufferGeometry, count: number, r: () => number) {
  const pos = geometry.getAttribute('position') as BufferAttribute;
  const index = geometry.index;
  const tris = index ? index.count / 3 : pos.count / 3;
  const at = (t: number, j: number) => (index ? index.getX(t * 3 + j) : t * 3 + j);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const areas = new Float32Array(tris);
  let total = 0;
  for (let t = 0; t < tris; t++) {
    a.fromBufferAttribute(pos, at(t, 0));
    b.fromBufferAttribute(pos, at(t, 1));
    c.fromBufferAttribute(pos, at(t, 2));
    total += b.sub(a).cross(c.sub(a)).length() * 0.5;
    areas[t] = total;
  }
  const out: number[] = [];
  for (let n = 0; n < count; n++) {
    const target = r() * total;
    let lo = 0;
    let hi = tris - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (areas[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    let u = r();
    let v = r();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    a.fromBufferAttribute(pos, at(lo, 0));
    b.fromBufferAttribute(pos, at(lo, 1)).sub(a);
    c.fromBufferAttribute(pos, at(lo, 2)).sub(a);
    a.addScaledVector(b, u).addScaledVector(c, v);
    out.push(a.x, a.y, a.z);
  }
  return out;
}

export type PointPalette = { leafLow: Color; leafHigh: Color; bark: Color };

export function createPointForest(
  assets: Record<TreeModel, TreeAsset>,
  plants: Plant[],
  shared: SharedUniforms,
  opts: { perTree: number; fog: { color: Color; near: { value: number }; far: { value: number } } },
) {
  const r = rng(314);
  const group = new Group();
  group.name = 'point-forest';
  const palette: PointPalette = { leafLow: new Color(), leafHigh: new Color(), bark: new Color() };
  const uniforms = {
    uTime: shared.uTime,
    uGust: shared.uGust,
    uFogColor: { value: opts.fog.color },
    uFogNear: opts.fog.near,
    uFogFar: opts.fog.far,
    uFocal: { value: 800 },
    uSize: { value: 0.2 },
    uPixel: { value: 1 },
    uLeafLow: { value: palette.leafLow },
    uLeafHigh: { value: palette.leafHigh },
    uBark: { value: palette.bark },
  };

  const byModel = new Map<TreeModel, Plant[]>();
  for (const p of plants) {
    if (p.featured != null) continue;
    const list = byModel.get(p.model);
    if (list) list.push(p);
    else byModel.set(p.model, [p]);
  }

  let total = 0;
  const materials: ShaderMaterial[] = [];
  for (const [model, list] of byModel) {
    const asset = assets[model];
    const small = model === 'arbusto' || model === 'tree-perenne';
    const count = Math.round(opts.perTree * (small ? 0.35 : 1));
    const barkCount = Math.round(count * (model === 'tree-pino' || model === 'tree-conifera' || model === 'tree-alerce' ? 0.22 : 0.18));
    const leaf = sample(asset.leaves, count - barkCount, r);
    const bark = sample(asset.bark, barkCount, r);
    const position = new Float32Array([...leaf, ...bark]);
    const tone = new Float32Array(count);
    const kind = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      tone[i] = r();
      kind[i] = i >= count - barkCount ? 1 : 0;
    }

    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
    geometry.setAttribute('tone', new Float32BufferAttribute(tone, 1));
    geometry.setAttribute('kind', new Float32BufferAttribute(kind, 1));
    const offset = new Float32Array(list.length * 3);
    const rs = new Float32Array(list.length * 4);
    list.forEach((p, i) => {
      const k = p.height / asset.native;
      offset.set([p.x, p.y - 0.05, p.z], i * 3);
      rs.set([Math.cos(p.rot), Math.sin(p.rot), k * p.spread, k], i * 4);
    });
    geometry.setAttribute('iOffset', new InstancedBufferAttribute(offset, 3));
    geometry.setAttribute('iRS', new InstancedBufferAttribute(rs, 4));
    geometry.instanceCount = list.length;
    total += list.length * count;

    const material = new ShaderMaterial({
      uniforms: { ...uniforms, uNative: { value: asset.native }, uWind: { value: SPECIES[model].wind } },
      vertexShader: /* glsl */ `
        attribute float tone;
        attribute float kind;
        attribute vec3 iOffset;
        attribute vec4 iRS;
        uniform float uTime;
        uniform float uGust;
        uniform float uNative;
        uniform float uWind;
        uniform float uFocal;
        uniform float uSize;
        uniform float uPixel;
        uniform float uFogNear;
        uniform float uFogFar;
        varying float vTone;
        varying float vH;
        varying float vKind;
        varying float vFog;
        void main() {
          vec3 p = position;
          float hN = clamp(p.y / uNative, 0.0, 1.2);
          float ph = iOffset.x * 0.043 + iOffset.z * 0.061;
          float bend = hN * hN * uWind * uGust * uNative;
          p.x += (sin(uTime * 0.62 + ph) * 0.65 + sin(uTime * 1.31 + ph * 1.7) * 0.35) * bend * 0.011;
          p.z += cos(uTime * 0.47 + ph * 1.3) * bend * 0.007;
          vec3 w = vec3(p.x * iRS.x + p.z * iRS.y, p.y, -p.x * iRS.y + p.z * iRS.x);
          w.xz *= iRS.z;
          w.y *= iRS.w;
          w += iOffset;
          vec4 mv = viewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = max(-mv.z, 0.1);
          // A constant size in the world (20 cm), clamped to stay crisp: 1.5 to 2.8 device pixels.
          gl_PointSize = clamp(uSize * uFocal / d, 1.5 * uPixel, 2.8 * uPixel);
          // Thin the cloud right in front of the lens, so it never turns into a snowstorm.
          if (d < 2.5 + tone * 6.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          vTone = tone;
          vH = hN;
          vKind = kind;
          vFog = smoothstep(uFogNear, uFogFar, d);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uLeafLow;
        uniform vec3 uLeafHigh;
        uniform vec3 uBark;
        uniform vec3 uFogColor;
        varying float vTone;
        varying float vH;
        varying float vKind;
        varying float vFog;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          if (dot(c, c) > 0.25) discard;
          vec3 col = vKind > 0.5 ? uBark : mix(uLeafLow, uLeafHigh, clamp(vH * 0.85 + (vTone - 0.5) * 0.3, 0.0, 1.0));
          col *= 0.86 + 0.28 * vTone;
          gl_FragColor = vec4(mix(col, uFogColor, vFog), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    materials.push(material);
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    points.name = `points-${model}`;
    group.add(points);
  }

  return {
    group,
    palette,
    points: total,
    setFocal(focal: number, pixel: number) {
      uniforms.uFocal.value = focal;
      uniforms.uPixel.value = pixel;
      for (const m of materials) {
        m.uniforms.uFocal.value = focal;
        m.uniforms.uPixel.value = pixel;
      }
    },
    dispose() {
      group.children.forEach((c) => (c as Points).geometry.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
