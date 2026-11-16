/**
 * Horizontal story track: the section is as tall as the track is wide; while it passes, its inner
 * screen sticks and the track slides sideways with the scroll. Without the script, or with reduced
 * motion, the track is a normal horizontally scrollable row.
 */
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function mountHScroll() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-hscroll]'));
  const parts = roots.map((root) => ({ root, track: root.querySelector<HTMLElement>('[data-track]')!, distance: 0 }));
  if (!parts.length) return;

  function layout() {
    for (const p of parts) {
      p.root.setAttribute('data-live', '');
      p.distance = Math.max(0, p.track.scrollWidth - p.track.clientWidth);
      p.root.style.height = `${window.innerHeight + p.distance}px`;
    }
    update();
  }

  function update() {
    for (const p of parts) {
      const r = p.root.getBoundingClientRect();
      const k = clamp(-r.top / Math.max(1, p.distance), 0, 1);
      p.track.style.transform = `translate3d(${(-k * p.distance).toFixed(1)}px, 0, 0)`;
    }
  }

  let ticking = false;
  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        update();
      });
    },
    { passive: true },
  );
  window.addEventListener('resize', layout);
  new ResizeObserver(layout).observe(parts[0].track);
  layout();
}
