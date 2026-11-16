/**
 * The species planted in the scene: the basodata_app tree models, with the same tints the app uses
 * (TREE_COLORS_BY_VARIANT in basodata_app/src/features/ficha/treeModels.ts).
 */
import type { TreeModel } from '../../data/trees';

export type Species = {
  model: TreeModel;
  /** Tint mixed lightly into the leaves (12%, like the app). */
  tint: string;
  /** Adult height range, in metres. */
  height: [number, number];
  /** Crown radius as a fraction of height (for the canopy shade map). */
  crown: number;
  /** Share of trees showing early autumn colour. */
  autumn: number;
  /** Conifers sway less. */
  wind: number;
};

export const SPECIES: Record<TreeModel, Species> = {
  'tree-haya': { model: 'tree-haya', tint: '#4f8a2e', height: [21, 30], crown: 0.24, autumn: 0.12, wind: 1 },
  'tree-roble': { model: 'tree-roble', tint: '#4a6b2a', height: [17, 25], crown: 0.3, autumn: 0.06, wind: 0.9 },
  'tree-castano': { model: 'tree-castano', tint: '#5a7f2c', height: [14, 22], crown: 0.28, autumn: 0.14, wind: 1 },
  'tree-abedul': { model: 'tree-abedul', tint: '#7a9f48', height: [12, 19], crown: 0.2, autumn: 0.22, wind: 1.35 },
  'tree-pino': { model: 'tree-pino', tint: '#3b5f2c', height: [22, 31], crown: 0.14, autumn: 0, wind: 0.55 },
  'tree-alerce': { model: 'tree-alerce', tint: '#6b8f3a', height: [20, 28], crown: 0.15, autumn: 0.18, wind: 0.6 },
  'tree-conifera': { model: 'tree-conifera', tint: '#24503c', height: [22, 32], crown: 0.15, autumn: 0, wind: 0.5 },
  'tree-ribera': { model: 'tree-ribera', tint: '#4b7f64', height: [12, 19], crown: 0.24, autumn: 0.05, wind: 1.2 },
  'tree-perenne': { model: 'tree-perenne', tint: '#2d5a27', height: [5, 9], crown: 0.3, autumn: 0, wind: 0.8 },
  'tree-caducifolia': { model: 'tree-caducifolia', tint: '#7f6f3b', height: [13, 20], crown: 0.26, autumn: 0.16, wind: 1.1 },
  arbusto: { model: 'arbusto', tint: '#7a8f4f', height: [1.1, 2.6], crown: 0.5, autumn: 0.1, wind: 1.4 },
};

export const MODELS = Object.keys(SPECIES) as TreeModel[];

/** Which species grow in each stand, and how often. */
export const STANDS: Record<string, [TreeModel, number][]> = {
  meadow: [
    ['tree-abedul', 0.4],
    ['tree-roble', 0.3],
    ['tree-caducifolia', 0.2],
    ['tree-castano', 0.1],
  ],
  broadleaf: [
    ['tree-haya', 0.44],
    ['tree-roble', 0.22],
    ['tree-castano', 0.16],
    ['tree-caducifolia', 0.1],
    ['tree-abedul', 0.08],
  ],
  clearing: [
    ['tree-abedul', 0.38],
    ['tree-caducifolia', 0.2],
    ['tree-roble', 0.16],
    ['tree-haya', 0.14],
    ['tree-castano', 0.12],
  ],
  hollow: [
    ['tree-ribera', 0.72],
    ['tree-abedul', 0.14],
    ['tree-caducifolia', 0.14],
  ],
  conifer: [
    ['tree-pino', 0.58],
    ['tree-alerce', 0.24],
    ['tree-conifera', 0.18],
  ],
};
