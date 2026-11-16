/**
 * The scroll timeline of the forest section, in viewport heights. Shared by the page (it sets the
 * section's height, so nothing jumps when the script arrives) and by the scene controller.
 *
 * Shots, in order:
 *   0 hero (aerial, light mist)   1 descent   2 over the meadow   3 on the trail, at the forest edge
 *   4–8 the featured trees        9 end of the trail   10 rising through the canopy   11 above it again
 */
import { FEATURED_TREES } from './trees';

export const SHOT = {
  hero: 0,
  descent: 1,
  meadow: 2,
  enter: 3,
  firstStop: 4,
  trailEnd: 4 + FEATURED_TREES.length,
  riseMid: 5 + FEATURED_TREES.length,
  riseTop: 6 + FEATURED_TREES.length,
} as const;

export const SHOT_COUNT = SHOT.riseTop + 1;

/** Viewport heights spent holding on each shot. */
const HOLD: number[] = Array.from({ length: SHOT_COUNT }, (_, i) => {
  if (i === SHOT.hero) return 0.15;
  if (i >= SHOT.firstStop && i < SHOT.trailEnd) return 0.55;
  if (i === SHOT.riseTop) return 0.45;
  return 0;
});

/** Viewport heights spent travelling from each shot to the next. */
const TRAVEL: number[] = Array.from({ length: SHOT_COUNT - 1 }, (_, i) => {
  if (i < SHOT.enter) return 0.7; // hero → descent → meadow → trail
  if (i === SHOT.enter) return 1.05; // forest edge → first tree
  if (i < SHOT.trailEnd - 1) return 1.0; // tree → tree
  if (i === SHOT.trailEnd - 1) return 0.9; // last tree → end of trail
  return 0.75; // rising out
});

export type Segment = { from: number; start: number; hold: number; travel: number };

export const SEGMENTS: Segment[] = (() => {
  let at = 0;
  return HOLD.map((hold, i) => {
    const s = { from: i, start: at, hold, travel: TRAVEL[i] ?? 0 };
    at += hold + s.travel;
    return s;
  });
})();

/** Scrollable length of the section, in viewport heights. */
export const TIMELINE_LENGTH = SEGMENTS.reduce((sum, s) => sum + s.hold + s.travel, 0);

/** Scroll position (viewport heights) at which the camera arrives at a shot. */
export const shotScroll = (shot: number) => SEGMENTS[shot].start + SEGMENTS[shot].hold * 0.5;
