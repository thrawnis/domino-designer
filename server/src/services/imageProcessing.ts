import sharp from 'sharp';

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

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function distanceSq(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, v));
}

/** Resizes the source image to exactly gridWidth x gridHeight and returns one RGB triple per cell. */
export async function imageToPixelGrid(
  buffer: Buffer,
  gridWidth: number,
  gridHeight: number
): Promise<Rgb[]> {
  const { data } = await sharp(buffer)
    .flatten({ background: '#ffffff' })
    .resize(gridWidth, gridHeight, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels: Rgb[] = [];
  for (let i = 0; i < gridWidth * gridHeight; i++) {
    pixels.push({ r: data[i * 3], g: data[i * 3 + 1], b: data[i * 3 + 2] });
  }
  return pixels;
}

function findNearest(target: Rgb, palette: (PaletteColor & { rgb: Rgb })[]): PaletteColor & { rgb: Rgb } {
  let best = palette[0];
  let bestDist = Infinity;
  for (const candidate of palette) {
    const d = distanceSq(target, candidate.rgb);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return best;
}

/** Simple per-cell nearest-color mapping, depleting inventory quantity as colors are used. */
export function nearestColorGrid(
  pixels: Rgb[],
  gridWidth: number,
  gridHeight: number,
  palette: PaletteColor[]
): ImportGridResult {
  const withRgb = palette.map((p) => ({ ...p, rgb: hexToRgb(p.hex) }));
  const remaining = new Map(withRgb.map((p) => [p.id, p.quantity]));
  let ranOutOfInventory = false;
  const cells: GridCell[] = [];

  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const pixel = pixels[y * gridWidth + x];
      const available = withRgb.filter((p) => (remaining.get(p.id) ?? 0) > 0);
      const pool = available.length > 0 ? available : withRgb;
      if (available.length === 0) ranOutOfInventory = true;
      const chosen = findNearest(pixel, pool);
      remaining.set(chosen.id, (remaining.get(chosen.id) ?? 0) - 1);
      cells.push({ x, y, colorId: chosen.id, hex: chosen.hex });
    }
  }
  return { cells, ranOutOfInventory };
}

/** Floyd-Steinberg dithered mapping against the limited palette, also depleting inventory. */
export function ditheredGrid(
  pixels: Rgb[],
  gridWidth: number,
  gridHeight: number,
  palette: PaletteColor[]
): ImportGridResult {
  const withRgb = palette.map((p) => ({ ...p, rgb: hexToRgb(p.hex) }));
  const remaining = new Map(withRgb.map((p) => [p.id, p.quantity]));
  let ranOutOfInventory = false;

  // Working copy of pixel values we can perturb with diffused error.
  const work: Rgb[] = pixels.map((p) => ({ ...p }));
  const cells: GridCell[] = [];

  const at = (x: number, y: number) => y * gridWidth + x;

  const diffuse = (x: number, y: number, err: Rgb, factor: number) => {
    if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return;
    const p = work[at(x, y)];
    p.r = clamp255(p.r + err.r * factor);
    p.g = clamp255(p.g + err.g * factor);
    p.b = clamp255(p.b + err.b * factor);
  };

  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const pixel = work[at(x, y)];
      const available = withRgb.filter((p) => (remaining.get(p.id) ?? 0) > 0);
      const pool = available.length > 0 ? available : withRgb;
      if (available.length === 0) ranOutOfInventory = true;
      const chosen = findNearest(pixel, pool);
      remaining.set(chosen.id, (remaining.get(chosen.id) ?? 0) - 1);
      cells.push({ x, y, colorId: chosen.id, hex: chosen.hex });

      const err: Rgb = {
        r: pixel.r - chosen.rgb.r,
        g: pixel.g - chosen.rgb.g,
        b: pixel.b - chosen.rgb.b,
      };
      diffuse(x + 1, y, err, 7 / 16);
      diffuse(x - 1, y + 1, err, 3 / 16);
      diffuse(x, y + 1, err, 5 / 16);
      diffuse(x + 1, y + 1, err, 1 / 16);
    }
  }
  return { cells, ranOutOfInventory };
}
