/**
 * Loads the basodata_app tree models (meshopt-compressed copies in /models). The featured trees are
 * planted as real meshes; the same geometry seeds the point-cloud templates of the rest.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { TreeModel } from '../../data/trees';
import type { Plant } from './layout';
import { patchTree, type SharedUniforms } from './materials';
import { MODELS, SPECIES } from './species';

export type TreeAsset = {
  bark: BufferGeometry;
  leaves: BufferGeometry;
  barkMaterial: MeshStandardMaterial;
  leafMaterial: MeshStandardMaterial;
  /** Model height in its own units. */
  native: number;
};

/** Attributes as plain floats: meshopt quantizes them, and we bake transforms into the geometry. */
function toFloat(geometry: BufferGeometry) {
  for (const name of Object.keys(geometry.attributes)) {
    const attr = geometry.getAttribute(name);
    if (attr instanceof BufferAttribute && attr.array instanceof Float32Array && !attr.normalized) continue;
    const out = new Float32Array(attr.count * attr.itemSize);
    for (let i = 0; i < attr.count; i++) {
      for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
    }
    geometry.setAttribute(name, new BufferAttribute(out, attr.itemSize));
  }
  return geometry;
}

export async function loadTrees(base: string, shared: SharedUniforms, onProgress?: (loaded: number, total: number) => void) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  let loaded = 0;
  const entries = await Promise.all(
    MODELS.map(async (model) => {
      const gltf = await loader.loadAsync(`${base}models/${model}.glb`);
      onProgress?.(++loaded, MODELS.length);
      gltf.scene.updateMatrixWorld(true);
      let bark: BufferGeometry | null = null;
      let leaves: BufferGeometry | null = null;
      let barkMaterial: MeshStandardMaterial | null = null;
      let leafMaterial: MeshStandardMaterial | null = null;
      gltf.scene.traverse((obj) => {
        const mesh = obj as Mesh;
        if (!mesh.isMesh) return;
        const geometry = toFloat(mesh.geometry.clone());
        geometry.applyMatrix4(mesh.matrixWorld);
        const material = mesh.material as MeshStandardMaterial;
        if (material.map) {
          leaves = geometry;
          leafMaterial = material;
        } else {
          bark = geometry;
          barkMaterial = material;
        }
      });
      if (!bark || !leaves || !barkMaterial || !leafMaterial) throw new Error(`Unexpected model layout: ${model}`);
      const b = bark as BufferGeometry;
      const l = leaves as BufferGeometry;
      b.computeBoundingBox();
      l.computeBoundingBox();
      const native = Math.max(b.boundingBox!.max.y, l.boundingBox!.max.y);

      const s = SPECIES[model];
      const tint = new Color(s.tint);
      const leaf = (leafMaterial as MeshStandardMaterial).clone();
      leaf.color.lerp(tint, 0.12);
      leaf.alphaToCoverage = true;
      leaf.vertexColors = true;
      leaf.roughness = 0.85;
      leaf.metalness = 0;
      patchTree(leaf, shared, { native, wind: s.wind, leaf: true });

      const trunk = (barkMaterial as MeshStandardMaterial).clone();
      trunk.vertexColors = true;
      trunk.roughness = 0.95;
      trunk.metalness = 0;
      patchTree(trunk, shared, { native, wind: s.wind, leaf: false });

      return [model, { bark: b, leaves: l, barkMaterial: trunk, leafMaterial: leaf, native }] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<TreeModel, TreeAsset>;
}

export type FeaturedInstance = {
  index: number;
  model: TreeModel;
  matrix: Matrix4;
  position: Vector3;
  height: number;
};

/**
 * The physical trees: only the featured ones, with their textures, wind and real shadows.
 * Everything else is the point cloud (pointcloud.ts).
 */
export function plantFeatured(assets: Record<TreeModel, TreeAsset>, plants: Plant[]) {
  const group = new Group();
  group.name = 'featured-trees';
  const featured: FeaturedInstance[] = [];
  const q = new Quaternion();
  const e = new Euler();
  const p = new Vector3();
  const s = new Vector3();
  let triangles = 0;
  for (const plant of plants) {
    if (plant.featured == null) continue;
    const asset = assets[plant.model];
    const k = plant.height / asset.native;
    q.setFromEuler(e.set(0, plant.rot, 0));
    p.set(plant.x, plant.y - 0.08, plant.z);
    s.set(k * plant.spread, k, k * plant.spread);
    const m = new Matrix4().compose(p, q, s);
    const bark = new Mesh(asset.bark, asset.barkMaterial);
    const leaves = new Mesh(asset.leaves, asset.leafMaterial);
    for (const mesh of [bark, leaves]) {
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    triangles += ((asset.leaves.index?.count ?? 0) + (asset.bark.index?.count ?? 0)) / 3;
    featured[plant.featured] = { index: plant.featured, model: plant.model, matrix: m, position: p.clone(), height: plant.height };
  }
  return { group, featured, triangles };
}

export function disposeTrees(assets: Record<TreeModel, TreeAsset>) {
  for (const a of Object.values(assets)) {
    a.bark.dispose();
    a.leaves.dispose();
    a.leafMaterial.map?.dispose();
    a.barkMaterial.dispose();
    a.leafMaterial.dispose();
  }
}
