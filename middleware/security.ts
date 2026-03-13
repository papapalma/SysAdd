import { Request, Response, NextFunction } from 'express';
import type { SessionOptions } from 'express-session';
import { parse as parseUrl } from 'url';
import path from 'path';

const parseBool = (value: string | undefined, fallback: boolean = false) => {
  if (value === undefined) return fallback;
  return ['true', '1', 'yes'].includes(String(value).toLowerCase());
};

// ─── Types ─────────────────────────────────────────────────────────────────
interface RateLimitRecord {
  count: number;
  resetTime: number;
}

// ─── SSRF Protection ───────────────────────────────────────────────────────
const INTERNAL_IP_RANGES = [
  'localhost',
  '::1',
  'fd00',
];

export function isSafeUrl(url: string): boolean {
  try {
    const parsed = parseUrl(url);
    if (!parsed.hostname) return false;
    const hostname = parsed.hostname.toLowerCase();

    if (
      hostname === 'localhost' ||
      hostname === '::1' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('172.16.') ||
      hostname.startsWith('fd')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Directory Traversal Protection ───────────────────────────────────────
export function sanitizeFilePath(userInput: string, baseDir: string): string {
  const basename = path.basename(userInput);
  const safePath = path.resolve(baseDir, basename);

  if (!safePath.startsWith(baseDir)) {
    throw new Error('Invalid file path: Directory traversal detected');
  }
  if (basename.includes('..') || basename.includes('/') || basename.includes('\\')) {
    throw new Error('Invalid file path: Suspicious characters detected');
  }
  return safePath;
}

// ─── Filename Validation ───────────────────────────────────────────────────
export function isValidFilename(filename: string): boolean {
  const dangerousPatterns = [
    /\.\./,
    /[\/\\]/,
    /^\.+$/,
    /\x00/,
    /<script/i,
    /\.php$/i,
    /\.exe$/i,
    /\.bat$/i,
    /\.sh$/i,
  ];
  return !dangerousPatterns.some((p) => p.test(filename));
}

// ─── Security Headers Middleware ───────────────────────────────────────────
export function securityHeadersMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob: http://127.0.0.1:3000; " +
      "font-src 'self' data:; " +
      "connect-src 'self' http://127.0.0.1:3000; " +
      "frame-ancestors 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self'"
  );
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=(), usb=()'
  );
  res.removeHeader('X-Powered-By');
  next();
}

// ─── Input Sanitization ────────────────────────────────────────────────────
export function sanitizeHtmlInput(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// ─── Rate Limiter Middleware ───────────────────────────────────────────────
const rateLimitStore = new Map<string, RateLimitRecord>();

export function rateLimiter(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    let record = rateLimitStore.get(ip);

    if (record && now > record.resetTime) {
      rateLimitStore.delete(ip);
      record = undefined;
    }

    if (!record) {
      rateLimitStore.set(ip, { count: 1, resetTime: now + windowMs });
      return next();
    }

    if (record.count >= maxRequests) {
      res.status(429).json({
        error: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((record.resetTime - now) / 1000),
      });
      return;
    }

    record.count++;
    next();
  };
}

// ─── Session Config ────────────────────────────────────────────────────────
const sessionSecret = process.env.SESSION_SECRET || 'dev-session-secret';
const cookieSecure = parseBool(process.env.SESSION_COOKIE_SECURE, process.env.NODE_ENV === 'production');

export const sessionConfig: SessionOptions = {
  secret: sessionSecret,
  name: 'micaco.sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'strict' as const,
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
  },
  rolling: true,
};

// ─── Session Rotation ─────────────────────────────────────────────────────
export function rotateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!req.session) return resolve();
    const oldData = { ...req.session };
    req.session.regenerate((err) => {
      if (err) return reject(err);
      Object.assign(req.session, oldData);
      resolve();
    });
  });
}

// ─── Request Size Limit ────────────────────────────────────────────────────
export function requestSizeLimit(maxSizeBytes: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(
      req.headers['content-length'] || '0',
      10
    );
    if (contentLength > maxSizeBytes) {
      res.status(413).json({ error: 'Request body too large' });
      return;
    }
    next();
  };
}

// ─── Prevent HTTP Parameter Pollution ─────────────────────────────────────
export function preventParameterPollution(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  for (const key in req.query) {
    if (Array.isArray(req.query[key])) {
      (req.query as Record<string, unknown>)[key] = (req.query[key] as string[])[0];
    }
  }
  for (const key in req.body) {
    if (Array.isArray(req.body[key]) && typeof req.body[key][0] === 'string') {
      req.body[key] = req.body[key][0];
    }
  }
  next();
}

// ─── File Upload Validation ────────────────────────────────────────────────
export function validateFileUpload(file: Express.Multer.File): {
  valid: boolean;
  error?: string;
} {
  if (!isValidFilename(file.originalname)) {
    return { valid: false, error: 'Invalid filename' };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { valid: false, error: 'File too large (max 10MB)' };
  }
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
  ];
  if (!allowedTypes.includes(file.mimetype)) {
    return { valid: false, error: 'File type not allowed' };
  }
  return { valid: true };
}

export default {
  isSafeUrl,
  sanitizeFilePath,
  isValidFilename,
  securityHeadersMiddleware,
  sanitizeHtmlInput,
  rateLimiter,
  sessionConfig,
  rotateSession,
  requestSizeLimit,
  preventParameterPollution,
  validateFileUpload,
};
