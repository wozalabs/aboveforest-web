/**
 * Two small scroll effects, one listener:
 * - [data-fill]: the paragraph's words light up one by one as it passes the middle of the screen.
 * - [data-drift="0.2"]: an element floats against the scroll, by that fraction of the distance.
 * Only opacity (via an attribute) and transform change. Static with reduced motion.
 */
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function mountScrollFx() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fills = Array.from(document.querySelectorAll<HTMLElement>('[data-fill]')).map((el) => {
    const words: HTMLElement[] = [];
    const walk = (node: Node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const frag = document.createDocumentFragment();
          for (const part of (child.textContent ?? '').split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s+$/.test(part)) frag.append(part);
            else {
              const s = document.createElement('span');
              s.className = 'fw';
              s.textContent = part;
              words.push(s);
              frag.append(s);
            }
          }
          child.replaceWith(frag);
        } else if (child instanceof HTMLElement) walk(child);
      }
    };
    walk(el);
    el.classList.add('pc-fill');
    return { el, words, lit: -1 };
  });
  const drifts = Array.from(document.querySelectorAll<HTMLElement>('[data-drift]')).map((el) => ({
    el,
    k: Number(el.dataset.drift) || 0.15,
  }));

  if (reduce) {
    fills.forEach((f) => f.words.forEach((w) => w.setAttribute('data-on', '')));
    return;
  }

  function update() {
    const vh = window.innerHeight;
    for (const f of fills) {
      const r = f.el.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 2) continue;
      // From the paragraph's top at 85% of the screen to its bottom at 45%.
      const k = clamp((vh * 0.85 - r.top) / (r.height + vh * 0.4), 0, 1);
      const n = Math.round(k * f.words.length);
      if (n === f.lit) continue;
      f.words.forEach((w, i) => w.toggleAttribute('data-on', i < n));
      f.lit = n;
    }
    for (const d of drifts) {
      const r = d.el.parentElement!.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 2) continue;
      const off = (r.top + r.height / 2 - vh / 2) * d.k;
      d.el.style.setProperty('--drift', `${off.toFixed(1)}px`);
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
