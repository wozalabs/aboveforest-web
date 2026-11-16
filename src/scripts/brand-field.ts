/**
 * Brand fields: slowly moving colour fields with grain (two motifs: a soft "field" of blurred blobs
 * and a motion-blurred "horizon"). Every field on the page is drawn by ONE shared WebGL2 context, at
 * low resolution (the picture is blurry by nature), and copied into the field's own small canvas,
 * which the browser upscales smoothly. The grain is a static CSS layer on top, so it stays crisp.
 *
 * Cost: a few hundred pixels wide per field, ~24 fps, only fields on screen, nothing in a hidden tab.
 * With reduced motion each field is drawn once.
 */

type Item = {
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  mode: number;
  palette: number[];
  seed: number;
  horizon: number;
  speed: number;
  w: number;
  h: number;
  visible: boolean;
  drawn: boolean;
};

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const pal = (...c: string[]) => c.flatMap(hex);

/** Six colours each: field = base + five blobs; horizon = sky top, sky low, cloud, haze, deep, bright. */
const PALETTES: Record<string, number[]> = {
  day: pal('#d6e7dc', '#86c8e8', '#2e8a4b', '#a2cc56', '#5d8f3a', '#c8aa4f'),
  moss: pal('#cfdcc4', '#7aa64e', '#2a6b3e', '#b9cb5c', '#8cc0e0', '#d2b35c'),
  deep: pal('#0c1611', '#1c4e35', '#2b6e44', '#5c9a3e', '#15403e', '#2d5e7b'),
  horizon: pal('#5ea5dc', '#dcebf2', '#b4d3ea', '#8db5bc', '#2b6a4f', '#40a05d'),
  dusk: pal('#4f86b8', '#d9e4e6', '#a7c4d8', '#7ea7a6', '#24563f', '#3b8a52'),
};

const VERT = /* glsl */ `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uSeed;
uniform float uHorizon;
uniform int uMode;
uniform vec3 uC[6];
out vec4 o;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.02; a *= 0.5; }
  return s;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec3 col;
  if (uMode == 0) {
    // Field: five soft blobs drifting on slow Lissajous paths, through a warped domain.
    vec2 p = vec2(uv.x * asp, uv.y);
    float t = uTime * 0.045;
    vec2 q = vec2(fbm(p * 1.3 + vec2(t, uSeed)), fbm(p * 1.3 + vec2(-t * 0.8, uSeed + 3.1)));
    vec2 w = p + (q - 0.5) * 0.85;
    vec3 acc = uC[0];
    float tot = 1.0;
    for (int i = 1; i < 6; i++) {
      float fi = float(i);
      vec2 c = vec2(
        0.5 * asp + 0.48 * asp * sin(t * (0.55 + 0.13 * fi) + fi * 1.7 + uSeed),
        0.5 + 0.46 * cos(t * (0.45 + 0.11 * fi) + fi * 2.3 + uSeed * 1.3)
      );
      float d = length(w - c);
      float g = exp(-d * d / (0.06 + 0.035 * fi));
      acc += uC[i] * g * 1.8;
      tot += g * 1.8;
    }
    col = acc / tot;
  } else {
    // Horizon: everything stretched sideways, like a long exposure from a moving train.
    float h = uHorizon;
    float y = uv.y;
    float x = uv.x * 0.55 + uTime * 0.012;
    float s1 = fbm(vec2(x * 1.6, y * 42.0 + uSeed));
    float s2 = fbm(vec2(x * 0.8 - uTime * 0.006, y * 13.0 + uSeed * 2.0));
    if (y > h) {
      float k = (y - h) / (1.0 - h);
      col = mix(uC[1], uC[0], smoothstep(0.0, 1.0, k + (s2 - 0.5) * 0.25));
      // Bright cloud streaks crowd the horizon; darker blue streaks drift higher up.
      float band = exp(-pow((k - 0.18) / 0.26, 2.0));
      col = mix(col, vec3(0.97, 0.98, 0.99), smoothstep(0.36, 0.68, s1) * band);
      col = mix(col, uC[0] * 0.86, smoothstep(0.55, 0.8, s2) * 0.45 * smoothstep(0.2, 0.8, k));
      col = mix(col, uC[2], smoothstep(0.5, 0.8, s1) * 0.3 * k);
    } else {
      float k = (h - y) / h;
      col = mix(uC[3], uC[4], smoothstep(0.05, 0.85, k + (s2 - 0.5) * 0.35));
      col = mix(col, uC[5], smoothstep(0.55, 1.0, k) * 0.7);
      col = mix(col, uC[3] * 1.12, smoothstep(0.5, 0.78, s1) * (1.0 - k) * 0.7);
      col = mix(col, uC[4] * 0.9, smoothstep(0.55, 0.8, s2) * k * 0.4);
    }
  }
  // A whisper of dither against banding on the upscale.
  col += (hash(gl_FragCoord.xy + uTime) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`;

export function mountBrandFields() {
  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-brand-field]'));
  if (!els.length) return;

  const glCanvas = document.createElement('canvas');
  const gl = glCanvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: true });
  if (!gl) return; // The CSS gradient underneath stays as the picture.

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = {
    res: gl.getUniformLocation(prog, 'uRes'),
    time: gl.getUniformLocation(prog, 'uTime'),
    seed: gl.getUniformLocation(prog, 'uSeed'),
    horizon: gl.getUniformLocation(prog, 'uHorizon'),
    mode: gl.getUniformLocation(prog, 'uMode'),
    c: gl.getUniformLocation(prog, 'uC'),
  };

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const items: Item[] = els.map((el) => {
    const canvas = document.createElement('canvas');
    canvas.className = 'bf-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    el.prepend(canvas);
    const mode = el.dataset.mode === 'horizon' ? 1 : 0;
    return {
      el,
      canvas,
      ctx: canvas.getContext('2d')!,
      mode,
      palette: PALETTES[el.dataset.palette ?? (mode ? 'horizon' : 'day')] ?? PALETTES.day,
      seed: Number(el.dataset.seed ?? 1),
      horizon: Number(el.dataset.horizon ?? 0.5),
      speed: Number(el.dataset.speed ?? 1),
      w: 0,
      h: 0,
      visible: false,
      drawn: false,
    };
  });

  function size(it: Item) {
    const r = it.el.getBoundingClientRect();
    // Blurry pictures need few pixels: the browser's smooth upscale does the rest.
    const k = it.mode ? 0.42 : 0.2;
    const maxW = it.mode ? 640 : 360;
    it.w = Math.max(48, Math.min(maxW, Math.round(r.width * k)));
    it.h = Math.max(32, Math.round((r.height / Math.max(1, r.width)) * it.w));
    it.canvas.width = it.w;
    it.canvas.height = it.h;
    it.drawn = false;
  }

  function draw(it: Item, time: number) {
    if (glCanvas.width < it.w || glCanvas.height < it.h) {
      glCanvas.width = Math.max(glCanvas.width, it.w);
      glCanvas.height = Math.max(glCanvas.height, it.h);
    }
    gl!.viewport(0, 0, it.w, it.h);
    gl!.uniform2f(u.res, it.w, it.h);
    gl!.uniform1f(u.time, time * it.speed + it.seed * 37);
    gl!.uniform1f(u.seed, it.seed);
    gl!.uniform1f(u.horizon, it.horizon);
    gl!.uniform1i(u.mode, it.mode);
    gl!.uniform3fv(u.c, it.palette);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    // WebGL draws from the bottom-left; copy that corner.
    it.ctx.drawImage(glCanvas, 0, glCanvas.height - it.h, it.w, it.h, 0, 0, it.w, it.h);
    if (!it.drawn) {
      it.drawn = true;
      it.el.setAttribute('data-live', '');
    }
  }

  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const it = items.find((i) => i.el === e.target);
      if (it) size(it);
    }
    if (reduce) items.forEach((it) => it.visible && !it.drawn && draw(it, 0));
  });
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const it = items.find((i) => i.el === e.target);
        if (!it) continue;
        it.visible = e.isIntersecting;
        if (reduce && it.visible && !it.drawn && it.w) draw(it, 0);
      }
    },
    { rootMargin: '120px 0px' },
  );
  items.forEach((it) => {
    size(it);
    ro.observe(it.el);
    io.observe(it.el);
  });
  if (reduce) return;

  const start = performance.now();
  let last = 0;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    if (document.hidden || now - last < 1000 / 24) return;
    last = now;
    const t = (now - start) / 1000;
    for (const it of items) if (it.visible && it.w) draw(it, t);
  };
  requestAnimationFrame(frame);
}
