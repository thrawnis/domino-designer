import sharp from 'sharp';
import convertHeic from 'heic-convert';
import { HttpError } from '../middleware/errorHandler';

export interface PaletteColor {
  id: string;
  hex: string;
  quantity: number;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Lab {
  l: number;
  a: number;
  b: number;
}

export interface GridCell {
  x: number;
  y: number;
  colorId: string;
  hex: string;
}

export interface ImportGridResult {
  cells: GridCell[];
  /** true if the palette ran out of a preferred color and a substitute was used somewhere */
  ranOutOfInventory: boolean;
}

export type ColorDistanceMode = 'rgb' | 'perceptual';

// Error-diffusion algorithms share one engine (see diffusionGrid below); each
// entry is just its kernel. 'none' (nearest-color, no dithering) and 'bayer'
// (ordered dithering) use different engines, listed after.
export type Algorithm =
  | 'nearest'
  | 'floyd-steinberg'
  | 'atkinson'
  | 'stucki'
  | 'sierra'
  | 'burkes'
  | 'jarvis-judice-ninke'
  | 'bayer';

export const ALGORITHMS: { id: Algorithm; label: string; description: string }[] = [
  { id: 'nearest', label: 'Nearest color', description: 'No dithering — flat blocks of the closest available color.' },
  {
    id: 'floyd-steinberg',
    label: 'Floyd–Steinberg',
    description: 'Classic error-diffusion dithering; organic, film-grain-like noise.',
  },
  {
    id: 'atkinson',
    label: 'Atkinson',
    description: 'Diffuses less error than Floyd–Steinberg; higher contrast, less noisy (classic Mac look).',
  },
  {
    id: 'stucki',
    label: 'Stucki',
    description: 'Wider error-diffusion kernel; smoother gradients, sharper edges than Floyd–Steinberg.',
  },
  { id: 'sierra', label: 'Sierra', description: 'Similar to Stucki with a smaller kernel; a common middle ground.' },
  { id: 'burkes', label: 'Burkes', description: 'Simplified Stucki variant; fast, moderate smoothing.' },
  {
    id: 'jarvis-judice-ninke',
    label: 'Jarvis-Judice-Ninke',
    description: 'Very wide error diffusion; the smoothest gradients of the diffusion algorithms, slowest to visually settle.',
  },
  {
    id: 'bayer',
    label: 'Bayer (ordered)',
    description: 'Fixed crosshatch pattern instead of diffused noise — more predictable/repeatable to build by hand.',
  },
];

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, v));
}

function distanceSqRgb(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

// sRGB -> CIE Lab, for perceptual color distance (CIE76). Standard D65 formulas.
function rgbToLab({ r, g, b }: Rgb): Lab {
  const toLinear = (c: number) => {
    c /= 255;
    return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
  };
  const rl = toLinear(r);
  const gl = toLinear(g);
  const bl = toLinear(b);

  // sRGB -> XYZ (D65)
  const x = rl * 0.4124 + gl * 0.3576 + bl * 0.1805;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = rl * 0.0193 + gl * 0.1192 + bl * 0.9505;

  // Normalize by the D65 white point, then to Lab.
  const xn = x / 0.95047;
  const yn = y / 1.0;
  const zn = z / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(xn);
  const fy = f(yn);
  const fz = f(zn);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function distanceSqLab(a: Lab, b: Lab): number {
  const dl = a.l - b.l;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return dl * dl + da * da + db * db;
}

interface PaletteEntry extends PaletteColor {
  rgb: Rgb;
  lab: Lab;
}

function preparePalette(palette: PaletteColor[]): PaletteEntry[] {
  return palette.map((p) => {
    const rgb = hexToRgb(p.hex);
    return { ...p, rgb, lab: rgbToLab(rgb) };
  });
}

function findNearest(target: Rgb, pool: PaletteEntry[], mode: ColorDistanceMode): PaletteEntry {
  const targetLab = mode === 'perceptual' ? rgbToLab(target) : null;
  let best = pool[0];
  let bestDist = Infinity;
  for (const candidate of pool) {
    const d = mode === 'perceptual' ? distanceSqLab(targetLab!, candidate.lab) : distanceSqRgb(target, candidate.rgb);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return best;
}

// ISO base media file format container brands that mean "this is HEIC/HEIF".
// sharp's bundled libvips can decode the HEIF container but only the AVIF
// (AV1) codec inside it, not HEIC's HEVC codec — patent-licensing reasons,
// not a bug — so HEIC needs converting to JPEG first via a WASM HEVC decoder
// (heic-convert) before sharp ever sees it.
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

function isHeic(buffer: Buffer): boolean {
  if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') return false;
  return HEIC_BRANDS.has(buffer.toString('ascii', 8, 12).trim().toLowerCase());
}

/** Resizes the source image to exactly gridWidth x gridHeight and returns one RGB triple per cell. */
export async function imageToPixelGrid(
  buffer: Buffer,
  gridWidth: number,
  gridHeight: number
): Promise<Rgb[]> {
  let sourceBuffer = buffer;
  if (isHeic(buffer)) {
    try {
      sourceBuffer = Buffer.from(await convertHeic({ buffer, format: 'JPEG', quality: 0.92 }));
    } catch {
      throw new HttpError(400, 'This HEIC photo could not be converted. Try exporting it as JPEG or PNG first.');
    }
  }

  let data: Buffer;
  try {
    ({ data } = await sharp(sourceBuffer)
      .flatten({ background: '#ffffff' })
      .resize(gridWidth, gridHeight, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }));
  } catch {
    throw new HttpError(400, "This image format isn't supported, or the file is corrupted. Try a JPEG or PNG.");
  }

  const pixels: Rgb[] = [];
  for (let i = 0; i < gridWidth * gridHeight; i++) {
    pixels.push({ r: data[i * 3], g: data[i * 3 + 1], b: data[i * 3 + 2] });
  }
  return pixels;
}

interface DiffusionStep {
  dx: number;
  dy: number;
  weight: number; // pre-normalized, all steps for a kernel sum to 1
}

function kernel(divisor: number, steps: [number, number, number][]): DiffusionStep[] {
  return steps.map(([dx, dy, w]) => ({ dx, dy, weight: w / divisor }));
}

// clang-format off
const DIFFUSION_KERNELS: Partial<Record<Algorithm, DiffusionStep[]>> = {
  'floyd-steinberg': kernel(16, [
    [1, 0, 7],
    [-1, 1, 3], [0, 1, 5], [1, 1, 1],
  ]),
  // Only distributes 6/8 of the error (discards the rest) for less bleed/noise.
  atkinson: kernel(8, [
    [1, 0, 1], [2, 0, 1],
    [-1, 1, 1], [0, 1, 1], [1, 1, 1],
    [0, 2, 1],
  ]),
  stucki: kernel(42, [
    [1, 0, 8], [2, 0, 4],
    [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
    [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1],
  ]),
  sierra: kernel(32, [
    [1, 0, 5], [2, 0, 3],
    [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2],
    [-1, 2, 2], [0, 2, 3], [1, 2, 2],
  ]),
  burkes: kernel(32, [
    [1, 0, 8], [2, 0, 4],
    [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
  ]),
  'jarvis-judice-ninke': kernel(48, [
    [1, 0, 7], [2, 0, 5],
    [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
    [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1],
  ]),
};
// clang-format on

// Standard 8x8 Bayer threshold matrix (values 0-63).
const BAYER_8X8 = [
  [0, 48, 12, 60, 3, 51, 15, 63],
  [32, 16, 44, 28, 35, 19, 47, 31],
  [8, 56, 4, 52, 11, 59, 7, 55],
  [40, 24, 36, 20, 43, 27, 39, 23],
  [2, 50, 14, 62, 1, 49, 13, 61],
  [34, 18, 46, 30, 33, 17, 45, 29],
  [10, 58, 6, 54, 9, 57, 5, 53],
  [42, 26, 38, 22, 41, 25, 37, 21],
];
// Heuristic perturbation strength: roughly one palette "step" for a typical
// small domino palette, tuned by eye rather than derived from palette size.
const BAYER_STRENGTH = 40;

function runWithDepletion(
  gridWidth: number,
  gridHeight: number,
  palette: PaletteEntry[],
  distanceMode: ColorDistanceMode,
  pickPixel: (x: number, y: number) => Rgb,
  onChosen: (x: number, y: number, pixel: Rgb, chosen: PaletteEntry) => void
): boolean {
  const remaining = new Map(palette.map((p) => [p.id, p.quantity]));
  let ranOutOfInventory = false;

  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const pixel = pickPixel(x, y);
      const available = palette.filter((p) => (remaining.get(p.id) ?? 0) > 0);
      const pool = available.length > 0 ? available : palette;
      if (available.length === 0) ranOutOfInventory = true;
      const chosen = findNearest(pixel, pool, distanceMode);
      remaining.set(chosen.id, (remaining.get(chosen.id) ?? 0) - 1);
      onChosen(x, y, pixel, chosen);
    }
  }
  return ranOutOfInventory;
}

/** Plain nearest-color mapping, no dithering, depleting inventory as colors are used. */
function nearestGrid(
  pixels: Rgb[],
  gridWidth: number,
  gridHeight: number,
  palette: PaletteEntry[],
  distanceMode: ColorDistanceMode
): ImportGridResult {
  const cells: GridCell[] = [];
  const ranOutOfInventory = runWithDepletion(
    gridWidth,
    gridHeight,
    palette,
    distanceMode,
    (x, y) => pixels[y * gridWidth + x],
    (x, y, _pixel, chosen) => cells.push({ x, y, colorId: chosen.id, hex: chosen.hex })
  );
  return { cells, ranOutOfInventory };
}

/** Error-diffusion dithering against the limited palette for any kernel-based algorithm. */
function diffusionGrid(
  pixels: Rgb[],
  gridWidth: number,
  gridHeight: number,
  palette: PaletteEntry[],
  distanceMode: ColorDistanceMode,
  steps: DiffusionStep[]
): ImportGridResult {
  const work: Rgb[] = pixels.map((p) => ({ ...p }));
  const at = (x: number, y: number) => y * gridWidth + x;
  const cells: GridCell[] = [];

  const diffuse = (x: number, y: number, err: Rgb, weight: number) => {
    if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return;
    const p = work[at(x, y)];
    p.r = clamp255(p.r + err.r * weight);
    p.g = clamp255(p.g + err.g * weight);
    p.b = clamp255(p.b + err.b * weight);
  };

  const ranOutOfInventory = runWithDepletion(
    gridWidth,
    gridHeight,
    palette,
    distanceMode,
    (x, y) => work[at(x, y)],
    (x, y, pixel, chosen) => {
      cells.push({ x, y, colorId: chosen.id, hex: chosen.hex });
      const err: Rgb = { r: pixel.r - chosen.rgb.r, g: pixel.g - chosen.rgb.g, b: pixel.b - chosen.rgb.b };
      for (const step of steps) diffuse(x + step.dx, y + step.dy, err, step.weight);
    }
  );
  return { cells, ranOutOfInventory };
}

/** Ordered (Bayer) dithering: perturbs each pixel by a fixed matrix value before matching, no diffusion. */
function orderedDitherGrid(
  pixels: Rgb[],
  gridWidth: number,
  gridHeight: number,
  palette: PaletteEntry[],
  distanceMode: ColorDistanceMode
): ImportGridResult {
  const cells: GridCell[] = [];
  const ranOutOfInventory = runWithDepletion(
    gridWidth,
    gridHeight,
    palette,
    distanceMode,
    (x, y) => {
      const threshold = BAYER_8X8[y % 8][x % 8] / 63 - 0.5; // -0.5..0.5
      const offset = threshold * BAYER_STRENGTH;
      const p = pixels[y * gridWidth + x];
      return { r: clamp255(p.r + offset), g: clamp255(p.g + offset), b: clamp255(p.b + offset) };
    },
    (x, y, _pixel, chosen) => cells.push({ x, y, colorId: chosen.id, hex: chosen.hex })
  );
  return { cells, ranOutOfInventory };
}

/** Runs the requested algorithm against the palette, depleting inventory quantity as colors are used. */
export function generateGrid(
  pixels: Rgb[],
  gridWidth: number,
  gridHeight: number,
  palette: PaletteColor[],
  algorithm: Algorithm,
  distanceMode: ColorDistanceMode
): ImportGridResult {
  const prepared = preparePalette(palette);
  if (algorithm === 'nearest') {
    return nearestGrid(pixels, gridWidth, gridHeight, prepared, distanceMode);
  }
  if (algorithm === 'bayer') {
    return orderedDitherGrid(pixels, gridWidth, gridHeight, prepared, distanceMode);
  }
  const steps = DIFFUSION_KERNELS[algorithm];
  if (!steps) {
    throw new Error(`Unknown algorithm: ${algorithm}`);
  }
  return diffusionGrid(pixels, gridWidth, gridHeight, prepared, distanceMode, steps);
}
