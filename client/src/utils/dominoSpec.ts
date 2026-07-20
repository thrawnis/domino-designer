/**
 * Physical reference dimensions for a standard pipless stacking/tricks domino.
 * Recorded here as the single source of truth so spacing, and any future
 * physical estimate (table footprint, weight, etc.), derive from real numbers
 * instead of guessing. Mirrored in server/src/utils/dominoSpec.ts.
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

/**
 * Grid pitch (center-to-center spacing between adjacent placement slots) as a
 * multiple of the domino's own width/length, so any view can derive its pixel
 * grid from a single pixel-per-domino-width scale and stay physically
 * consistent. width : length is already 1:2 (24mm : 48mm).
 */
export const PITCH_X_RATIO = (DOMINO_SPEC_MM.width + SPACING_MM) / DOMINO_SPEC_MM.width; // 1.625
export const PITCH_Y_RATIO = (DOMINO_SPEC_MM.length + SPACING_MM) / DOMINO_SPEC_MM.length; // 1.3125

/**
 * Physical width:height ratio of one grid pitch cell (gap included), i.e. how
 * much real table space one column-step takes vs. one row-step. Used to derive
 * a grid height from an image's aspect ratio so the *physical* result (with
 * gaps) isn't stretched — the gap grows the two axes by different amounts
 * (1.625x vs 1.3125x), so this isn't the same as the tile-only 1:2 shape.
 */
export const PITCH_ASPECT =
  (DOMINO_SPEC_MM.width + SPACING_MM) / (DOMINO_SPEC_MM.length + SPACING_MM); // ~0.619
