/**
 * Living point field (proposal D's hero). Tens of thousands of points, one draw call.
 * - On load each point rises straight up into its place in a forest seen from above (domed and
 *   conical crowns, a little ground), each with its own delay and pace.
 * - As you scroll the forest resolves into a map of stands seen in isometric view: an irregular
 *   tessellation (see src/data/stands.ts) drawn in points, its boundaries bright and a quiet dot grid
 *   inside. Every area touches its neighbours. Hover (or tap) an area: it lights up, hatched like the
 *   app's selection, and a card shows the trees in it.
 * Both point layouts are attributes; the motion runs on the GPU.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  MathUtils,
  Mesh,
  PerspectiveCamera,
  Plane,
  Points,
  Raycaster,
  Scene,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { DarkScene } from './hero-dark';
import { FIELD, STANDS, standAt } from '../../data/stands';

const { W, D } = FIELD;
const STEP = 1.6; // dot grid spacing inside the stands
const NX = Math.floor(W / STEP) + 1;
const NZ = Math.floor(D / STEP) + 1;
const EDGE_STEP = 0.32; // spacing of the points along the boundaries

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

/** Every boundary once (neighbours share theirs), as points along it. */
function boundaryPoints() {
  const seen = new Set<string>();
  const out: number[] = [];
  const key = (x: number, z: number) => `${x.toFixed(2)},${z.toFixed(2)}`;
  for (const s of STANDS) {
    for (let k = 0; k < s.polygon.length - 1; k++) {
      const [x0, z0] = s.polygon[k];
      const [x1, z1] = s.polygon[k + 1];
      const a = key(x0, z0);
      const b = key(x1, z1);
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.round(len / EDGE_STEP));
      for (let i = 0; i < n; i++) {
        const t = i / n;
        out.push(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      }
    }
  }
  return out;
}

function build(count: number) {
  const r = rng(7);
  const B = new Float32Array(count * 3);
  const rise = new Float32Array(count * 3); // distance below, delay, duration
  const C = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const tone = new Float32Array(count);
  const edge = new Float32Array(count);
  const keep = new Float32Array(count);
  const cell = new Float32Array(count).fill(-1);

  // Crowns, spaced so they barely touch.
  const crowns: { x: number; z: number; R: number; H: number; cone: boolean; area: number }[] = [];
  for (let tries = 0; tries < 9000 && crowns.length < 420; tries++) {
    const R = 1.3 + r() * 2.4;
    const x = (r() - 0.5) * W;
    const z = (r() - 0.5) * D;
    if (crowns.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < ((c.R + R) * 0.82) ** 2)) continue;
    const cone = r() < 0.4;
    crowns.push({ x, z, R, H: 5 + r() * 6 + R, cone, area: R * R });
  }
  const total = crowns.reduce((s, c) => s + c.area, 0);
  const cdf: number[] = [];
  crowns.reduce((s, c) => (cdf.push((s + c.area) / total), s + c.area), 0);
  const pick = () => {
    const u = r();
    let lo = 0;
    let hi = cdf.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cdf[m] < u) lo = m + 1;
      else hi = m;
    }
    return crowns[lo];
  };

  // C: the boundaries first, then one point per grid node, then the rest (which fade out).
  const bounds = boundaryPoints();
  const nEdge = Math.min(bounds.length / 2, count);
  const nodes = NX * NZ;

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    seed[i] = r();
    // The entrance: every point starts straight below where it ends, and rises at its own pace.
    rise[o] = 6 + r() * 12;
    rise[o + 1] = Math.pow(r(), 1.6) * 0.45;
    rise[o + 2] = 0.55 + r() * 0.65;

    // B: the forest.
    if (r() < 0.12) {
      B[o] = (r() - 0.5) * W;
      B[o + 1] = r() * 0.3;
      B[o + 2] = (r() - 0.5) * D;
      tone[i] = 0;
    } else {
      const c = pick();
      const a = r() * Math.PI * 2;
      const u = r();
      let rr: number;
      let y: number;
      if (c.cone) {
        rr = c.R * 0.8 * Math.pow(u, 0.75);
        y = c.H + (1 - rr / (c.R * 0.8)) * c.R * 1.9;
      } else {
        rr = c.R * Math.sqrt(u);
        y = c.H + Math.sqrt(Math.max(0, c.R * c.R - rr * rr)) * 0.85;
      }
      B[o] = c.x + Math.cos(a) * rr;
      B[o + 1] = y + (r() - 0.5) * 0.35;
      B[o + 2] = c.z + Math.sin(a) * rr;
      tone[i] = Math.min(1, (y - c.H) / (c.R * 1.6)) * 0.8 + 0.2;
    }

    // C: the map of stands.
    if (i < nEdge) {
      C[o] = bounds[i * 2];
      C[o + 2] = bounds[i * 2 + 1];
      edge[i] = 1;
      keep[i] = 1;
    } else {
      const j = i - nEdge;
      const n = j < nodes ? j : Math.floor(r() * nodes);
      const gx = n % NX;
      const gz = Math.floor(n / NX);
      C[o] = -W / 2 + gx * STEP;
      C[o + 2] = -D / 2 + gz * STEP;
      keep[i] = j < nodes ? 1 : 0;
      if (j < nodes) cell[i] = standAt(C[o], C[o + 2]);
    }
    C[o + 1] = 0;
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(B, 3));
  g.setAttribute('aRise', new Float32BufferAttribute(rise, 3));
  g.setAttribute('aC', new Float32BufferAttribute(C, 3));
  g.setAttribute('aSeed', new Float32BufferAttribute(seed, 1));
  g.setAttribute('aTone', new Float32BufferAttribute(tone, 1));
  g.setAttribute('aEdge', new Float32BufferAttribute(edge, 1));
  g.setAttribute('aKeep', new Float32BufferAttribute(keep, 1));
  g.setAttribute('aCell', new Float32BufferAttribute(cell, 1));
  return g;
}

export async function createField(host: HTMLElement, reduce: boolean): Promise<DarkScene> {
  const small = window.innerWidth < 900 || (navigator.hardwareConcurrency ?? 8) <= 4;
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x0d0e0f, 1);
  const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(dpr);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(42, 1, 0.5, 400);

  const geometry = build(small ? 34000 : 80000);
  const uniforms = {
    uTime: { value: 0 },
    uIntro: { value: reduce ? 99 : 0 },
    uScroll: { value: 0 },
    uPixel: { value: dpr },
    uSize: { value: small ? 1.25 : 1 },
    uHover: { value: -1 },
  };
  const material = new ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aRise;
      attribute vec3 aC;
      attribute float aSeed;
      attribute float aTone;
      attribute float aEdge;
      attribute float aKeep;
      attribute float aCell;
      uniform float uTime;
      uniform float uIntro;
      uniform float uScroll;
      uniform float uPixel;
      uniform float uSize;
      uniform float uHover;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float s = aSeed;
        // Entrance: straight up from below its place, each point with its own delay and duration.
        float t1 = clamp((uIntro - aRise.y) / aRise.z, 0.0, 1.0);
        float e1 = 1.0 - pow(1.0 - t1, 3.0);
        vec3 b = position;
        b.x += sin(uTime * 0.7 + position.z * 0.35 + s * 6.0) * 0.06 * aTone;
        vec3 p = b - vec3(0.0, aRise.x * (1.0 - e1), 0.0);
        float t2 = clamp(uScroll * 1.3 - (1.0 - s) * 0.3, 0.0, 1.0);
        t2 = t2 * t2 * (3.0 - 2.0 * t2);
        p = mix(p, aC, t2);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float hovered = (uHover >= 0.0 && abs(aCell - uHover) < 0.5) ? 1.0 : 0.0;
        float size = mix(0.8, 1.6, aTone) * (1.0 - t2) + mix(mix(1.6, 2.4, hovered), 1.5, aEdge) * t2;
        gl_PointSize = uSize * uPixel * size * (120.0 / -mv.z);

        vec3 dim = vec3(0.62, 0.68, 0.62);
        vec3 lime = vec3(0.72, 0.95, 0.48);
        vec3 forest = mix(dim * 0.7, lime * 1.15, pow(aTone, 1.4));
        vec3 map = mix(mix(dim * 0.42, lime * 0.9, hovered), mix(dim * 1.05, lime, 0.35), aEdge);
        vColor = mix(forest, map, t2);
        // The forest stays quiet under the headline. Into the map only one point per node travels; the
        // rest fade out early, so the change reads as the forest resolving into the map.
        vAlpha = smoothstep(0.0, 0.3, t1) * mix(1.0, aKeep, smoothstep(0.0, 0.3, t2)) * mix(0.42, 1.0, t2);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c);
        if (r > 0.5) discard;
        float a = smoothstep(0.5, 0.1, r) * vAlpha;
        gl_FragColor = vec4(vColor * a, 1.0);
      }`,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);

  // The selection: the hovered stand, hatched like the app's selected stand, with a lime outline.
  const hatch = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uAlpha: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vP = w.xz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAlpha;
      varying vec2 vP;
      void main() {
        float stripe = smoothstep(0.42, 0.5, abs(fract((vP.x + vP.y) * 1.1) - 0.5));
        vec3 lime = vec3(0.72, 0.95, 0.48);
        gl_FragColor = vec4(lime, (0.06 + 0.32 * stripe) * uAlpha);
      }`,
  });
  const outlineMat = new LineBasicMaterial({ color: 0xb8f27a, transparent: true, opacity: 0 });
  const selections = STANDS.map((s) => {
    const shape = new Shape(s.polygon.map(([x, z]) => new Vector2(x, -z)));
    const fill = new Mesh(new ShapeGeometry(shape), hatch);
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 0.03;
    fill.visible = false;
    const line = new Line(
      new BufferGeometry().setFromPoints(s.polygon.map(([x, z]) => new Vector3(x, 0.05, z))),
      outlineMat,
    );
    line.visible = false;
    scene.add(fill, line);
    return { fill, line };
  });

  // Camera: oblique over the forest, then swinging round to an isometric view of the map (a long,
  // narrow lens from 45 degrees, so it reads nearly orthographic).
  const posA = new Vector3(0, 30, 44);
  const lookA = new Vector3(0, 4, -4);
  const posB = new Vector3(60, 54, 60);
  const lookB = new Vector3(0, 0, 0);
  let fovA = 42;
  let fovB = 32;
  const pos = new Vector3();
  const look = new Vector3();

  let target = 0;
  let k = 0;
  let width = 1;
  let height = 1;
  function resize() {
    width = Math.max(1, host.clientWidth);
    height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Portrait screens see less width: a wider lens so the field still fills them.
    const portrait = camera.aspect < 0.9;
    fovA = portrait ? 62 : 42;
    fovB = portrait ? 58 : 32;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  // ── Hover: which stand is under the pointer, and its card. ──
  const root = host.closest<HTMLElement>('[data-hero-dark]');
  const stage = host.closest<HTMLElement>('[data-stage]') ?? host;
  const card = root?.querySelector<HTMLElement>('[data-zone-card]') ?? null;
  const fields = card ? Object.fromEntries(Array.from(card.querySelectorAll<HTMLElement>('[data-f]')).map((el) => [el.dataset.f!, el])) : {};
  const ray = new Raycaster();
  const ground = new Plane(new Vector3(0, 1, 0), 0);
  const ndc = new Vector2();
  const hit = new Vector3();
  let hovered = -1;
  let mapOn = false;
  let alpha = 0;
  let pointer: { x: number; y: number } | null = null;
  const fmt = (n: number, d = 0) => n.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });

  function setHover(i: number) {
    if (i === hovered) return;
    if (hovered >= 0) {
      selections[hovered].fill.visible = false;
      selections[hovered].line.visible = false;
    }
    hovered = i;
    uniforms.uHover.value = i;
    alpha = 0;
    if (i >= 0) {
      selections[i].fill.visible = true;
      selections[i].line.visible = true;
      const s = STANDS[i];
      if (fields.id) fields.id.textContent = s.id;
      if (fields.species) fields.species.textContent = s.species;
      if (fields.latin) fields.latin.textContent = s.latin;
      if (fields.type) fields.type.textContent = `${s.type}, ${s.share}%`;
      if (fields.area) fields.area.textContent = `${fmt(s.area, 2)} ha`;
      if (fields.trees) fields.trees.textContent = fmt(s.trees);
      if (fields.height) fields.height.textContent = `${fmt(s.height, 1)} m`;
      if (fields.carbon) fields.carbon.textContent = `${fmt(s.carbon)} t CO₂e`;
    }
    card?.toggleAttribute('data-on', i >= 0);
  }

  function pick(clientX: number, clientY: number) {
    const r = stage.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(ground, hit)) return -1;
    return standAt(hit.x, hit.z);
  }

  function placeCard() {
    if (!card || !pointer || hovered < 0) return;
    const r = stage.getBoundingClientRect();
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    let x = pointer.x - r.left + 18;
    let y = pointer.y - r.top + 18;
    if (x + cw > r.width - 12) x = pointer.x - r.left - cw - 18;
    if (y + ch > r.height - 12) y = pointer.y - r.top - ch - 18;
    card.style.transform = `translate3d(${Math.max(12, x).toFixed(0)}px, ${Math.max(12, y).toFixed(0)}px, 0)`;
  }

  stage.addEventListener('pointermove', (e) => {
    if (!mapOn) return;
    pointer = { x: e.clientX, y: e.clientY };
    setHover(pick(e.clientX, e.clientY));
    placeCard();
  });
  stage.addEventListener('pointerdown', (e) => {
    if (!mapOn) return;
    pointer = { x: e.clientX, y: e.clientY };
    setHover(pick(e.clientX, e.clientY));
    placeCard();
  });
  stage.addEventListener('pointerleave', () => setHover(-1));

  let raf = 0;
  let running = false;
  let last = 0;
  let t0 = 0;
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    if (!reduce) {
      uniforms.uTime.value += dt;
      if (!t0) t0 = now;
      uniforms.uIntro.value = (now - t0) / 1000;
    }
    k += (target - k) * (reduce ? 1 : 1 - Math.exp(-dt * 6));
    const e = k * k * (3 - 2 * k);
    uniforms.uScroll.value = e;
    pos.lerpVectors(posA, posB, e);
    look.lerpVectors(lookA, lookB, e);
    camera.fov = fovA + (fovB - fovA) * e;
    camera.updateProjectionMatrix();
    // A slow drift around the field while it is a forest.
    pos.x += Math.sin(uniforms.uTime.value * 0.06) * 6 * (1 - e);
    camera.position.copy(pos);
    camera.lookAt(look);

    const on = e > 0.95;
    if (on !== mapOn) {
      mapOn = on;
      root?.toggleAttribute('data-map', on);
      if (!on) setHover(-1);
    }
    // The selection fades in.
    alpha = Math.min(1, alpha + dt * 6);
    hatch.uniforms.uAlpha.value = alpha;
    outlineMat.opacity = alpha;

    renderer.render(scene, camera);
  }

  renderer.render(scene, camera);
  return {
    setProgress(p) {
      target = MathUtils.smoothstep(p, 0.04, 0.34);
      if (reduce) k = target;
    },
    start() {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}
