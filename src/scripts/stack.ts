/**
 * Stacked scrolling. A section marked [data-pin] sticks (to the top, or by its bottom edge when it is
 * taller than the screen) while the next section slides over it; as it gets covered it sinks back a
 * little and darkens. Only transform and opacity change per frame.
 */
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** The sheet that covers a pin: the next rendered element, or the one after its parent (the footer after main). */
function coverOf(pin: HTMLElement) {
  const skip = (el: Element | null) => {
    while (el && /^(SCRIPT|STYLE|TEMPLATE)$/.test(el.tagName)) el = el.nextElementSibling;
    return el;
  };
  return (skip(pin.nextElementSibling) ?? skip(pin.parentElement?.nextElementSibling ?? null)) as HTMLElement | null;
}

export function mountStack() {
  const pins = Array.from(document.querySelectorAll<HTMLElement>('[data-pin]'));
  if (!pins.length) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const parts = pins.map((pin) => ({
    pin,
    next: coverOf(pin),
    inner: pin.querySelector<HTMLElement>(':scope > .pin-inner'),
    shade: pin.querySelector<HTMLElement>(':scope > .pin-shade'),
    last: -1,
  }));

  function layout() {
    const vh = window.innerHeight;
    for (const p of parts) {
      const h = p.pin.offsetHeight;
      const top = Math.min(0, vh - h);
      p.pin.style.top = `${top}px`;
      // Sink towards the middle of what is on screen.
      if (p.inner) p.inner.style.transformOrigin = `50% ${-top + vh / 2}px`;
      p.last = -1;
    }
    update();
  }

  function update() {
    const vh = window.innerHeight;
    for (const p of parts) {
      if (!p.next) continue;
      const top = p.next.getBoundingClientRect().top;
      const k = clamp((vh - top) / vh, 0, 1);
      if (Math.abs(k - p.last) < 0.002) continue;
      p.last = k;
      if (p.shade) p.shade.style.opacity = (k * 0.6).toFixed(3);
      if (p.inner && !reduce) p.inner.style.transform = k > 0 ? `scale(${(1 - 0.06 * k).toFixed(4)})` : '';
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
  const ro = new ResizeObserver(layout);
  pins.forEach((p) => ro.observe(p));
  window.addEventListener('resize', layout);
  layout();
}
