/**
 * Tilted entrance: a [data-tilt] card rises from below tilted back and scaled down, and settles flat
 * and full size as its section's top reaches the top of the screen. Writes one CSS variable (--in,
 * 0 to 1) that the card's transform uses; with reduced motion the card is simply flat.
 */
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const ease = (t: number) => 1 - (1 - t) * (1 - t);

export function mountTilt() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-tilt]'));
  if (!cards.length) return;
  const parts = cards.map((card) => ({ card, section: card.closest<HTMLElement>('section') ?? card, last: -1 }));

  function update() {
    const vh = window.innerHeight;
    for (const p of parts) {
      // 0 when the section's top enters at the bottom of the screen, 1 when it reaches the top.
      const top = p.section.getBoundingClientRect().top;
      const k = ease(clamp(1 - top / vh, 0, 1));
      if (Math.abs(k - p.last) < 0.001) continue;
      p.last = k;
      p.card.style.setProperty('--in', k.toFixed(4));
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
  window.addEventListener('resize', update);
  update();
}
