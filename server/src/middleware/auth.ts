import { Request, Response, NextFunction } from 'express';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// Defense-in-depth CSRF check for a same-origin SPA using cookie sessions:
// state-changing requests must carry this header, which cross-site <form>
// submissions and simple cross-origin fetches cannot set.
export function requireCsrfHeader(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  if (req.get('X-Requested-With') !== 'domino-designer') {
    return res.status(403).json({ error: 'Missing CSRF header' });
  }
  next();
}
