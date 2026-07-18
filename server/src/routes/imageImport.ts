import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/errorHandler';
import { imageToPixelGrid, nearestColorGrid, ditheredGrid } from '../services/imageProcessing';

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

const querySchema = z.object({
  gridWidth: z.coerce.number().int().min(1).max(200),
  gridHeight: z.coerce.number().int().min(1).max(200),
});

router.post(
  '/import-preview',
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new HttpError(400, 'No image uploaded');
    }
    const { gridWidth, gridHeight } = querySchema.parse(req.body);

    const colors = await prisma.dominoColor.findMany({
      where: { userId: req.session.userId!, quantity: { gt: 0 } },
    });
    if (colors.length === 0) {
      throw new HttpError(400, 'Your inventory has no dominoes with quantity greater than zero');
    }

    const palette = colors.map((c) => ({ id: c.id, hex: c.hex, quantity: c.quantity }));
    const pixels = await imageToPixelGrid(req.file.buffer, gridWidth, gridHeight);

    const nearest = nearestColorGrid(pixels, gridWidth, gridHeight, palette);
    const dithered = ditheredGrid(pixels, gridWidth, gridHeight, palette);

    res.json({
      gridWidth,
      gridHeight,
      nearest: { cells: nearest.cells, ranOutOfInventory: nearest.ranOutOfInventory },
      dithered: { cells: dithered.cells, ranOutOfInventory: dithered.ranOutOfInventory },
    });
  })
);

export default router;
