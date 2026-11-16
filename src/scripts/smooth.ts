/**
 * Smooth scrolling (Lenis), with a switch to turn it on or off (remembered per browser).
 * Smooth scroll also caps how far one wheel step can move the page, so the scroll-driven moments
 * (the hero, the expanding photo, the colour wipes, the story track) always have time to play.
 * Off by default with reduced motion.
 */
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

const KEY = 'af-smooth-scroll';
const MAX_STEP = 90; // px per wheel event

export function mountSmooth() {
  const button = document.querySelector<HTMLButtonElement>('[data-smooth-toggle]');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    stored = null;
  }
  let on = stored == null ? !reduce : stored === 'on';
  let lenis: Lenis | null = null;

  function apply() {
    if (on && !lenis) {
      lenis = new Lenis({
        autoRaf: true,
        lerp: 0.09,
        wheelMultiplier: 0.9,
        anchors: true,
        respectReducedMotion: false, // the switch decides; it starts off with reduced motion
        virtualScroll: (data) => {
          data.deltaY = Math.max(-MAX_STEP, Math.min(MAX_STEP, data.deltaY));
          return true;
        },
      });
    } else if (!on && lenis) {
      lenis.destroy();
      lenis = null;
    }
    button?.setAttribute('aria-checked', String(on));
  }

  button?.addEventListener('click', () => {
    on = !on;
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    apply();
  });
  apply();
}
