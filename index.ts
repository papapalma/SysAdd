import 'dotenv/config';
import express from 'express';
import fs from 'fs';
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
const MAX_REQUEST_SIZE_MB = Math.max(1, Number(process.env.MAX_REQUEST_SIZE_MB) || 25);
const MAX_REQUEST_SIZE_BYTES = MAX_REQUEST_SIZE_MB * 1024 * 1024;
const extraCorsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production');
}

// Trust proxy for correct secure cookies and protocol detection behind Hostinger proxy
app.set('trust proxy', 1);

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

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(normalizeOrigin(origin))) return callback(null, true);
    console.warn(`[cors] Blocked origin: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
};

// Apply CORS before body-size checks so 4xx responses still include CORS headers.
app.use('/api', cors(corsOptions));
app.options('/api/*', cors(corsOptions));

// ─── Security Middleware (applied first for all non-CORS concerns) ───────
app.disable('x-powered-by');
app.use(security.securityHeadersMiddleware);
app.use(security.preventParameterPollution);
app.use(security.requestSizeLimit(MAX_REQUEST_SIZE_BYTES));

// ─── Body Parsers ──────────────────────────────────────────────────────────
app.use(express.json({ limit: `${MAX_REQUEST_SIZE_MB}mb` }));
app.use(express.urlencoded({ extended: true, limit: `${MAX_REQUEST_SIZE_MB}mb` }));

// ─── Static Files ─────────────────────────────────────────────────────────
// Resolve backend public dir across tsx/dev and dist/prod layouts.
const publicDirCandidates = [
  path.resolve(process.cwd(), 'public'),
  path.resolve(__dirname, '..', 'public'),
  path.resolve(__dirname, 'public'),
];
const publicDir = publicDirCandidates.find((dir) => fs.existsSync(dir)) || publicDirCandidates[0];
const configuredUploadDir = (process.env.UPLOAD_DIR || '').trim();
const uploadDir = configuredUploadDir
  ? path.resolve(configuredUploadDir)
  : path.resolve(process.cwd(), 'public', 'uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadDir));

// ─── Sessions ─────────────────────────────────────────────────────────────
app.use(session(security.sessionConfig));

// ─── Routes ───────────────────────────────────────────────────────────────
app.use('/api', apiRouter);
app.use('/', router);

export default app;

if (!process.env.ELECTRON) {
  app.listen(PORT, HOST, () => {
  });
}
