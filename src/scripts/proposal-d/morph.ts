/**
 * Colour morph between the dark and light sections of a [data-morph] zone. The zone takes the tone
 * (data-tone) of the section crossing the middle of the screen, and the new tone sweeps across the
 * screen as a linear wipe: up from the bottom when scrolling down, down from the top when scrolling
 * up. The wipe's leading edge is a gradient that ends in the brand green: dark, dark green, lime, pale
 * lime, light (reversed going into light). The ink swaps as the edge passes the middle; the ground
 * switches when the wipe has covered the screen.
 */
const EDGE: Record<string, string[]> = {
  // From the new tone's side of the edge outwards, onto the old tone.
  dark: ['#0d0e0f', '#23331a', '#6f9b45', '#b8f27a', 'rgb(227 247 204 / 0.7)', 'rgb(242 243 241 / 0)'],
  light: ['#f2f3f1', 'rgb(227 247 204)', '#b8f27a', '#6f9b45', '#23331a', 'rgb(13 14 15 / 0)'],
};
const DURATION = 1200;
const EDGE_VH = 0.6; // height of the gradient edge, in screen heights

function gradient(to: string, up: boolean) {
  const c = EDGE[to];
  const solid = (1 / (1 + EDGE_VH)) * 100; // the solid part covers one screen
  const span = 100 - solid;
  const stops = c.slice(1).map((col, i) => `${col} ${(solid + (span * (i + 1)) / (c.length - 1)).toFixed(1)}%`);
  return `linear-gradient(${up ? 'to top' : 'to bottom'}, ${c[0]} 0%, ${c[0]} ${solid.toFixed(1)}%, ${stops.join(', ')})`;
}

export function mountMorph() {
  const zones = Array.from(document.querySelectorAll<HTMLElement>('[data-morph]'));
  if (!zones.length) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lastY = window.scrollY;
  let down = true;

  const parts = zones.map((zone) => {
    const sections = Array.from(zone.querySelectorAll<HTMLElement>(':scope > [data-tone]'));
    const first = sections[0]?.dataset.tone ?? 'dark';
    zone.dataset.theme = first;
    zone.dataset.ink = first;
    let wipe: HTMLElement | null = null;
    if (!reduce) {
      zone.dataset.mode = 'wipe';
      const layer = document.createElement('div');
      layer.className = 'pd-wipe';
      layer.setAttribute('aria-hidden', 'true');
      wipe = document.createElement('div');
      layer.append(wipe);
      zone.prepend(layer);
    }
    return { zone, sections, tone: first, shown: first, wipe, anim: null as Animation | null, pending: null as string | null, inkTimer: 0 };
  });

  function change(p: (typeof parts)[number], to: string) {
    if (reduce || !p.wipe) {
      p.zone.dataset.theme = to;
      p.zone.dataset.ink = to;
      p.shown = to;
      return;
    }
    // A change while a wipe is running waits for it (no jumping to the end), then plays in turn; if the
    // reader has come back to the tone already showing, nothing more plays.
    if (p.anim && p.anim.playState === 'running') {
      p.pending = to;
      return;
    }
    if (to === p.shown) return;
    const vh = window.innerHeight;
    const h = vh * (1 + EDGE_VH);
    const up = down; // scrolling down, the new tone rises from the bottom
    const w = p.wipe;
    w.style.height = `${h}px`;
    w.style.background = gradient(to, up);
    // Up: the edge leads at the top; start just below the screen, end with the solid part covering it.
    const from = up ? vh : -h;
    const end = up ? -(h - vh) : 0;
    p.anim = w.animate([{ transform: `translateY(${from}px)` }, { transform: `translateY(${end}px)` }], {
      duration: DURATION,
      easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
    });
    p.inkTimer = window.setTimeout(() => (p.zone.dataset.ink = to), DURATION * 0.5);
    p.anim.onfinish = () => {
      p.zone.dataset.theme = to;
      p.zone.dataset.ink = to;
      p.shown = to;
      w.style.background = 'none';
      const next = p.pending;
      p.pending = null;
      if (next && next !== p.shown) requestAnimationFrame(() => change(p, next));
    };
  }

  function update() {
    const y = window.scrollY;
    if (y !== lastY) down = y > lastY;
    lastY = y;
    const mid = window.innerHeight * 0.55;
    for (const p of parts) {
      let tone = p.sections[0]?.dataset.tone ?? 'dark';
      for (const s of p.sections) if (s.getBoundingClientRect().top <= mid) tone = s.dataset.tone!;
      if (tone === p.tone) continue;
      p.tone = tone;
      change(p, tone);
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
