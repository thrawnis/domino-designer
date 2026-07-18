import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/errorHandler';

const router = Router();
router.use(requireAuth);

const designInputSchema = z.object({
  name: z.string().trim().min(1).max(128),
  gridWidth: z.number().int().min(1).max(500),
  gridHeight: z.number().int().min(1).max(500),
});

const placementSchema = z.object({
  id: z.string().uuid().optional(),
  colorId: z.string().uuid(),
  x: z.number(),
  y: z.number(),
  rotation: z.number(),
  zIndex: z.number().int(),
});

const placementsBatchSchema = z.object({
  placements: z.array(placementSchema).max(20000),
});

async function loadOwnedDesign(designId: string, userId: string) {
  const design = await prisma.design.findFirst({ where: { id: designId, userId } });
  if (!design) {
    throw new HttpError(404, 'Design not found');
  }
  return design;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const designs = await prisma.design.findMany({
      where: { userId: req.session.userId! },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ designs });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = designInputSchema.parse(req.body);
    const design = await prisma.design.create({
      data: { ...data, userId: req.session.userId! },
    });
    res.status(201).json({ design });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const design = await loadOwnedDesign(req.params.id, req.session.userId!);
    const placements = await prisma.dominoPlacement.findMany({
      where: { designId: design.id },
      include: { color: true },
    });
    res.json({ design, placements });
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const design = await loadOwnedDesign(req.params.id, req.session.userId!);
    const data = designInputSchema.partial().parse(req.body);
    const updated = await prisma.design.update({ where: { id: design.id }, data });
    res.json({ design: updated });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const design = await loadOwnedDesign(req.params.id, req.session.userId!);
    await prisma.design.delete({ where: { id: design.id } });
    res.status(204).end();
  })
);

// Replaces the full placement set for a design in one transaction.
router.put(
  '/:id/placements',
  asyncHandler(async (req, res) => {
    const design = await loadOwnedDesign(req.params.id, req.session.userId!);
    const { placements } = placementsBatchSchema.parse(req.body);

    const colorIds = [...new Set(placements.map((p) => p.colorId))];
    if (colorIds.length > 0) {
      const ownedColors = await prisma.dominoColor.findMany({
        where: { id: { in: colorIds }, userId: req.session.userId! },
        select: { id: true },
      });
      if (ownedColors.length !== colorIds.length) {
        throw new HttpError(400, 'One or more colors do not belong to this account');
      }
    }

    await prisma.$transaction([
      prisma.dominoPlacement.deleteMany({ where: { designId: design.id } }),
      ...(placements.length > 0
        ? [
            prisma.dominoPlacement.createMany({
              data: placements.map((p) => ({
                designId: design.id,
                colorId: p.colorId,
                x: p.x,
                y: p.y,
                rotation: p.rotation,
                zIndex: p.zIndex,
              })),
            }),
          ]
        : []),
    ]);

    const saved = await prisma.dominoPlacement.findMany({
      where: { designId: design.id },
      include: { color: true },
    });
    res.json({ placements: saved });
  })
);

export default router;
