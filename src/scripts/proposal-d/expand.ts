/**
 * Expanding photograph: the frame starts as the middle two columns of the grid and opens to the full
 * screen over the first half of the section's scroll; the photo settles from a slight zoom as it
 * opens. Then the photograph dims and the line and the app rise onto it. Writes only CSS variables
 * (clip-path, transform, opacity).
 */
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export function mountExpand() {
  const root = document.querySelector<HTMLElement>('[data-expand]');
  if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const frame = root.querySelector<HTMLElement>('[data-frame]')!;
  const sticky = root.querySelector<HTMLElement>('.sticky')!;
  const cols = root.querySelector<HTMLElement>('.pd-cols')!;

  let W = 0;
  let H = 0;
  let start = { t: 0, r: 0, b: 0, l: 0 };

  function layout() {
    W = root!.clientWidth;
    H = window.innerHeight;
    // The drawn columns know where the grid is.
    const edge = cols.offsetLeft;
    const col = cols.offsetWidth / 4;
    const narrow = W < 900;
    // Middle two columns on desktop, the full content width on phones.
    const x = narrow ? edge : edge + col;
    const w = narrow ? W - edge * 2 : col * 2;
    const h = Math.min(H * 0.6, w * 0.66);
    start = { t: (H - h) / 2, r: W - x - w, b: (H - h) / 2, l: x };
    update();
  }

  function update() {
    const r = root!.getBoundingClientRect();
    const p = clamp(-r.top / Math.max(1, r.height - H), 0, 1);
    const k = ease(clamp(p / 0.5, 0, 1));
    const s = frame.style;
    const o = sticky.style;
    s.setProperty('--t', `${(start.t * (1 - k)).toFixed(1)}px`);
    s.setProperty('--r', `${(start.r * (1 - k)).toFixed(1)}px`);
    s.setProperty('--b', `${(start.b * (1 - k)).toFixed(1)}px`);
    s.setProperty('--l', `${(start.l * (1 - k)).toFixed(1)}px`);
    s.setProperty('--rad', `${(6 * (1 - k)).toFixed(2)}px`);
    s.setProperty('--zoom', (1.18 - 0.18 * k).toFixed(4));
    // Once the frame is open, the product arrives.
    o.setProperty('--over', ease(clamp((p - 0.5) / 0.22, 0, 1)).toFixed(3));
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
  layout();
}
