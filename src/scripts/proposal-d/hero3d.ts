/**
 * The 3D opening of proposal D: proposal A's forest scene, used lightly. No trail and no tree stops;
 * scroll only cranes the camera from above the mist down to the edge of the forest (shots 0 → 3),
 * and the first dark sheet slides over the stage while it descends.
 *
 * three.js and the models load in their own chunk after first paint; the HTML copy is the largest
 * contentful paint, and the canvas fades in when ready. Nothing renders off screen or in a hidden tab.
 */
import { SHOT } from '../../data/timeline';
import type { World } from '../forest/world';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function mountHero3D(root: HTMLElement) {
  const host = root.querySelector<HTMLElement>('[data-canvas-host]')!;
  const copy = root.querySelector<HTMLElement>('[data-copy]')!;
  const caption = root.querySelector<HTMLElement>('[data-caption]');
  const hint = root.querySelector<HTMLElement>('[data-hint]');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');

  let world: World | null = null;
  let visible = true;
  let theme = 'light';
  const END = SHOT.enter; // the edge of the forest

  function progress() {
    const r = root.getBoundingClientRect();
    return clamp(-r.top / Math.max(1, r.height - window.innerHeight), 0, 1);
  }

  function setTheme(t: string) {
    if (t === theme) return;
    theme = t;
    root.dataset.theme = t;
  }

  function read() {
    const p = progress();
    const k = p * END;
    world?.setTarget(k);
    // The copy leaves at the page's speed while the camera starts down behind it.
    const lift = -r0() * p;
    const fade = smooth(0.03, 0.2, p);
    copy.style.transform = reduce.matches ? '' : `translate3d(0, ${lift.toFixed(1)}px, 0)`;
    copy.style.opacity = String(1 - fade);
    copy.inert = fade > 0.6;
    if (hint) hint.style.opacity = String(1 - smooth(0, 0.06, p));
    caption?.toggleAttribute('data-on', p > 0.22 && p < 0.52);
    if (!world) setTheme(root.dataset.fallback ? 'dark' : p > 0.7 ? 'dark' : 'light');
  }
  const r0 = () => root.offsetHeight - window.innerHeight;

  function onFrame() {
    if (world) setTheme(world.dark > (theme === 'dark' ? 0.4 : 0.6) ? 'dark' : 'light');
  }

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      read();
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  window.addEventListener(
    'pointermove',
    (e) => {
      if (!world || !fine.matches || reduce.matches) return;
      world.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    },
    { passive: true },
  );

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (!world) return;
      if (visible && !document.hidden) world.start();
      else world.stop();
    },
    { rootMargin: '10% 0px' },
  );
  io.observe(root.querySelector('[data-stage]')!);
  document.addEventListener('visibilitychange', () => {
    if (!world) return;
    if (document.hidden || !visible) world.stop();
    else world.start();
  });

  read();

  (async () => {
    let gl = false;
    try {
      gl = !!document.createElement('canvas').getContext('webgl2');
    } catch {
      gl = false;
    }
    if (!gl) {
      root.dataset.fallback = 'true';
      read();
      return;
    }
    try {
      const { createWorld } = await import('../forest/world');
      const base = import.meta.env.BASE_URL;
      world = await createWorld({
        host,
        base: base.endsWith('/') ? base : `${base}/`,
        reducedMotion: reduce.matches,
        onFrame,
      });
      world.jump(progress() * END);
      root.dataset.ready = 'true';
      if (visible && !document.hidden) world.start();
      if (new URLSearchParams(location.search).has('debug')) (window as Window & { __forest?: World }).__forest = world;
    } catch (error) {
      console.error('Forest scene failed to start', error);
      root.dataset.fallback = 'true';
      read();
    }
  })();
}
