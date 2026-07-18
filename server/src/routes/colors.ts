import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/errorHandler';

const router = Router();
router.use(requireAuth);

const hexSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value like #A1B2C3');

const colorInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(64),
  hex: hexSchema,
  quantity: z.number().int().min(0).max(1_000_000),
  notes: z.string().trim().max(2000).optional().nullable(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const colors = await prisma.dominoColor.findMany({
      where: { userId: req.session.userId! },
      orderBy: { name: 'asc' },
    });
    res.json({ colors });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = colorInputSchema.parse(req.body);
    const existing = await prisma.dominoColor.findUnique({
      where: { userId_name: { userId: req.session.userId!, name: data.name } },
    });
    if (existing) {
      throw new HttpError(409, 'A color with this name already exists');
    }
    const color = await prisma.dominoColor.create({
      data: { ...data, userId: req.session.userId! },
    });
    res.status(201).json({ color });
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = colorInputSchema.partial().parse(req.body);
    const existing = await prisma.dominoColor.findFirst({
      where: { id: req.params.id, userId: req.session.userId! },
    });
    if (!existing) {
      throw new HttpError(404, 'Color not found');
    }
    if (data.name && data.name !== existing.name) {
      const nameTaken = await prisma.dominoColor.findUnique({
        where: { userId_name: { userId: req.session.userId!, name: data.name } },
      });
      if (nameTaken) {
        throw new HttpError(409, 'A color with this name already exists');
      }
    }
    const color = await prisma.dominoColor.update({
      where: { id: existing.id },
      data,
    });
    res.json({ color });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.dominoColor.findFirst({
      where: { id: req.params.id, userId: req.session.userId! },
    });
    if (!existing) {
      throw new HttpError(404, 'Color not found');
    }
    try {
      await prisma.dominoColor.delete({ where: { id: existing.id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new HttpError(409, 'This color is used in one or more designs and cannot be deleted');
      }
      throw err;
    }
    res.status(204).end();
  })
);

export default router;
