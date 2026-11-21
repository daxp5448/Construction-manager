export type UnitKind = 'weight' | 'volume' | 'liquid' | 'count' | 'length' | 'area';

export interface UnitDef {
  code: string;
  name: string;
  kind: UnitKind;
  /** multiplier to the base unit of the kind (weight: kg, volume: m3, liquid: litre) */
  to_base: number;
  active?: number;
  sort_order?: number;
}

/** Editable starting list; stored in the `units` table so the user can add/disable units. */
export const SEED_UNITS: UnitDef[] = [
  { code: 'MT', name: 'Metric Ton', kind: 'weight', to_base: 1000, sort_order: 1 },
  { code: 'Ton', name: 'Ton (metric)', kind: 'weight', to_base: 1000, sort_order: 2 },
  { code: 'Kg', name: 'Kilogram', kind: 'weight', to_base: 1, sort_order: 3 },
  { code: 'Quintal', name: 'Quintal', kind: 'weight', to_base: 100, sort_order: 4 },
  { code: 'Brass', name: 'Brass (100 cft)', kind: 'volume', to_base: 2.8316846592, sort_order: 5 },
  { code: 'Cum', name: 'Cubic Meter', kind: 'volume', to_base: 1, sort_order: 6 },
  { code: 'CFT', name: 'Cubic Feet', kind: 'volume', to_base: 0.028316846592, sort_order: 7 },
  { code: 'Bags', name: 'Bags', kind: 'count', to_base: 1, sort_order: 8 },
  { code: 'Litre', name: 'Litre', kind: 'liquid', to_base: 1, sort_order: 9 },
  { code: 'Nos', name: 'Numbers', kind: 'count', to_base: 1, sort_order: 10 },
  { code: 'Sqm', name: 'Square Meter', kind: 'area', to_base: 1, sort_order: 11 },
  { code: 'Rm', name: 'Running Meter', kind: 'length', to_base: 1, sort_order: 12 },
];

/** Convert a milli-quantity between two units of the same kind. Returns null when not convertible. */
export function convertMilli(milli: number, from: UnitDef | undefined, to: UnitDef | undefined): number | null {
  if (!from || !to) return null;
  if (from.code === to.code) return milli;
  if (from.kind !== to.kind) return null;
  if (from.kind === 'count') return null; // different count units are not interchangeable
  return Math.round((milli * from.to_base) / to.to_base);
}

export const WEIGHT_UNITS = ['MT', 'Ton', 'Kg', 'Quintal'];
