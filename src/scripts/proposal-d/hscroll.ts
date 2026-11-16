/**
 * Horizontal story track: the section is as tall as the track is wide; while it passes, its inner
 * screen sticks and the track slides sideways with the scroll. The screen's column lines slide with
 * it (the page's still lines are masked out over the section), and the distance is whole columns, so
 * the lines meet the page's grid again at both ends. Without the script, or with reduced motion, the
 * track is a normal horizontally scrollable row.
 */
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function mountHScroll() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-hscroll]'));
  const parts = roots.map((root) => ({
    root,
    track: root.querySelector<HTMLElement>('[data-track]')!,
    lines: root.querySelector<HTMLElement>('[data-lines]'),
    still: root.parentElement?.querySelector<HTMLElement>(':scope > .pd-cols') ?? null,
    distance: 0,
  }));
  if (!parts.length) return;

  function layout() {
    for (const p of parts) {
      p.root.setAttribute('data-live', '');
      const cs = getComputedStyle(p.track);
      const padL = parseFloat(cs.paddingLeft);
      const padR = parseFloat(cs.paddingRight);
      const inner = p.track.clientWidth - padL - padR;
      const items = p.track.children.length;
      const last = p.track.lastElementChild as HTMLElement | null;
      const cardW = last ? last.getBoundingClientRect().width : 0;
      p.distance = Math.max(0, Math.round(cardW * items - inner));
      p.root.style.height = `${window.innerHeight + p.distance}px`;
      if (p.lines) {
        const cols = window.innerWidth <= 900 ? 2 : 4;
        p.lines.style.width = `${inner + p.distance}px`;
        p.lines.style.setProperty('--col', `${inner / cols}px`);
      }
      // Hide the page's still lines where the sliding ones are.
      if (p.still) {
        const top = p.root.offsetTop;
        const bottom = top + p.root.offsetHeight;
        const m = `linear-gradient(to bottom, #000 ${top}px, transparent ${top}px, transparent ${bottom}px, #000 ${bottom}px)`;
        p.still.style.maskImage = m;
        p.still.style.setProperty('-webkit-mask-image', m);
      }
    }
    update();
  }

  function update() {
    for (const p of parts) {
      const r = p.root.getBoundingClientRect();
      const k = clamp(-r.top / Math.max(1, p.distance), 0, 1);
      const t = `translate3d(${(-k * p.distance).toFixed(1)}px, 0, 0)`;
      p.track.style.transform = t;
      if (p.lines) p.lines.style.transform = t;
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
  const ro = new ResizeObserver(layout);
  ro.observe(parts[0].track);
  // Sections above may change height (fonts, images), which moves where the mask goes.
  if (parts[0].root.parentElement) ro.observe(parts[0].root.parentElement);
  layout();
}
