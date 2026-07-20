function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const HUES = [0, 20, 35, 50, 65, 90, 140, 170, 195, 215, 235, 260, 285, 310, 335];
const LIGHTNESS_STEPS = [85, 72, 58, 45, 32];
const GRAYSCALE = [100, 87, 74, 61, 48, 35, 22, 9, 0];

/** Sentinel hex for a fully transparent domino (alpha channel = 00). */
export const TRANSPARENT_HEX = '#00000000';

export const HUE_COUNT = HUES.length;

/** A single-row gradient strip from white to black. */
export const GRAYSCALE_SWATCHES: string[] = GRAYSCALE.map((l) => hslToHex(0, 0, l));

/** Rows of swatches, each row sweeping smoothly across the hue wheel at one
 * lightness level, rows ordered light -> dark, so the whole block reads as a
 * continuous 2D gradient rather than a shuffled grid. */
export const HUE_SWATCH_ROWS: string[][] = LIGHTNESS_STEPS.map((l) => HUES.map((h) => hslToHex(h, 65, l)));
