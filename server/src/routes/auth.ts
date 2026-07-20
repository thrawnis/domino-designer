import { Router } from 'express';
import argon2 from 'argon2';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, HttpError } from '../middleware/errorHandler';

const router = Router();

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(32, 'Username must be at most 32 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Username may only contain letters, numbers, underscores, and hyphens');

// NIST 800-63B: enforce a minimum length, do not force arbitrary composition rules.
const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(256, 'Password is too long');

const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

const loginSchema = z.object({
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(256),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
});

// Strong argon2id params suitable for an interactive login endpoint.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // ~19 MiB
  timeCost: 2,
  parallelism: 1,
};

router.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res, next) => {
    const { username, password } = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      throw new HttpError(409, 'Username is already taken');
    }

    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
    const user = await prisma.user.create({
      data: { username, passwordHash },
      select: { id: true, username: true, createdAt: true },
    });

    // Regenerate the session to prevent session fixation. The callback runs
    // outside the async chain, so surface errors via next() rather than throw.
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      res.status(201).json({ user });
    });
  })
);

router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res, next) => {
    const { username, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { username } });
    // Always run argon2.verify against a hash (even a dummy one) to avoid
    // leaking user existence via response timing.
    const hashToVerify =
      user?.passwordHash ??
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Ry+Fv3sN7v5m6dQ8f1XwEg';
    const valid = await argon2.verify(hashToVerify, password).catch(() => false);

    if (!user || !valid) {
      throw new HttpError(401, 'Invalid username or password');
    }

    // Regenerate the session to prevent session fixation. The callback runs
    // outside the async chain, so surface errors via next() rather than throw.
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      res.json({ user: { id: user.id, username: user.username, createdAt: user.createdAt } });
    });
  })
);

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to log out' });
    }
    res.clearCookie('domino.sid');
    res.status(204).end();
  });
});

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { id: true, username: true, createdAt: true },
    });
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json({ user });
  })
);

export default router;
