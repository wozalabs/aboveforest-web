# AboveForest website

Marketing site for AboveForest. This first cut sets up the 3D part: a hero seen from above the
forest, a scroll-driven walk along a trail that stops at five trees and shows their data, and the
way back out into the 2D page. The tree models are the ones from `basodata_app`; the interface takes
its tokens from the same app (neutrals, Basodata lime, relief buttons with grain).

The scene mixes two layers. The forest is digital: a LiDAR-like point cloud sampled from each
species' model, on a survey ground with a dot grid and dithered canopy shade (as in predicterra-web).
Only the five featured trees, the trail and the ground around them are physical: textured, lit by
the sun, and with real shadows.

## Stack

| Piece | Why |
| --- | --- |
| [Astro](https://astro.build), static output | The 2D sections ship as plain HTML and CSS, with no framework runtime. Multi-page routing, i18n and SEO for the pages that come next. Same stack as `predicterra-web`. |
| [three.js](https://threejs.org), vanilla | The forest scene. No React Three Fiber: a scroll-driven scene with a fixed camera rig does not need a reconciler, and it keeps the main thread free. Loaded as its own chunk (~175 KB gzip). |
| A Web Worker | Plants the forest (≈2,000–3,000 trees, understory, canopy shade map) off the main thread while the models download. |
| `@fontsource-variable/manrope` | Manrope, self-hosted, the Latin subset preloaded. |
| `@gltf-transform/cli` (dev) | `npm run models` copies the basodata_app models and compresses them (meshopt + WebP): 1.9 MB → 0.47 MB for the 11 species. |

No CSS framework, no animation library: CSS transitions for the interface, a critically damped
spring for the camera.

## Performance

- The point-cloud forest is one instanced draw call per species (~1.9M points on desktop, ~0.5M on phones), no textures, no lighting.
- Only five trees are real meshes, so a single 2048² shadow map is enough. It follows the camera and is snapped to texels, so it stays sharp and does not shimmer.
- Canopy shade is a 256² texture splatted once from the crowns. Sun flecks, light shafts and dust are cheap shader effects.
- Grass and ferns only grow in the physical band and shrink away with distance.
- ~20–40 draw calls per frame.
- Pixel ratio adapts to the measured frame time (0.75 to 1.75). Idle frames run at 30 fps; nothing renders off screen or in a hidden tab.
- Two quality tiers (`low` on small screens, ≤4 cores or ≤4 GB memory). Force one with `?quality=low|high`.
- The HTML hero is the largest contentful paint; the canvas fades in when ready.
- The overlays that follow the 3D only write transforms each frame (sizes are cached), so there is no forced layout.

## Accessibility

- Reduced motion: the camera cuts between shots instead of flying; no wind, no drifting light.
- The tree panels are real HTML, readable without WebGL, by screen readers and search engines. Without WebGL they show centred, one per stop.
- Markers and the trail nav are buttons; they scroll to the matching stop.

## Scripts

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # static site in dist/
npm run preview   # serve dist/
npm run check     # type check + brand rules (no uppercase, no monospace, no positive tracking, Manrope only)
npm run models    # re-copy and compress the tree models from ../basodata_app/public/models/v3
```

`?debug` exposes the scene as `window.__forest` (`stats()`, `renderAt(k)`). `?noshadow` turns the shadow map off, to compare.

## Structure

```
src/
  pages/index.astro
  layouts/BaseLayout.astro
  components/          Header, footer, logo
  sections/home/
    ForestJourney.astro   Hero + pinned 3D stage + tree panels + trail nav
    Territory.astro       First 2D section after the forest (placeholder copy)
  data/
    trees.ts          The five featured trees and their data (sample values)
    timeline.ts       Scroll timeline in viewport heights (shared by the page and the scene)
  scripts/forest/
    controller.ts     Scroll → shot, overlays, markers, panels, lazy start
    world.ts          Renderer, lights, fog, frame loop, adaptive resolution
    rig.ts            Camera path: crane down to the trail, walk, crane up turning back over it
    layout.ts         Where everything grows (stands, spacing, understory, shade map)
    layout.worker.ts  Runs layout.ts off the main thread
    trees.ts          Model loading, the five physical trees
    pointcloud.ts     The digital forest: point templates per species, instanced
    stops.ts          Featured tree spots and the physical band (shared with the worker)
    ground.ts         Ground shader: physical (stands, trail, shadows, flecks) ↔ digital (dots, dither)
    understory.ts     Grass, ferns, rocks, logs
    atmosphere.ts     Sky, light shafts, dust, LiDAR scan points
    materials.ts      Wind, shade and leaf translucency patches
    terrain.ts        Height field and trail curve
    species.ts        Species, tints (from basodata_app) and stand mixes
```

## Changing the walk

- Trees and their data: `src/data/trees.ts` (`z` along the trail, `side`, `offset`).
- Pace: `src/data/timeline.ts` (holds and travel per shot, in viewport heights).
- Stands: `WORLD` in `terrain.ts` and `STANDS` in `species.ts`.
