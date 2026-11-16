/**
 * Scroll controller for the pinned forest section.
 * - Maps scroll to the shot index (holds on each featured tree) and hands it to the world.
 * - Swaps the overlays: hero copy, the way in, the tree panels, the trail nav, the way out.
 * - Moves the tree markers and the open panel with the 3D every frame.
 * - Loads three.js and the models right away (the hero is part of the scene) without blocking
 *   the first paint: the HTML hero is the largest contentful paint, the canvas fades in when ready.
 */
import { FEATURED_TREES } from '../../data/trees';
import { SEGMENTS, SHOT, TIMELINE_LENGTH, shotScroll } from '../../data/timeline';
import type { World } from './world';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Scroll position (in viewport heights) → shot index. */
function shotAt(p: number) {
  for (const s of SEGMENTS) {
    if (p < s.start + s.hold) return s.from;
    if (p < s.start + s.hold + s.travel) {
      const t = (p - s.start - s.hold) / s.travel;
      // Ease into and out of the stops; the air legs keep a constant pace.
      const walking = s.from >= SHOT.enter && s.from < SHOT.trailEnd;
      return s.from + (walking ? easeInOut(t) : t);
    }
  }
  return SHOT.riseTop;
}

export function mountForest(root: HTMLElement) {
  const stage = root.querySelector<HTMLElement>('[data-stage]')!;
  const host = root.querySelector<HTMLElement>('[data-canvas-host]')!;
  const hero = root.querySelector<HTMLElement>('[data-hero]')!;
  const markers = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-marker]'));
  const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-panel]'));
  const gotos = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-goto]'));
  const phases = Array.from(root.querySelectorAll<HTMLElement>('[data-phase]'));

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const narrow = window.matchMedia('(max-width: 47.99rem)');

  let world: World | null = null;
  let k = 0;
  let activeStop = -1;
  let visible = true;
  let theme: 'light' | 'dark' = 'light';

  /* ---------------- Scroll ---------------- */
  function progress() {
    const rect = root.getBoundingClientRect();
    return clamp(-rect.top / size.h, 0, TIMELINE_LENGTH);
  }

  function readScroll() {
    const p = progress();
    let next = shotAt(p);
    // Reduced motion: no flying. Cut between shots, with a short fade.
    if (reduceMotion.matches) {
      const snapped = Math.round(next);
      if (snapped !== Math.round(k)) {
        stage.toggleAttribute('data-cut', true);
        window.setTimeout(() => stage.removeAttribute('data-cut'), 220);
      }
      next = snapped;
    }
    k = next;
    world?.setTarget(next);
    // The hero copy scrolls away with the page, at the page's speed, while the camera starts its descent
    // behind it: the 2D layer moves like 2D and the 3D like 3D, so the hand-off reads as one gesture.
    const lift = p * size.h;
    const fade = clamp((p - 0.18) / 0.4, 0, 1);
    hero.style.transform = `translate3d(0, ${(-lift).toFixed(1)}px, 0)`;
    hero.style.opacity = String(1 - fade);
    hero.inert = fade > 0.6;
    updatePhases(world ? world.k : k);
  }

  /** Overlays keyed to where the camera is (the smoothed value when the world is running). */
  function updatePhases(at: number) {
    for (const el of phases) {
      const [a, b] = el.dataset.phase!.split(',').map(Number);
      const on = at >= a && at <= b;
      if (el.hasAttribute('data-on') !== on) {
        el.toggleAttribute('data-on', on);
        el.inert = !on;
      }
    }
    let stop = -1;
    FEATURED_TREES.forEach((_, i) => {
      if (Math.abs(at - (SHOT.firstStop + i)) < 0.32) stop = i;
    });
    if (stop !== activeStop) setStop(stop);

    // The interface goes dark when the scene does (camera low in the forest), with a little hysteresis.
    const dark = world
      ? world.dark > (theme === 'dark' ? 0.4 : 0.6)
      : at > SHOT.enter - 0.35 && at < SHOT.trailEnd + 0.9;
    const t = dark ? 'dark' : 'light';
    if (t !== theme) {
      theme = t;
      root.dataset.theme = t;
      document.documentElement.dataset.sceneTheme = t;
    }
  }

  function setStop(i: number) {
    activeStop = i;
    panels.forEach((p, j) => {
      const on = j === i;
      p.toggleAttribute('data-on', on);
      p.inert = !on;
    });
    markers.forEach((m, j) => m.toggleAttribute('data-active', j === i));
    gotos.forEach((b, j) => (j === i ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
    world?.setActive(i >= 0 ? i : null);
  }

  /* ---------------- Overlays that follow the 3D ---------------- */
  // Sizes are cached (ResizeObserver) so the per-frame pass only writes transforms: no forced layout.
  const size = { w: stage.clientWidth, h: stage.clientHeight };
  const panelSize = panels.map((p) => ({ w: p.offsetWidth, h: p.offsetHeight }));
  const ro = new ResizeObserver(() => {
    size.w = stage.clientWidth;
    size.h = stage.clientHeight;
    panels.forEach((p, i) => (panelSize[i] = { w: p.offsetWidth, h: p.offsetHeight }));
  });
  ro.observe(stage);
  panels.forEach((p) => ro.observe(p));

  function onFrame() {
    if (!world) return;
    updatePhases(world.k);
    const walking = world.k > SHOT.enter - 0.4 && world.k < SHOT.trailEnd + 0.4;
    const { w, h } = size;
    markers.forEach((m, i) => {
      const pr = world!.project(i);
      const show = walking && pr.visible && pr.distance < 70;
      m.toggleAttribute('data-shown', show);
      if (show) m.style.transform = `translate3d(${pr.x.toFixed(1)}px, ${pr.y.toFixed(1)}px, 0)`;
    });
    if (activeStop >= 0 && !narrow.matches) {
      const panel = panels[activeStop];
      const pr = world.project(activeStop);
      const { w: pw, h: ph } = panelSize[activeStop];
      const gap = 44;
      // Beside the tree, on the side with room (the shots put the tree off centre).
      const right = pr.x < w * 0.5;
      let x = right ? pr.x + gap : pr.x - gap - pw;
      x = clamp(x, 24, w - pw - 24);
      const y = clamp(pr.y - ph * 0.45, 88, h - ph - 96);
      panel.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }

  /* ---------------- Navigation ---------------- */
  function scrollToShot(shot: number) {
    const top = root.getBoundingClientRect().top + window.scrollY + shotScroll(shot) * stage.clientHeight;
    window.scrollTo({ top, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  }
  markers.forEach((m, i) => m.addEventListener('click', () => scrollToShot(SHOT.firstStop + i)));
  gotos.forEach((b, i) => b.addEventListener('click', () => scrollToShot(SHOT.firstStop + i)));
  root.querySelectorAll<HTMLElement>('[data-enter]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      scrollToShot(SHOT.firstStop);
    }),
  );

  /* ---------------- Pointer look-around ---------------- */
  function onPointer(e: PointerEvent) {
    if (!world || !finePointer.matches || reduceMotion.matches) return;
    world.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  }

  /* ---------------- Lifecycle ---------------- */
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      readScroll();
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  window.addEventListener('pointermove', onPointer, { passive: true });

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (!world) return;
      if (visible && !document.hidden) world.start();
      else world.stop();
    },
    { rootMargin: '10% 0px' },
  );
  io.observe(stage);
  document.addEventListener('visibilitychange', () => {
    if (!world) return;
    if (document.hidden || !visible) world.stop();
    else world.start();
  });

  readScroll();

  async function boot() {
    let gl = false;
    try {
      const c = document.createElement('canvas');
      gl = !!c.getContext('webgl2');
    } catch {
      gl = false;
    }
    if (!gl) {
      root.dataset.fallback = 'true';
      return;
    }
    try {
      const { createWorld } = await import('./world');
      world = await createWorld({
        host,
        base: import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`,
        reducedMotion: reduceMotion.matches,
        onFrame,
      });
      world.jump(k);
      if (activeStop >= 0) world.setActive(activeStop);
      root.dataset.ready = 'true';
      if (visible && !document.hidden) world.start();
      if (import.meta.env.DEV || new URLSearchParams(location.search).has("debug")) (window as Window & { __forest?: World }).__forest = world;
    } catch (error) {
      console.error('Forest scene failed to start', error);
      root.dataset.fallback = 'true';
    }
  }
  boot();
}
