/**
 * Air and light: the sky dome (mist at the horizon, open sky above, a soft sun), light shafts through
 * the canopy, floating dust that catches them, and the LiDAR scan drawn over the selected tree.
 * All additive or unlit, none of it writes depth, so it costs little more than its pixels.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Points,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type BufferAttribute,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SharedUniforms } from './materials';
import { rng } from './noise';
import { heightAt, trailX, WORLD } from './terrain';

export function createSky(shared: SharedUniforms) {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      uHorizon: { value: new Color() },
      uZenith: { value: new Color() },
      uSunColor: { value: new Color('#fff1d6') },
      uSunDir: shared.uSunDir,
      uDark: shared.uDark,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      uniform float uDark;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float up = smoothstep(-0.02, 0.55, d.y);
        vec3 col = mix(uHorizon, uZenith, up);
        float s = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.08) * (1.0 - 0.5 * uDark);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(new SphereGeometry(900, 32, 16), material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.name = 'sky';
  return { mesh, horizon: material.uniforms.uHorizon.value as Color, zenith: material.uniforms.uZenith.value as Color };
}

/** Tall soft beams along the sun direction, where the canopy has gaps near the trail. */
export function createShafts(shared: SharedUniforms, count: number, sample: (x: number, z: number) => { canopy: number }) {
  const a = new PlaneGeometry(1, 1);
  a.translate(0, 0.5, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const geometry = mergeGeometries([a, b])!;
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    toneMapped: false,
    uniforms: {
      uTime: shared.uTime,
      uDark: shared.uDark,
      uSunDir: shared.uSunDir,
      uColor: { value: new Color('#ffe7b8') },
      uStrength: { value: 0.05 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vFade;
      varying float vSeed;
      uniform vec3 uSunDir;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        float dist = distance(world.xyz, cameraPosition);
        vec3 view = normalize(world.xyz - cameraPosition);
        // Beams show when you look towards the sun, and fade when you are inside them.
        float toward = max(dot(view, uSunDir), 0.0);
        vFade = smoothstep(12.0, 30.0, dist) * (1.0 - smoothstep(70.0, 130.0, dist)) * (0.3 + 0.7 * toward * toward);
        vSeed = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.11;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uDark;
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec2 vUv;
      varying float vFade;
      varying float vSeed;
      void main() {
        float across = sin(3.14159 * vUv.x);
        across = across * across * across;
        float along = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
        float flicker = 0.75 + 0.25 * sin(uTime * 0.35 + vSeed);
        float a = across * along * flicker * vFade * uDark * uStrength;
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new InstancedMesh(geometry, material, count);
  const r = rng(99);
  const m = new Matrix4();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), shared.uSunDir.value.clone().normalize());
  const s = new Vector3();
  let placed = 0;
  for (let n = 0; n < count * 40 && placed < count; n++) {
    const z = WORLD.trailEnd + r() * (WORLD.edge - 6 - WORLD.trailEnd);
    const x = trailX(z) + (r() * 2 - 1) * 26;
    const shade = sample(x, z).canopy;
    // Light comes through gaps in a closed canopy: not in the open, not in the darkest spots.
    if (shade < 0.35 || shade > 0.85 || r() > 0.6) continue;
    const len = 34 + r() * 18;
    const w = 1.6 + r() * 3.2;
    m.compose(new Vector3(x, heightAt(x, z) - 0.5, z), q, s.set(w, len, w));
    mesh.setMatrixAt(placed++, m);
  }
  mesh.count = placed;
  mesh.computeBoundingSphere();
  mesh.renderOrder = 5;
  mesh.name = 'shafts';
  return mesh;
}

/** Dust motes in a box that travels with the camera (wrapped in the shader). */
export function createDust(shared: SharedUniforms, count: number) {
  const r = rng(5);
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = r();
    pos[i * 3 + 1] = r();
    pos[i * 3 + 2] = r();
    seed[i] = r();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geometry.setAttribute('seed', new Float32BufferAttribute(seed, 1));
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    toneMapped: false,
    uniforms: {
      uTime: shared.uTime,
      uDark: shared.uDark,
      uSunDir: shared.uSunDir,
      uBox: { value: new Vector3(36, 12, 36) },
      uPixel: { value: 1 },
      uColor: { value: new Color('#fff0cc') },
    },
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uTime;
      uniform vec3 uBox;
      uniform float uPixel;
      uniform vec3 uSunDir;
      varying float vAlpha;
      void main() {
        vec3 p = position * uBox;
        p += vec3(sin(uTime * 0.11 + seed * 40.0) * 1.5, uTime * (0.05 + seed * 0.05), cos(uTime * 0.09 + seed * 31.0) * 1.5);
        vec3 c = cameraPosition - vec3(uBox.x * 0.5, 2.0, uBox.z * 0.5);
        p = mod(p - c, uBox) + c;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        vec3 view = normalize(p - cameraPosition);
        float toward = max(dot(view, uSunDir), 0.0);
        float twinkle = 0.6 + 0.4 * sin(uTime * (0.8 + seed) + seed * 20.0);
        vAlpha = smoothstep(0.8, 3.0, d) * (1.0 - smoothstep(10.0, 18.0, d)) * (0.25 + 0.75 * toward) * twinkle;
        gl_PointSize = uPixel * (0.035 + seed * 0.035) * 420.0 / d;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uDark;
      varying float vAlpha;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, r) * vAlpha * uDark * 0.55;
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 6;
  points.name = 'dust';
  return { points, pixel: material.uniforms.uPixel };
}

/**
 * LiDAR scan of a tree: its own vertices as points, revealed bottom-up by a bright scan line,
 * then left as a faint point cloud while the panel is open.
 */
export function createScan(shared: SharedUniforms) {
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      uTime: shared.uTime,
      uProgress: { value: 0 },
      uOpacity: { value: 0 },
      uBase: { value: 0 },
      uHeight: { value: 1 },
      uPixel: { value: 1 },
      uColor: { value: new Color('#b4ec62') },
    },
    vertexShader: /* glsl */ `
      uniform float uProgress;
      uniform float uBase;
      uniform float uHeight;
      uniform float uPixel;
      varying float vBand;
      varying float vShown;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float h = (position.y - uBase) / uHeight;
        float scan = uProgress * 1.15;
        vShown = step(h, scan);
        vBand = exp(-pow((h - scan) * 18.0, 2.0));
        gl_PointSize = uPixel * (1.8 + vBand * 2.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vBand;
      varying float vShown;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        if (r > 0.5) discard;
        float a = clamp(vShown * 0.55 + vBand, 0.0, 1.0) * uOpacity;
        gl_FragColor = vec4(uColor * (1.0 + vBand * 0.4), a);
        #include <colorspace_fragment>
      }`,
  });
  const points = new Points(new BufferGeometry(), material);
  points.frustumCulled = false;
  points.renderOrder = 7;
  points.visible = false;
  points.name = 'scan';

  return {
    points,
    uniforms: material.uniforms as Record<'uProgress' | 'uOpacity' | 'uBase' | 'uHeight' | 'uPixel', { value: number }>,
    /** Point positions for a tree: its geometry vertices, in world space. */
    setTree(geometries: BufferGeometry[], matrix: Matrix4, base: number, height: number) {
      const sources = geometries.map((g) => g.getAttribute('position') as BufferAttribute);
      const total = sources.reduce((n, a) => n + a.count, 0);
      const out = new Float32Array(total * 3);
      const v = new Vector3();
      let k = 0;
      for (const a of sources) {
        for (let i = 0; i < a.count; i++) {
          v.fromBufferAttribute(a, i).applyMatrix4(matrix);
          out[k++] = v.x;
          out[k++] = v.y;
          out[k++] = v.z;
        }
      }
      points.geometry.dispose();
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(out, 3));
      points.geometry = g;
      material.uniforms.uBase.value = base;
      material.uniforms.uHeight.value = height;
    },
  };
}
