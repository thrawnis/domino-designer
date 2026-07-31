import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/errorHandler';
import { ALGORITHMS, Algorithm, generateGrid, imageToPixelGrid } from '../services/imageProcessing';

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new HttpError(400, 'Uploaded file must be an image'));
      return;
    }
    cb(null, true);
  },
});

// Each domino becomes an interactive element in the editor, so cap the total
// cell count (not just each dimension) to keep the editor responsive.
const MAX_IMPORT_CELLS = 12000;
const ALGORITHM_IDS = ALGORITHMS.map((a) => a.id) as [Algorithm, ...Algorithm[]];

const bodySchema = z
  .object({
    gridWidth: z.coerce.number().int().min(1).max(200),
    gridHeight: z.coerce.number().int().min(1).max(200),
    // Sent as a JSON-encoded array (multipart fields are otherwise flat strings).
    algorithms: z
      .string()
      .transform((s, ctx) => {
        try {
          return JSON.parse(s);
        } catch {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'algorithms must be a JSON array' });
          return z.NEVER;
        }
      })
      .pipe(z.array(z.enum(ALGORITHM_IDS)).min(1).max(ALGORITHM_IDS.length)),
    distanceMode: z.enum(['rgb', 'perceptual']).default('rgb'),
  })
  .refine((v) => v.gridWidth * v.gridHeight <= MAX_IMPORT_CELLS, {
    message: `Grid is too large; at most ${MAX_IMPORT_CELLS} dominoes total`,
    path: ['gridWidth'],
  });

router.get('/import-algorithms', (_req, res) => {
  res.json({ algorithms: ALGORITHMS });
});

router.post(
  '/import-preview',
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new HttpError(400, 'No image uploaded');
    }
    const { gridWidth, gridHeight, algorithms, distanceMode } = bodySchema.parse(req.body);

    const colors = await prisma.dominoColor.findMany({
      where: { userId: req.session.userId!, quantity: { gt: 0 } },
    });
    if (colors.length === 0) {
      throw new HttpError(400, 'Your inventory has no dominoes with quantity greater than zero');
    }

    const palette = colors.map((c) => ({ id: c.id, hex: c.hex, quantity: c.quantity }));
    const pixels = await imageToPixelGrid(req.file.buffer, gridWidth, gridHeight);

    const results: Record<string, { cells: unknown; ranOutOfInventory: boolean }> = {};
    for (const algorithm of [...new Set(algorithms)]) {
      const result = generateGrid(pixels, gridWidth, gridHeight, palette, algorithm, distanceMode);
      results[algorithm] = { cells: result.cells, ranOutOfInventory: result.ranOutOfInventory };
    }

    res.json({ gridWidth, gridHeight, results });
  })
);

export default router;
