/**
 * Shader patches shared by the scene. Everything stays on three's built-in materials (lighting, fog
 * and alpha-to-coverage come for free) with small additions through onBeforeCompile:
 * - wind: trees sway from the base up, leaves flutter, grass and ferns bend; one sine field, no textures;
 * - canopy shade: the shade map darkens trunks, lower crowns and the ground under dense crowns;
 * - leaf translucency against the sun, as in the basodata_app tree viewer (TreeViewer.tsx).
 */
import type { DataTexture, Material, MeshStandardMaterial, Vector3, Vector4, WebGLProgramParametersWithUniforms } from 'three';

export type SharedUniforms = {
  uTime: { value: number };
  uDark: { value: number };
  uShade: { value: DataTexture };
  uShadeRect: { value: Vector4 };
  /** Direction to the sun, in view space (updated every frame). */
  uSunView: { value: Vector3 };
  /** Direction to the sun, in world space. */
  uSunDir: { value: Vector3 };
  /** Global wind strength (0 with reduced motion). */
  uGust: { value: number };
};

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm2(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
`;

const WORLD_POS_VERTEX = /* glsl */ `
  {
    vec4 wp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      wp = instanceMatrix * wp;
    #endif
    vWorldP = (modelMatrix * wp).xyz;
  }
`;

function bind(shader: WebGLProgramParametersWithUniforms, shared: SharedUniforms, own: Record<string, { value: unknown }>) {
  Object.assign(shader.uniforms, shared, own);
}

/**
 * Trees and shrubs. `native` is the model height in its own units (wind scales with it);
 * `wind` is the species' flexibility; `leaf` adds flutter and translucency.
 */
export function patchTree(material: MeshStandardMaterial, shared: SharedUniforms, opts: { native: number; wind: number; leaf: boolean }) {
  const own = {
    uNative: { value: opts.native },
    uWind: { value: opts.wind },
    uTranslucency: { value: opts.leaf ? 0.65 : 0 },
  };
  material.onBeforeCompile = (shader) => {
    bind(shader, shared, own);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uGust;
        uniform float uNative;
        uniform float uWind;
        varying vec3 vWorldP;
        varying float vHN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 iPos = vec3(0.0);
          #ifdef USE_INSTANCING
            iPos = instanceMatrix[3].xyz;
          #endif
          float hN = clamp(position.y / uNative, 0.0, 1.2);
          float ph = iPos.x * 0.043 + iPos.z * 0.061;
          float bend = hN * hN * uWind * uGust * uNative;
          transformed.x += (sin(uTime * 0.62 + ph) * 0.65 + sin(uTime * 1.31 + ph * 1.7) * 0.35) * bend * 0.011;
          transformed.z += cos(uTime * 0.47 + ph * 1.3) * bend * 0.007;
          ${opts.leaf ? 'transformed += normal * sin(uTime * 2.6 + dot(position, vec3(1.7, 2.3, 1.1))) * 0.03 * uWind * uGust * hN * uNative * 0.06;' : ''}
          vHN = hN;
        }`,
      )
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_POS_VERTEX}`);

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uShade;
        uniform vec4 uShadeRect;
        uniform vec3 uSunView;
        uniform float uTranslucency;
        uniform float uDark;
        varying vec3 vWorldP;
        varying float vHN;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 sh = texture2D(uShade, (vWorldP.xz - uShadeRect.xy) / uShadeRect.zw).rg;
          float low = 1.0 - smoothstep(0.08, 0.85, vHN);
          diffuseColor.rgb *= 1.0 - (sh.r * 0.2 + sh.g * 0.1) * low;
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          float toLight = max(dot(normalize(-vViewPosition), uSunView), 0.0);
          outgoingLight += diffuseColor.rgb * pow(toLight, 3.0) * uTranslucency * (0.12 + 1.0 * uDark);
        }
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => (opts.leaf ? 'af-leaf' : 'af-bark');
}

/** Grass and ferns: bend with the wind from the base (local y), darker in deep shade. */
export function patchUnderstory(
  material: Material,
  shared: SharedUniforms,
  opts: { height: number; stiffness: number; key: string; fade?: [number, number] },
) {
  const own = { uBladeH: { value: opts.height }, uStiff: { value: opts.stiffness } };
  material.onBeforeCompile = (shader) => {
    bind(shader, shared, own);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uGust;
        uniform float uBladeH;
        uniform float uStiff;
        varying vec3 vWorldP;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 iPos = vec3(0.0);
          #ifdef USE_INSTANCING
            iPos = instanceMatrix[3].xyz;
          #endif
          float h = clamp(position.y / uBladeH, 0.0, 1.0);
          float ph = iPos.x * 0.31 + iPos.z * 0.27;
          float w = (sin(uTime * 1.3 + ph) * 0.7 + sin(uTime * 2.9 + ph * 2.1) * 0.3) * uGust;
          transformed.x += w * h * h * uBladeH * 0.22 / uStiff;
          transformed.z += cos(uTime * 1.1 + ph * 1.4) * uGust * h * h * uBladeH * 0.12 / uStiff;
          ${
            opts.fade
              ? `// Small plants shrink away with distance: from afar they are only specks, and it saves fill.
          float camD = distance((modelMatrix * vec4(iPos, 1.0)).xyz, cameraPosition);
          transformed *= 1.0 - smoothstep(${opts.fade[0].toFixed(1)}, ${opts.fade[1].toFixed(1)}, camD);`
              : ''
          }
        }`,
      )
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_POS_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uShade;
        uniform vec4 uShadeRect;
        varying vec3 vWorldP;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 sh = texture2D(uShade, (vWorldP.xz - uShadeRect.xy) / uShadeRect.zw).rg;
          diffuseColor.rgb *= 1.0 - sh.r * 0.2 - sh.g * 0.1;
        }`,
      );
  };
  material.customProgramCacheKey = () => `af-${opts.key}`;
}
