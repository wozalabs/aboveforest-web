/**
 * Shared controller for proposal D's dark 3D openings (HeroDark.astro): scroll progress through the
 * hero, the copy leaving, the captions, and the scene's lifecycle (only renders while the
 * stage is on screen and the tab is visible). The scene itself comes from hero-field.ts,
 * loaded as its own chunk after first paint.
 */
export type DarkScene = {
  /** 0 at the top of the hero, 1 when the next sheet has covered it. */
  setProgress(p: number): void;
  start(): void;
  stop(): void;
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function mountHeroDark(root: HTMLElement, load: () => Promise<(host: HTMLElement, reduce: boolean) => Promise<DarkScene>>) {
  const host = root.querySelector<HTMLElement>('[data-canvas-host]')!;
  const stage = root.querySelector<HTMLElement>('[data-stage]')!;
  const copy = root.querySelector<HTMLElement>('[data-copy]')!;
  const hint = root.querySelector<HTMLElement>('[data-hint]');
  const captions = Array.from(root.querySelectorAll<HTMLElement>('[data-caption]'));
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let scene: DarkScene | null = null;
  let visible = true;

  const progress = () => {
    const r = root.getBoundingClientRect();
    return clamp(-r.top / Math.max(1, r.height - window.innerHeight), 0, 1);
  };

  function read() {
    const p = progress();
    scene?.setProgress(p);
    const lift = -(root.offsetHeight - window.innerHeight) * p;
    const fade = smooth(0.02, 0.12, p);
    copy.style.transform = reduce ? '' : `translate3d(0, ${lift.toFixed(1)}px, 0)`;
    copy.style.opacity = String(1 - fade);
    // The dark pool behind the copy leaves with it, so the map underneath is not dimmed.
    root.style.setProperty('--copy', (1 - fade).toFixed(3));
    copy.inert = fade > 0.6;
    if (hint) hint.style.opacity = String(1 - smooth(0, 0.05, p));
    captions[0]?.toggleAttribute('data-on', p > 0.08 && p < 0.22);
    captions[1]?.toggleAttribute('data-on', p > 0.38 && p < 0.62);
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
  new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (!scene) return;
      if (visible && !document.hidden) scene.start();
      else scene.stop();
    },
    { rootMargin: '10% 0px' },
  ).observe(stage);
  document.addEventListener('visibilitychange', () => {
    if (!scene) return;
    if (document.hidden || !visible) scene.stop();
    else scene.start();
  });

  read();

  (async () => {
    try {
      if (!document.createElement('canvas').getContext('webgl2')) return;
      const create = await load();
      scene = await create(host, reduce);
      scene.setProgress(progress());
      root.dataset.ready = 'true';
      if (visible && !document.hidden) scene.start();
    } catch (error) {
      console.error('Hero scene failed to start', error);
    }
  })();
}
