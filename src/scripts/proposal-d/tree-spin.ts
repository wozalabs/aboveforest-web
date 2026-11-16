/**
 * Decorative trees: one of the aboveforest_app models (meshopt copies in /models), turning slowly on a
 * transparent canvas. Each [data-tree="tree-haya"] element gets its own small renderer, created only
 * when it comes near the screen. It draws at 30 fps while on screen and stops otherwise; with reduced
 * motion it draws once and stays still. three.js is the same chunk the 3D hero already loads.
 */
type Spinner = { start(): void; stop(): void };

const TINTS: Record<string, string> = {
  'tree-haya': '#4f8a2e',
  'tree-roble': '#4a6b2a',
  'tree-pino': '#3b5f2c',
  'tree-abedul': '#6f9a3a',
  'tree-castano': '#557a2c',
};

async function createSpinner(el: HTMLElement, model: string, reduce: boolean): Promise<Spinner> {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 400);
  scene.add(new THREE.HemisphereLight(0xf1f6ee, 0x2f3d2c, 2.3));
  // The sun stays put while the tree turns, so its shadow turns on the ground like a real one.
  const sun = new THREE.DirectionalLight(0xfff6e6, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  const gltf = await loader.loadAsync(`${base}models/${model}.glb`);
  const tree = gltf.scene;
  const tint = new THREE.Color(TINTS[model] ?? '#4f8a2e');
  tree.traverse((obj) => {
    const mesh = obj as InstanceType<typeof THREE.Mesh>;
    if (!mesh.isMesh) return;
    const m = (mesh.material as InstanceType<typeof THREE.MeshStandardMaterial>).clone();
    m.vertexColors = !!mesh.geometry.getAttribute('color');
    m.roughness = 0.85;
    m.metalness = 0;
    if (m.map) {
      m.color.lerp(tint, 0.12);
      m.alphaToCoverage = true;
      m.side = THREE.DoubleSide;
      // Leaf cards cast leaf-shaped shadows, not rectangles.
      m.alphaTest = 0.4;
    }
    mesh.material = m;
    mesh.castShadow = true;
  });

  // Centre the tree on its trunk and frame it whole.
  const box = new THREE.Box3().setFromObject(tree);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  tree.position.set(-centre.x, -box.min.y, -centre.z);
  const pivot = new THREE.Group();
  pivot.add(tree);
  scene.add(pivot);
  const target = new THREE.Vector3(0, size.y * 0.46, 0);

  // The ground. On light sections it shows only the shadow (the page shows through). On dark ones a
  // shadow alone would be invisible, so a faint pool of light on the ground carries it.
  const reach = Math.max(size.x, size.z, size.y * 0.6);
  let groundMat: InstanceType<typeof THREE.Material>;
  if (el.dataset.ground === 'dark') {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.55, '#666');
    grad.addColorStop(1, '#000');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    groundMat = new THREE.MeshLambertMaterial({
      color: 0xb8d49c,
      transparent: true,
      opacity: 0.22,
      alphaMap: new THREE.CanvasTexture(c),
      depthWrite: false,
    });
  } else {
    groundMat = new THREE.ShadowMaterial({ opacity: 0.3 });
  }
  const groundSize = el.dataset.ground === 'dark' ? reach * 1.7 : reach * 6;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // From high behind the tree, so the shadow falls forward and stays in view.
  sun.position.set(-size.y * 0.3, size.y * 1.6, -size.y * 0.5);
  const cam = sun.shadow.camera as InstanceType<typeof THREE.OrthographicCamera>;
  const half = reach * 1.6;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = 0.1;
  cam.far = size.y * 5;
  cam.updateProjectionMatrix();

  function resize() {
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Fit height and width, with a little air.
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const byH = (size.y * 0.56) / Math.tan(fov / 2);
    const byW = (Math.max(size.x, size.z) * 0.56) / (Math.tan(fov / 2) * camera.aspect);
    const d = Math.max(byH, byW);
    camera.position.set(0, target.y + d * 0.12, d);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    draw();
  }

  const draw = () => renderer.render(scene, camera);
  new ResizeObserver(resize).observe(el);
  resize();
  el.setAttribute('data-ready', '');

  let raf = 0;
  let last = 0;
  let running = false;
  const SPEED = 0.18; // radians per second: one turn in about 35 s
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (now - last < 1000 / 30 - 2) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    pivot.rotation.y += dt * SPEED;
    draw();
  };
  return {
    start() {
      if (running || reduce) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}

export function mountTrees() {
  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-tree]'));
  if (!els.length) return;
  try {
    if (!document.createElement('canvas').getContext('webgl2')) return;
  } catch {
    return;
  }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const spinners = new Map<HTMLElement, Promise<Spinner> | null>();
  const visible = new Set<HTMLElement>();

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        if (e.isIntersecting) {
          visible.add(el);
          if (!spinners.get(el)) spinners.set(el, createSpinner(el, el.dataset.tree!, reduce).catch((err) => {
            console.error('Tree failed to load', err);
            return null as unknown as Spinner;
          }));
          spinners.get(el)!.then((s) => s && visible.has(el) && !document.hidden && s.start());
        } else {
          visible.delete(el);
          spinners.get(el)?.then((s) => s?.stop());
        }
      }
    },
    { rootMargin: '200px 0px' },
  );
  els.forEach((el) => io.observe(el));
  document.addEventListener('visibilitychange', () => {
    for (const [el, p] of spinners) p?.then((s) => (document.hidden || !visible.has(el) ? s?.stop() : s?.start()));
  });
}
