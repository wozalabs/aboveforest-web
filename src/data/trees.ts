/**
 * The trees you stop at on the trail, with the data AboveForest shows for each one.
 * Shared by the page (panel markup) and the 3D scene (where each tree stands and how tall it is).
 *
 * Figures are illustrative sample values for the prototype, kept internally consistent
 * (volume × wood density × expansion factor → biomass; biomass × 0.5 × 3.67 → CO₂e).
 */
export type TreeModel =
  | 'tree-haya'
  | 'tree-roble'
  | 'tree-castano'
  | 'tree-abedul'
  | 'tree-pino'
  | 'tree-alerce'
  | 'tree-conifera'
  | 'tree-ribera'
  | 'tree-perenne'
  | 'tree-caducifolia'
  | 'arbusto';

export type FeaturedTree = {
  id: string;
  model: TreeModel;
  commonName: string;
  scientificName: string;
  /** Position along the trail (world z; the walk goes towards −z). */
  z: number;
  /** Side of the trail: 1 = right, −1 = left (as you walk). */
  side: 1 | -1;
  /** Distance from the trail centre, in metres. */
  offset: number;
  height: number;
  crown: number;
  dbh: number;
  volume: number;
  biomass: number;
  carbon: number;
  vigor: number;
  vigorLabel: string;
  vigorTone: 'good' | 'watch';
  age: number;
  /** Height at each LiDAR flight. */
  growth: [year: number, height: number][];
  note: string;
  ref: string;
};

export const FEATURED_TREES: FeaturedTree[] = [
  {
    id: 'beech',
    model: 'tree-haya',
    commonName: 'European beech',
    scientificName: 'Fagus sylvatica',
    z: 16,
    side: 1,
    offset: 7.5,
    height: 27.4,
    crown: 14.2,
    dbh: 62,
    volume: 4.9,
    biomass: 3.8,
    carbon: 7.0,
    vigor: 0.86,
    vigorLabel: 'Vigorous',
    vigorTone: 'good',
    age: 118,
    growth: [
      [2008, 24.1],
      [2012, 25.0],
      [2017, 26.3],
      [2024, 27.4],
    ],
    note: 'Dominant crown. Seed tree for the natural regeneration around it.',
    ref: 'AF-0412-1187',
  },
  {
    id: 'oak',
    model: 'tree-roble',
    commonName: 'Pedunculate oak',
    scientificName: 'Quercus robur',
    z: -20,
    side: -1,
    offset: 8,
    height: 22.6,
    crown: 16.8,
    dbh: 74,
    volume: 5.6,
    biomass: 4.4,
    carbon: 8.1,
    vigor: 0.78,
    vigorLabel: 'Good',
    vigorTone: 'good',
    age: 160,
    growth: [
      [2008, 20.4],
      [2012, 21.0],
      [2017, 21.9],
      [2024, 22.6],
    ],
    note: 'The oldest tree in the stand. Widest crown measured on this trail.',
    ref: 'AF-0412-0934',
  },
  {
    id: 'birch',
    model: 'tree-abedul',
    commonName: 'Silver birch',
    scientificName: 'Betula pendula',
    z: -56,
    side: 1,
    offset: 6.5,
    height: 17.1,
    crown: 7.4,
    dbh: 31,
    volume: 0.62,
    biomass: 0.44,
    carbon: 0.8,
    vigor: 0.64,
    vigorLabel: 'Under watch',
    vigorTone: 'watch',
    age: 38,
    growth: [
      [2008, 13.2],
      [2012, 14.6],
      [2017, 16.0],
      [2024, 17.1],
    ],
    note: 'Crown thinning detected since 2022. Flagged for a field visit.',
    ref: 'AF-0415-2210',
  },
  {
    id: 'alder',
    model: 'tree-ribera',
    commonName: 'Black alder',
    scientificName: 'Alnus glutinosa',
    z: -88,
    side: -1,
    offset: 7,
    height: 18.3,
    crown: 9.1,
    dbh: 38,
    volume: 0.98,
    biomass: 0.6,
    carbon: 1.1,
    vigor: 0.81,
    vigorLabel: 'Good',
    vigorTone: 'good',
    age: 52,
    growth: [
      [2008, 15.0],
      [2012, 16.1],
      [2017, 17.4],
      [2024, 18.3],
    ],
    note: 'Grows in the wet hollow. Part of the riparian buffer along the stream.',
    ref: 'AF-0415-3047',
  },
  {
    id: 'pine',
    model: 'tree-pino',
    commonName: 'Monterey pine',
    scientificName: 'Pinus radiata',
    z: -128,
    side: 1,
    offset: 8,
    height: 30.8,
    crown: 8.6,
    dbh: 54,
    volume: 2.9,
    biomass: 1.5,
    carbon: 2.8,
    vigor: 0.83,
    vigorLabel: 'Good',
    vigorTone: 'good',
    age: 34,
    growth: [
      [2008, 18.2],
      [2012, 22.9],
      [2017, 27.4],
      [2024, 30.8],
    ],
    note: 'Plantation stand. Reaches the harvest diameter class this season.',
    ref: 'AF-0421-0518',
  },
];
