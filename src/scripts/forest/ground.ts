/**
 * The forest floor, in two layers that blend into each other:
 * - physical, along the trail and around the featured trees: moss, litter, needles and meadow by
 *   stand, the walked trail, canopy shade, sun flecks and real shadows;
 * - digital, everywhere else: a flat survey ground with a world-space dot grid, and the canopy
 *   shade as an ordered (Bayer) dither, as in the Predicterra scene.
 * The selected tree's crown footprint is drawn here too, so it hugs the slope.
 */
import { Color, Mesh, MeshStandardMaterial, PlaneGeometry, Vector2, Vector3, Vector4 } from 'three';
import { FEATURED_TREES } from '../../data/trees';
import { PHYS, treeSpot } from './stops';
import { heightAt, hollowCentre, trailX_GLSL, WORLD } from './terrain';
import { NOISE_GLSL, type SharedUniforms } from './materials';

export function createGround(shared: SharedUniforms, segments: number) {
  const geometry = new PlaneGeometry(WORLD.size, WORLD.size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(WORLD.cx, 0, WORLD.cz);
  const pos = geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geometry.computeVertexNormals();

  const ho = hollowCentre();
  const uniforms = {
    uMeadow: { value: new Color('#738c40') },
    uDry: { value: new Color('#9a9a5c') },
    uMoss: { value: new Color('#3f5a24') },
    uLitter: { value: new Color('#5e4a30') },
    uNeedles: { value: new Color('#5b4128') },
    uDamp: { value: new Color('#2c4022') },
    uTrail: { value: new Color('#8a7356') },
    uFleck: { value: new Color('#ffe2a8') },
    uAccent: { value: new Color('#aee45f') },
    uZones: { value: new Vector4(WORLD.edge, WORLD.broadleafEnd, WORLD.clearingEnd, WORLD.glade) },
    uHollow: { value: new Vector4(ho.x, ho.z, WORLD.hollow.r, 0) },
    /** x, z, radius, strength of the highlighted crown footprint. */
    uRing: { value: new Vector4(0, 0, 1, 0) },
    uFeat: { value: FEATURED_TREES.map((_, i) => new Vector3(treeSpot(i).x, treeSpot(i).z, 0)) },
    uPhys: { value: new Vector4(PHYS.band[0], PHYS.band[1], PHYS.pool[0], PHYS.pool[1]) },
    uTrailRange: { value: new Vector2(WORLD.trailStart, WORLD.exit.z) },
    uDigiBase: { value: new Color('#e9ebe8') },
    uDigiDot: { value: new Color('#b9beb6') },
    uPixel: { value: 1 },
  };

  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldP;
        uniform float uTime;
        uniform float uDark;
        uniform sampler2D uShade;
        uniform vec4 uShadeRect;
        uniform vec3 uMeadow, uDry, uMoss, uLitter, uNeedles, uDamp, uTrail, uFleck, uAccent;
        uniform vec4 uZones, uHollow, uRing, uPhys;
        uniform vec3 uFeat[${FEATURED_TREES.length}];
        uniform vec2 uTrailRange;
        uniform vec3 uDigiBase, uDigiDot;
        uniform float uPixel;
        ${NOISE_GLSL}
        float bayer4(vec2 p) {
          vec2 q = mod(floor(p), 4.0);
          float i = q.x + q.y * 4.0;
          if (i < 0.5) return 0.0;   if (i < 1.5) return 8.0;   if (i < 2.5) return 2.0;   if (i < 3.5) return 10.0;
          if (i < 4.5) return 12.0;  if (i < 5.5) return 4.0;   if (i < 6.5) return 14.0;  if (i < 7.5) return 6.0;
          if (i < 8.5) return 3.0;   if (i < 9.5) return 11.0;  if (i < 10.5) return 1.0;  if (i < 11.5) return 9.0;
          if (i < 12.5) return 15.0; if (i < 13.5) return 7.0;  if (i < 14.5) return 13.0; return 5.0;
        }
        vec3 digital = vec3(0.0);
        float phys = 1.0;
        ${trailX_GLSL}
        float fleckMask = 0.0;
        float ringMask = 0.0;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 xz = vWorldP.xz;
          float n1 = fbm2(xz * 0.09);
          float n2 = vnoise(xz * 0.8);
          float wob = (fbm2(xz * 0.03 + 7.0) - 0.5) * 28.0;
          float z = xz.y + wob;

          vec3 broad = mix(uLitter, uMoss, smoothstep(0.35, 0.7, n1));
          vec3 col = broad;
          vec3 meadow = mix(uMeadow, uDry, smoothstep(0.45, 0.8, fbm2(xz * 0.05 + 3.0)) * 0.6);
          meadow = mix(meadow, uMoss, n1 * 0.4);
          float glade = 1.0 - smoothstep(uZones.w - 14.0, uZones.w + 6.0, abs(xz.x - trailX(xz.y)) + wob * 1.4);
          col = mix(col, meadow, smoothstep(uZones.x - 14.0, uZones.x + 6.0, z) * glade);
          col = mix(col, mix(uMoss, uLitter, n1 * 0.5), smoothstep(uZones.y + 8.0, uZones.y - 8.0, z) * smoothstep(uZones.z - 8.0, uZones.z + 8.0, z) * 0.7);
          col = mix(col, mix(uNeedles, uMoss, n1 * 0.45), smoothstep(uZones.z + 8.0, uZones.z - 8.0, z));
          float dh = length(xz - uHollow.xy) / uHollow.z;
          col = mix(col, uDamp, (1.0 - smoothstep(0.4, 1.2, dh)) * 0.85);
          col *= 0.82 + 0.36 * n2;

          // Trail, with ragged edges.
          float d = abs(xz.x - trailX(xz.y));
          float edge = 0.95 + (vnoise(xz * 1.7) - 0.5) * 0.7;
          float onTrail = 1.0 - smoothstep(edge - 0.25, edge + 0.35, d);
          col = mix(col, uTrail * (0.85 + 0.3 * n2), onTrail);

          vec2 sh = texture2D(uShade, (xz - uShadeRect.xy) / uShadeRect.zw).rg;
          // The canopy is digital now: only a light shade, so the real shadows of the physical trees read.
          col *= 1.0 - sh.r * 0.18 - sh.g * 0.12;

          // Physical where you walk and around the featured trees; digital beyond.
          float along = smoothstep(uTrailRange.y - 10.0, uTrailRange.y, xz.y) * smoothstep(uTrailRange.x + 14.0, uTrailRange.x, xz.y);
          float edgeNoise = (vnoise(xz * 0.35) - 0.5) * 3.0;
          phys = (1.0 - smoothstep(uPhys.x, uPhys.y, d + edgeNoise)) * along;
          for (int i = 0; i < ${FEATURED_TREES.length}; i++) {
            phys = max(phys, 1.0 - smoothstep(uPhys.z, uPhys.w, length(xz - uFeat[i].xy) + edgeNoise));
          }
          diffuseColor.rgb = col * phys;

          // Digital ground: survey dots on a flat tone, canopy shade dithered.
          vec2 cellUV = fract(xz / 1.6) - 0.5;
          float dd = length(cellUV) * 1.6;
          float fw = fwidth(dd);
          float dotMask = 1.0 - smoothstep(0.07 - fw, 0.07 + fw, dd);
          float dither = (bayer4(gl_FragCoord.xy / uPixel) + 0.5) / 16.0;
          float shaded = step(dither, sh.r * 0.55);
          digital = mix(uDigiBase, uDigiDot, max(dotMask, shaded * 0.55)) * (1.0 - phys);

          // Sun flecks: drifting light through gaps, only noticeable under the canopy.
          float f = vnoise(xz * 0.32 + vec2(uTime * 0.035, -uTime * 0.02)) * vnoise(xz * 0.9 - vec2(uTime * 0.02, uTime * 0.03));
          fleckMask = smoothstep(0.32, 0.52, f) * smoothstep(0.15, 0.6, sh.r) * uDark;

          float r = length(xz - uRing.xy);
          float line = 1.0 - smoothstep(0.03, 0.11, abs(r - uRing.z));
          float fill = (1.0 - smoothstep(uRing.z - 0.8, uRing.z, r)) * 0.08;
          ringMask = (line * 0.55 + fill) * uRing.w;
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uFleck * fleckMask * diffuseColor.rgb * 2.2 + uAccent * ringMask * 0.9 + digital;`,
      );
  };
  material.customProgramCacheKey = () => 'af-ground';

  const mesh = new Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  mesh.name = 'ground';
  mesh.receiveShadow = true;
  return { mesh, ring: uniforms.uRing.value, digiBase: uniforms.uDigiBase.value, digiDot: uniforms.uDigiDot.value, pixel: uniforms.uPixel };
}
