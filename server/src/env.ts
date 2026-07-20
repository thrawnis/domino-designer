function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Number of reverse-proxy hops in front of the app (e.g. 1 for nginx only, 2
// for Cloudflare Tunnel -> nginx -> app). Controls which X-Forwarded-For entry
// is trusted as the client IP, which the login rate limiter keys on. Setting
// this too high lets clients spoof their IP; too low buckets everyone behind
// the proxy together. Default 1.
function trustProxyHops(): number {
  const raw = process.env.TRUST_PROXY_HOPS;
  if (raw === undefined || raw === '') return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`TRUST_PROXY_HOPS must be a non-negative integer, got: ${raw}`);
  }
  return n;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  sessionSecret: required('SESSION_SECRET'),
  isProd: process.env.NODE_ENV === 'production',
  trustProxyHops: trustProxyHops(),
};
