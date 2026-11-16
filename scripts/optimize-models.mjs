// Copies the tree models from basodata_app (public/models/v3) and optimizes them for the web:
// meshopt geometry compression + WebP leaf textures. Same trees as the app, ~3–4× lighter.
//
//   npm run models                      (expects ../basodata_app next to this project)
//   MODELS_SRC=/path/to/v3 npm run models
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(process.env.MODELS_SRC ?? new URL('../../basodata_app/public/models/v3', import.meta.url).pathname);
const OUT = new URL('../public/models', import.meta.url).pathname;

// The species planted in the scene (see src/scripts/forest/species.ts).
const MODELS = [
  'tree-haya',
  'tree-roble',
  'tree-castano',
  'tree-abedul',
  'tree-pino',
  'tree-alerce',
  'tree-conifera',
  'tree-ribera',
  'tree-perenne',
  'tree-caducifolia',
  'arbusto',
];

if (!existsSync(SRC)) {
  console.error(`Models folder not found: ${SRC}\nSet MODELS_SRC to basodata_app/public/models/v3.`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const cli = new URL('../node_modules/@gltf-transform/cli/bin/cli.js', import.meta.url).pathname;
let before = 0;
let after = 0;
for (const name of MODELS) {
  const input = join(SRC, `${name}.glb`);
  const output = join(OUT, `${name}.glb`);
  execFileSync(
    process.execPath,
    [cli, 'optimize', input, output, '--compress', 'meshopt', '--texture-compress', 'webp', '--simplify', 'false', '--instance', 'false', '--join', 'false', '--flatten', 'false', '--palette', 'false'],
    { stdio: 'pipe' },
  );
  const a = statSync(input).size;
  const b = statSync(output).size;
  before += a;
  after += b;
  console.log(`${name.padEnd(18)} ${(a / 1024).toFixed(0).padStart(4)} KB → ${(b / 1024).toFixed(0).padStart(4)} KB`);
}
console.log(`Total ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB`);
