import 'dotenv/config';
import express from 'express';
import path from 'path';
import session from 'express-session';
import cors from 'cors';
import router from './routes/index.js';
import apiRouter from './routes/api.js';
import security from './middleware/security.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const FRONTEND_URL = (process.env.FRONTEND_URL || '').trim();
const API_ORIGIN = (process.env.API_ORIGIN || '').trim();
const extraCorsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production');
}

// Trust proxy for correct secure cookies and protocol detection behind Hostinger proxy
app.set('trust proxy', 1);

// ─── Security Middleware (applied first) ───────────────────────────────────
app.disable('x-powered-by');
app.use(security.securityHeadersMiddleware);
app.use(security.preventParameterPollution);
app.use(security.requestSizeLimit(10 * 1024 * 1024));

// ─── Body Parsers ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Static Files ─────────────────────────────────────────────────────────
// Use the same public directory as the upload handler (../public) so uploaded
// assets like the logo are actually served in production builds.
const publicDir = path.resolve(__dirname, '..', 'public');
app.use(express.static(publicDir));

// ─── Sessions ─────────────────────────────────────────────────────────────
app.use(session(security.sessionConfig));

// ─── CORS for API routes ───────────────────────────────────────────────────
const devOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
];

const prodOrigins = [
  'https://micaco.site',
  'https://www.micaco.site',
];

const normalizeOrigin = (value: string): string => {
  const normalized = value.trim().toLowerCase().replace(/\/+$/, '');
  return normalized;
};

const allowedOrigins = Array.from(
  new Set([
    ...devOrigins,
    ...prodOrigins,
    ...(FRONTEND_URL ? [FRONTEND_URL] : []),
    ...(API_ORIGIN ? [API_ORIGIN] : []),
    ...extraCorsOrigins,
  ].map(normalizeOrigin))
);

app.use(
  '/api',
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(normalizeOrigin(origin))) return callback(null, true);
      console.warn(`[cors] Blocked origin: ${origin}`);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

// ─── Routes ───────────────────────────────────────────────────────────────
app.use('/api', apiRouter);
app.use('/', router);

export default app;

if (!process.env.ELECTRON) {
  app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
    if (FRONTEND_URL) console.log(`Allowed frontend: ${FRONTEND_URL}`);
    if (API_ORIGIN) console.log(`API origin (CSP/CORS): ${API_ORIGIN}`);
  });
}
