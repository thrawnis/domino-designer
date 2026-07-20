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

/** A broad, evenly-distributed swatch grid covering the hue wheel at several
 * shades, plus a grayscale row (including true black and white) — a quick-pick
 * alternative to the full color wheel. */
export const SWATCH_PALETTE: string[] = [
  ...GRAYSCALE.map((l) => hslToHex(0, 0, l)),
  ...LIGHTNESS_STEPS.flatMap((l) => HUES.map((h) => hslToHex(h, 65, l))),
];
