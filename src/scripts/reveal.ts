/**
 * Text reveal (GSAP SplitText), shared by proposals C and D. Quiet: no masks, no scrambling.
 *
 * [data-reveal]          Headline. Words come into focus in a random order (fade, a little blur, a small
 *                        rise), each one green as it arrives, then easing back to its own colour.
 * [data-reveal="lines"]  Body copy. Lines fade up one after the other.
 *
 * Nothing is clipped (no overflow masks), so descenders stay whole. Screen readers get the real text
 * (SplitText sets aria-label and hides the pieces). Nothing runs with reduced motion: the inline head
 * script never adds `rv-js`, so the text is simply there.
 */
import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(SplitText);
// Reveals must finish on time even when frames are slow (a busy 3D scene): no lag smoothing.
gsap.ticker.lagSmoothing(0);

type Item = { el: HTMLElement; mode: string; split?: SplitText; played: boolean };

function shuffle<T>(list: T[]) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function prepare(item: Item) {
  const { el, mode } = item;
  if (mode === 'lines') {
    item.split = SplitText.create(el, { type: 'lines', linesClass: 'rv-line', aria: 'auto' });
    gsap.set(item.split.lines, { opacity: 0, y: 14 });
  } else {
    item.split = SplitText.create(el, { type: 'words', wordsClass: 'rv-word', aria: 'auto' });
    gsap.set(item.split.words, { opacity: 0, y: '0.12em', filter: 'blur(6px)' });
  }
  el.style.visibility = 'visible';
}

function play(item: Item) {
  if (item.played || !item.split) return;
  item.played = true;
  const { mode, split } = item;

  if (mode === 'lines') {
    gsap.to(split.lines, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.07, delay: 0.1, clearProps: 'transform' });
    return;
  }

  const words = shuffle(split.words as HTMLElement[]);
  const spread = Math.min(0.8, 0.15 + words.length * 0.045);
  words.forEach((w, i) => {
    const at = (i / words.length) * spread;
    gsap.to(w, {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      duration: 0.8,
      delay: at,
      ease: 'power3.out',
      clearProps: 'filter,transform',
      onStart: () => w.classList.add('rv-hot'),
    });
    // Green while it arrives, then the colour transition takes it home.
    gsap.delayedCall(at + 0.4, () => w.classList.remove('rv-hot'));
  });
}

export async function mountReveal() {
  const root = document.documentElement;
  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
  if (!els.length || !root.classList.contains('rv-js')) return;
  // Lines are measured, so split only once the fonts are in.
  await document.fonts.ready;
  const items: Item[] = els.map((el) => ({ el, mode: el.dataset.reveal || 'heading', played: false }));
  const byEl = new Map(items.map((it) => [it.el, it]));
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const it = byEl.get(e.target as HTMLElement);
        if (it) play(it);
      }
    },
    { rootMargin: '0px 0px -10% 0px' },
  );
  for (const it of items) {
    prepare(it);
    io.observe(it.el);
  }
}
