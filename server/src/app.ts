import path from 'path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import { env } from './env';
import { requireCsrfHeader } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth';
import colorRoutes from './routes/colors';
import designRoutes from './routes/designs';
import imageImportRoutes from './routes/imageImport';

const PgSession = connectPgSimple(session);

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
        },
      },
    })
  );

  if (!env.isProd) {
    app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
  }

  app.use(express.json({ limit: '1mb' }));

  const sessionPool = new Pool({ connectionString: env.databaseUrl });

  app.use(
    session({
      store: new PgSession({ pool: sessionPool, tableName: 'session', createTableIfMissing: true }),
      name: 'domino.sid',
      secret: env.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        // 'auto' marks the cookie Secure only when the request is actually HTTPS
        // (directly, or via a trusted proxy's X-Forwarded-Proto). Needed because
        // this app may be reached both over plain HTTP (direct LAN access) and
        // HTTPS (via a reverse proxy or Cloudflare Tunnel) at the same time.
        secure: 'auto',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      },
    })
  );

  app.use('/api', requireCsrfHeader);
  app.use('/api/auth', authRoutes);
  app.use('/api/colors', colorRoutes);
  app.use('/api/designs', designRoutes);
  app.use('/api/designs', imageImportRoutes);

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  const clientDist = path.join(__dirname, '..', 'public');
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  app.use(errorHandler);

  return app;
}
