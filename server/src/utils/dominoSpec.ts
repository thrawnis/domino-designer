/**
 * Physical reference dimensions for a standard pipless stacking/tricks domino.
 * Recorded here as the single source of truth so any future physical estimate
 * (table footprint, weight, materials list, etc.) derives from real numbers
 * instead of guessing. Mirrored in client/src/utils/dominoSpec.ts, which also
 * derives the on-screen grid spacing from this — keep both in sync.
 */
export const DOMINO_SPEC_MM = {
  /** 1.88 in — the tall dimension, visible face height when standing on edge. */
  length: 48,
  /** 0.945 in — the short dimension, side-to-side along a row/chain. */
  width: 24,
  /** 0.29 in — front-to-back depth when standing on edge. */
  thickness: 7.5,
  /** 0.30 oz. */
  weightGrams: 8.5,
};

/**
 * These are stacking/toppling dominoes: adjacent dominoes must NOT touch.
 * Required clearance is about twice a domino's thickness (~0.58"/15mm),
 * applied the same way both along a chain ("one in front of the other") and
 * between adjacent parallel rows of a topple layout.
 */
export const SPACING_MM = DOMINO_SPEC_MM.thickness * 2;
