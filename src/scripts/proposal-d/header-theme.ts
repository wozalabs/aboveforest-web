/**
 * The header takes the theme of whatever sheet is under it. Sheets overlap while they stack, so it asks
 * the browser which one is on top at the header's line rather than tracking scroll offsets.
 * It also gets out of the way: hidden while scrolling down, shown again on any scroll up (and always
 * near the top of the page). It is fixed, so hiding it never shifts the layout.
 */
export function mountHeaderTheme() {
  const header = document.querySelector<HTMLElement>('[data-header]');
  if (!header) return;
  let last = '';
  let lastY = window.scrollY;
  let hidden = false;
  const update = () => {
    const sy = window.scrollY;
    const dy = sy - lastY;
    if (Math.abs(dy) > 4) {
      const hide = dy > 0 && sy > 120;
      if (hide !== hidden) {
        hidden = hide;
        header.toggleAttribute('data-hidden', hide);
      }
      lastY = sy;
    }
    const y = header.offsetHeight / 2;
    const hit = document
      .elementsFromPoint(window.innerWidth / 2, y)
      .find((el) => !header.contains(el) && el.closest('[data-theme]'));
    const t = hit?.closest<HTMLElement>('[data-theme]')?.dataset.theme ?? 'dark';
    if (t !== last) {
      last = t;
      header.dataset.theme = t;
    }
  };
  let ticking = false;
  const schedule = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      update();
    });
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  // The hero changes theme on its own as the camera goes down into the forest.
  const hero = document.querySelector('[data-hero3d]');
  if (hero) new MutationObserver(schedule).observe(hero, { attributes: true, attributeFilter: ['data-theme'] });
  update();
}
