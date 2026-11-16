/**
 * The forest world: renderer, scene, camera and the frame loop. The controller tells it where along
 * the journey the reader is (`setTarget`) and which tree is selected (`setActive`); the world eases
 * the camera there with a spring, re-lights the scene for the depth of the forest, and reports back
 * every frame so the HTML overlays move in step with the 3D.
 *
 * Two layers, digital and physical:
 * - the forest is a LiDAR-like point cloud (one instanced draw call per species, no textures);
 * - only the featured trees, the trail and the ground around them are physical: textured, lit,
 *   and with real shadows from a shadow map that follows the camera (small area, so it is sharp).
 *
 * Performance budget: ~20 draw calls, ~1M points, a few thousand textured triangles, one 2048²
 * shadow map. Pixel ratio adapts to the measured frame time; idle frames run at 30 fps; nothing
 * renders off screen or in a hidden tab.
 */
import {
  Color,
  DataTexture,
  DirectionalLight,
  Fog,
  HemisphereLight,
  LinearFilter,
  MathUtils,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import { FEATURED_TREES } from '../../data/trees';
import { SHOT } from '../../data/timeline';
import { createDust, createScan, createShafts, createSky } from './atmosphere';
import { createGround } from './ground';
import { plantForest, withSampler, type Layout, type Quality } from './layout';
import type { SharedUniforms } from './materials';
import { clamp, lerp, smoothstep } from './noise';
import { createRig } from './rig';
import { disposeTrees, loadTrees, plantFeatured } from './trees';
import { createPointForest } from './pointcloud';
import { heightAt } from './terrain';
import { createUnderstory } from './understory';

export type Projected = { x: number; y: number; visible: boolean; distance: number };

export type WorldOptions = {
  host: HTMLElement;
  base: string;
  reducedMotion: boolean;
  onFrame?: () => void;
};

const COLORS = {
  mist: new Color('#f2f3f5'),
  zenithLight: new Color('#dde7ee'),
  fogDark: new Color('#121814'),
  zenithDark: new Color('#1e2a22'),
  // Point cloud: dark dots on the mist, pale dots in the dark.
  leafLowLight: new Color('#33463a'),
  leafHighLight: new Color('#5f7d52'),
  barkLight: new Color('#3d3f3a'),
  leafLowDark: new Color('#476650'),
  leafHighDark: new Color('#b8d49c'),
  barkDark: new Color('#a9b3a8'),
  // Digital ground.
  groundLight: new Color('#e7e9e5'),
  dotLight: new Color('#b5bab1'),
  groundDark: new Color('#141b16'),
  dotDark: new Color('#415146'),
};

/** Mix two colours the way the eye reads them (in sRGB), not in linear light. */
function mixSRGB(out: Color, a: Color, b: Color, t: number) {
  const ca = a.clone().convertLinearToSRGB();
  const cb = b.clone().convertLinearToSRGB();
  return out.copy(ca.lerp(cb, t)).convertSRGBToLinear();
}

function detectQuality(): Quality & { tier: 'high' | 'low'; maxDpr: number; segments: number; dust: number; shafts: number; perTree: number; shadowMap: number } {
  const forced = new URLSearchParams(location.search).get('quality');
  const narrow = window.matchMedia('(max-width: 760px)').matches;
  const cores = navigator.hardwareConcurrency ?? 8;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const low = forced ? forced === 'low' : narrow || cores <= 4 || memory <= 4;
  return low
    ? { tier: 'low', maxDpr: 1.5, nearSpacing: 1.1, farSpacing: 1.6, width: 130, grass: 3000, ferns: 700, segments: 160, dust: 220, shafts: 8, perTree: 280, shadowMap: 1024 }
    : { tier: 'high', maxDpr: 1.75, nearSpacing: 1, farSpacing: 1.25, width: 180, grass: 7000, ferns: 1500, segments: 256, dust: 500, shafts: 14, perTree: 600, shadowMap: 2048 };
}

function plantInWorker(quality: Quality): Promise<Layout> {
  const { width, nearSpacing, farSpacing, grass, ferns } = quality;
  const q: Quality = { width, nearSpacing, farSpacing, grass, ferns };
  return new Promise((resolve) => {
    try {
      const worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<Omit<Layout, 'shade'> & { shade: Omit<Layout['shade'], 'sample'> }>) => {
        worker.terminate();
        resolve({ ...e.data, shade: withSampler(e.data.shade) });
      };
      worker.onerror = () => {
        worker.terminate();
        resolve(plantForest(q));
      };
      worker.postMessage(q);
    } catch {
      resolve(plantForest(q));
    }
  });
}

export async function createWorld(opts: WorldOptions) {
  const { host } = opts;
  const quality = detectQuality();

  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = SRGBColorSpace;
  // No tone mapping: the mist renders exactly the page colour, so the 2D sections join seamlessly.
  renderer.toneMapping = NoToneMapping;
  renderer.shadowMap.enabled = !new URLSearchParams(location.search).has('noshadow');
  renderer.shadowMap.type = PCFShadowMap;
  const forced = Number(new URLSearchParams(location.search).get('dpr'));
  if (forced > 0) quality.maxDpr = forced;
  let dpr = Math.min(window.devicePixelRatio || 1, quality.maxDpr);
  renderer.setPixelRatio(dpr);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.fog = new Fog(COLORS.mist.clone(), 70, 520);
  scene.background = (scene.fog as Fog).color;
  const camera = new PerspectiveCamera(50, 1, 0.1, 600);

  // Mid-morning sun, low enough for long shadows across the trail.
  const sunDir = new Vector3(-0.46, 0.46, -0.68).normalize();
  const shared: SharedUniforms = {
    uTime: { value: 0 },
    uDark: { value: 0 },
    // Filled in once the layout is back from the worker.
    uShade: { value: new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat) },
    uShadeRect: { value: new Vector4(0, 0, 1, 1) },
    uSunView: { value: new Vector3() },
    uSunDir: { value: sunDir },
    uGust: { value: opts.reducedMotion ? 0 : 1 },
  };

  // The forest is planted in a worker while the models download: both in parallel.
  const [layout, assets] = await Promise.all([plantInWorker(quality), loadTrees(opts.base, shared)]);
  const shadeTexture = new DataTexture(layout.shade.data, layout.shade.res, layout.shade.res, RGBAFormat);
  shadeTexture.magFilter = LinearFilter;
  shadeTexture.minFilter = LinearFilter;
  shadeTexture.needsUpdate = true;
  shared.uShade.value.dispose();
  shared.uShade.value = shadeTexture;
  shared.uShadeRect.value.set(...layout.shade.rect);

  const hemi = new HemisphereLight(new Color('#dfeaf5'), new Color('#4b5233'), 2);
  const sun = new DirectionalLight(new Color('#fff0d8'), 2.6);
  sun.position.copy(sunDir).multiplyScalar(100);
  // Real shadows for the physical layer. The shadow box follows the camera, so it stays small and sharp.
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  Object.assign(sun.shadow.camera, { near: 1, far: 220, left: -30, right: 30, top: 30, bottom: -30 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(hemi, sun, sun.target);

  const sky = createSky(shared);
  const ground = createGround(shared, quality.segments);
  const understory = createUnderstory(shared, layout);
  const shafts = createShafts(shared, quality.shafts, (x, z) => layout.shade.sample(x, z));
  const dust = createDust(shared, quality.dust);
  const scan = createScan(shared);
  scene.add(sky.mesh, ground.mesh, understory.group, shafts, dust.points, scan.points);

  const trees = plantFeatured(assets, layout.plants);
  const fog0 = scene.fog as Fog;
  const fogNear = { value: fog0.near };
  const fogFar = { value: fog0.far };
  const cloud = createPointForest(assets, layout.plants, shared, { perTree: quality.perTree, fog: { color: fog0.color, near: fogNear, far: fogFar } });
  scene.add(trees.group, cloud.group);

  /* ---------------- Camera state ---------------- */
  const rig = createRig();
  let target = 0;
  let k = 0;
  let kVel = 0;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0 };
  const pos = new Vector3();
  const look = new Vector3();
  const dir = new Vector3();
  let dark = 0;
  let width = 1;
  let height = 1;

  function resize() {
    width = Math.max(1, host.clientWidth);
    height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const portrait = camera.aspect < 0.9;
    camera.fov = portrait ? 64 : 50;
    rig.setAim(portrait ? 1 : 0.8);
    camera.updateProjectionMatrix();
    dust.pixel.value = renderer.getPixelRatio();
    scan.uniforms.uPixel.value = renderer.getPixelRatio();
    ground.pixel.value = Math.max(1, Math.round(renderer.getPixelRatio()));
    const focal = (height * renderer.getPixelRatio()) / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2));
    cloud.setFocal(focal, renderer.getPixelRatio());
    needsFrame = true;
  }

  /* ---------------- Selected tree ---------------- */
  let active: number | null = null;
  let activeSince = 0;
  let ringAlpha = 0;
  let scanOpacity = 0;
  function setActive(index: number | null) {
    if (index === active) return;
    if (active != null && index != null) ringAlpha = 0;
    active = index;
    activeSince = performance.now();
    if (index != null) {
      const f = trees.featured[index];
      const asset = assets[f.model];
      scan.setTree([asset.leaves, asset.bark], f.matrix, f.position.y, f.height);
      scan.uniforms.uProgress.value = opts.reducedMotion ? 1 : 0;
      ground.ring.set(f.position.x, f.position.z, FEATURED_TREES[index].crown / 2, ground.ring.w);
      scan.points.visible = true;
    }
    needsFrame = true;
  }

  const crown = new Vector3();
  const ndc = new Vector3();
  /** Screen position of a featured tree's crown (CSS pixels within the canvas). */
  function project(index: number, heightFraction = 0.55): Projected {
    const f = trees.featured[index];
    crown.copy(f.position).y += f.height * heightFraction;
    const distance = crown.distanceTo(camera.position);
    ndc.copy(crown).project(camera);
    const visible = ndc.z < 1 && ndc.z > -1 && Math.abs(ndc.x) < 1.2 && Math.abs(ndc.y) < 1.2;
    return { x: (ndc.x * 0.5 + 0.5) * width, y: (-ndc.y * 0.5 + 0.5) * height, visible, distance };
  }

  /* ---------------- Frame loop ---------------- */
  let running = false;
  let raf = 0;
  let last = performance.now();
  let lastDraw = 0;
  let needsFrame = true;
  // Adaptive resolution: frame times of busy frames.
  let slowFrames = 0;
  let fastFrames = 0;
  let busyFrames = 0;
  let busyTime = 0;

  function updateCamera(dt: number) {
    if (opts.reducedMotion) {
      k = target;
      kVel = 0;
    } else {
      // Critically damped spring: wheel steps become a glide, and a new target mid-flight keeps the velocity.
      const w = 5.2;
      kVel += (w * w * (target - k) - 2 * w * kVel) * dt;
      k += kVel * dt;
      if (Math.abs(target - k) < 1e-4 && Math.abs(kVel) < 1e-4) {
        k = target;
        kVel = 0;
      }
    }
    rig.at(clamp(k, 0, SHOT.riseTop), pos, look);

    // Look around a little with the pointer (decorative: springs, never on touch or reduced motion).
    const pw = 3.2;
    pointer.vx += (pw * pw * (pointer.tx - pointer.x) - 2 * pw * pointer.vx) * dt;
    pointer.vy += (pw * pw * (pointer.ty - pointer.y) - 2 * pw * pointer.vy) * dt;
    pointer.x += pointer.vx * dt;
    pointer.y += pointer.vy * dt;
    dir.copy(look).sub(pos);
    const len = dir.length();
    dir.normalize();
    dir.applyAxisAngle(camera.up, -pointer.x * 0.045);
    dir.y += -pointer.y * 0.03;
    camera.position.copy(pos);
    camera.lookAt(dir.multiplyScalar(len).add(pos));
  }

  function updateAtmosphere() {
    // Darkness follows the camera's height above the ground: the lower you fly, the deeper you are in
    // the forest. One continuous value, so the descent and the rise read as a single move.
    const above = camera.position.y - heightAt(camera.position.x, camera.position.z);
    const t = smoothstep(46, 7, above);
    dark = t * t * (3 - 2 * t);
    shared.uDark.value = dark;

    const fog = scene.fog as Fog;
    mixSRGB(fog.color, COLORS.mist, COLORS.fogDark, dark);
    // From the air: a morning mist that swallows the distance. Inside: a closer haze.
    fog.near = lerp(60, 8, dark);
    fog.far = lerp(470, 120, dark);
    fogNear.value = fog.near;
    fogFar.value = fog.far;
    sky.horizon.copy(fog.color);
    mixSRGB(sky.zenith, COLORS.zenithLight, COLORS.zenithDark, dark);
    mixSRGB(cloud.palette.leafLow, COLORS.leafLowLight, COLORS.leafLowDark, dark);
    mixSRGB(cloud.palette.leafHigh, COLORS.leafHighLight, COLORS.leafHighDark, dark);
    mixSRGB(cloud.palette.bark, COLORS.barkLight, COLORS.barkDark, dark);
    mixSRGB(ground.digiBase, COLORS.groundLight, COLORS.groundDark, dark);
    mixSRGB(ground.digiDot, COLORS.dotLight, COLORS.dotDark, dark);
    // The physical layer keeps daylight: lit islands of the real forest inside the survey.
    hemi.intensity = lerp(2.1, 1.2, dark);
    sun.intensity = lerp(2.5, 2.4, dark);
    updateShadow(above);

    const far = fog.far + 40;
    if (Math.abs(camera.far - far) > 4) {
      camera.far = far;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    shared.uSunView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
  }

  const focus = new Vector3();
  const fwd = new Vector3();
  let shadowHalf = 30;
  /** Keep the shadow box around what the camera is looking at, snapped to texels (no shimmering). */
  function updateShadow(above: number) {
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const reach = Math.min(70, 14 + above * 0.9);
    focus.copy(camera.position).addScaledVector(fwd, reach);
    const half = Math.round(Math.min(80, 28 + above * 0.7));
    if (half !== shadowHalf) {
      shadowHalf = half;
      Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
      sun.shadow.camera.updateProjectionMatrix();
    }
    const texel = (2 * half) / quality.shadowMap;
    focus.x = Math.round(focus.x / texel) * texel;
    focus.z = Math.round(focus.z / texel) * texel;
    focus.y = heightAt(focus.x, focus.z);
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(sunDir, 110);
    sun.target.updateMatrixWorld();
  }

  function updateSelection(now: number, dt: number) {
    const on = active != null;
    const fade = 1 - Math.exp(-dt * (on ? 5 : 9));
    ringAlpha += ((on ? 1 : 0) - ringAlpha) * fade;
    scanOpacity += ((on ? 1 : 0) - scanOpacity) * fade;
    ground.ring.w = ringAlpha;
    scan.uniforms.uOpacity.value = scanOpacity;
    if (on && !opts.reducedMotion) {
      const t = clamp((now - activeSince) / 1600, 0, 1);
      scan.uniforms.uProgress.value = 1 - Math.pow(1 - t, 3);
    }
    if (!on && scanOpacity < 0.01) scan.points.visible = false;
    return Math.abs((on ? 1 : 0) - ringAlpha) > 0.002 || (on && (now - activeSince) < 1700);
  }

  function adapt(frameMs: number, busy: boolean) {
    if (!busy) return;
    busyFrames++;
    busyTime += frameMs;
    if (busyFrames < 45) return;
    const avg = busyTime / busyFrames;
    busyFrames = 0;
    busyTime = 0;
    if (avg > 22) {
      slowFrames++;
      fastFrames = 0;
    } else if (avg < 14) {
      fastFrames++;
      slowFrames = 0;
    }
    const cap = Math.min(window.devicePixelRatio || 1, quality.maxDpr);
    if (slowFrames >= 2 && dpr > 0.75) {
      dpr = Math.max(0.75, dpr - 0.25);
      slowFrames = 0;
      renderer.setPixelRatio(dpr);
      resize();
    } else if (fastFrames >= 6 && dpr < cap) {
      dpr = Math.min(cap, dpr + 0.125);
      fastFrames = 0;
      renderer.setPixelRatio(dpr);
      resize();
    }
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dtMs = now - last;
    const dt = Math.min(0.05, dtMs / 1000);
    const moving = Math.abs(target - k) > 1e-3 || Math.abs(kVel) > 1e-3 || Math.abs(pointer.tx - pointer.x) > 1e-3 || Math.abs(pointer.vx) > 1e-3;
    // Idle (only wind and dust moving): 30 fps is plenty.
    if (!moving && !needsFrame && now - lastDraw < 1000 / 30 - 2) return;
    last = now;
    if (!opts.reducedMotion) shared.uTime.value += dt;
    updateCamera(dt);
    updateAtmosphere();
    const selecting = updateSelection(now, dt);
    renderer.render(scene, camera);
    adapt(now - lastDraw, moving || selecting);
    lastDraw = now;
    needsFrame = false;
    opts.onFrame?.();
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  // Compile every program before the first visible frame (in parallel where the driver allows).
  updateCamera(0);
  updateAtmosphere();
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);

  return {
    canvas: renderer.domElement,
    quality: quality.tier,
    stats: () => ({ trees: layout.plants.length, points: cloud.points, triangles: trees.triangles, dpr, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, drawnPoints: renderer.info.render.points }),
    setTarget(value: number) {
      target = value;
      needsFrame = true;
    },
    /** Snap the camera (no glide), e.g. on first load mid-page. */
    jump(value: number) {
      target = k = value;
      kVel = 0;
      needsFrame = true;
    },
    /** Debug and tests: put the camera at k and draw one frame now. */
    renderAt(value: number, time = 0) {
      target = k = value;
      kVel = 0;
      shared.uTime.value = time;
      updateCamera(0);
      updateAtmosphere();
      updateSelection(performance.now() + 5000, 1);
      renderer.render(scene, camera);
      opts.onFrame?.();
    },
    setPointer(x: number, y: number) {
      pointer.tx = MathUtils.clamp(x, -1, 1);
      pointer.ty = MathUtils.clamp(y, -1, 1);
    },
    get k() {
      return k;
    },
    get dark() {
      return dark;
    },
    setActive,
    project,
    start,
    stop,
    dispose() {
      stop();
      ro.disconnect();
      disposeTrees(assets);
      cloud.dispose();
      understory.dispose();
      ground.mesh.geometry.dispose();
      shadeTexture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

export type World = Awaited<ReturnType<typeof createWorld>>;
