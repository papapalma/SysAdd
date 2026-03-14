import { Router, Request, Response } from 'express';
import type { Express } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { Op, DataTypes } from 'sequelize';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { User, sequelize } from '../models/userModel.js';
import Project from '../models/Project.js';
import Milestone from '../models/Milestone.js';
import Report from '../models/Report.js';
import Content from '../models/Content.js';
import Log from '../models/Log.js';
import Faq from '../models/Faq.js';
import Settings from '../models/Settings.js';
import Announcement from '../models/Announcement.js';
import LoginAttempt from '../models/LoginAttempt.js';
import CapitalShareTransaction from '../models/CapitalShareTransaction.js';
import * as securityService from '../services/securityService.js';
import security from '../middleware/security.js';
import { validatePasswordStrength, calculatePasswordStrength, getPasswordStrengthLabel } from '../utils/passwordValidator.js';

const router = Router();

const backendPublicDir = path.resolve(__dirname, '..', 'public');

async function ensureRequiredSchema(): Promise<void> {
  try {
    // Keep sync non-destructive: create missing tables only.
    await sequelize.sync();

    const qi = sequelize.getQueryInterface();

    const usersTable = await qi.describeTable('Users');
    if (!usersTable.googleVerified) {
      await qi.addColumn('Users', 'googleVerified', {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
      console.log('[schema] Added Users.googleVerified');
    }
    const userIndexes: any[] = (await qi.showIndex('Users')) as any[];
    const hasEmailUnique = userIndexes.some((idx: any) =>
      idx.unique && Array.isArray(idx.fields) && idx.fields.some((f: any) => f.attribute === 'email')
    );
    if (!hasEmailUnique) {
      await qi.addIndex('Users', ['email'], { unique: true, name: 'users_email_unique' });
      console.log('[schema] Added unique index Users.email');
    }

    const reportsTable = await qi.describeTable('Reports');
    if (!reportsTable.submittedBy) {
      await qi.addColumn('Reports', 'submittedBy', {
        type: DataTypes.INTEGER,
        allowNull: true,
      });
      console.log('[schema] Added Reports.submittedBy');
    }
    if (!reportsTable.confirmedBy) {
      await qi.addColumn('Reports', 'confirmedBy', {
        type: DataTypes.INTEGER,
        allowNull: true,
      });
      console.log('[schema] Added Reports.confirmedBy');
    }
    if (!reportsTable.confirmedAt) {
      await qi.addColumn('Reports', 'confirmedAt', {
        type: DataTypes.DATE,
        allowNull: true,
      });
      console.log('[schema] Added Reports.confirmedAt');
    }
    if (!reportsTable.confirmationNote) {
      await qi.addColumn('Reports', 'confirmationNote', {
        type: DataTypes.TEXT,
        allowNull: true,
      });
      console.log('[schema] Added Reports.confirmationNote');
    }
  } catch (err) {
    console.error('Schema bootstrap error:', err);
  }
}

// Schema sync disabled in production (tables are pre-created)
// ensureRequiredSchema().catch((err) => console.error('Schema bootstrap error:', err));

// ─── Request Logger ────────────────────────────────────────────────────────
router.use((req: Request, _res: Response, next) => {
  try {
    const body =
      req.body && Object.keys(req.body).length
        ? ` body=${JSON.stringify(req.body)}`
        : '';
    console.log(`[api] ${req.method} ${req.originalUrl}${body}`);
  } catch {
    console.log('[api] request received');
  }
  next();
});

// ─── File Upload Setup ────────────────────────────────────────────────────
const uploadDir = path.join(backendPublicDir, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (!security.isValidFilename(file.originalname)) {
    return cb(new Error('Invalid filename'));
  }
  const allowed = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'video/mp4',
    'video/webm',
    'video/ogg',
  ];
  if (!allowed.includes(file.mimetype)) {
    return cb(new Error('File type not allowed'));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
});

// ─── Image Resize Helper ──────────────────────────────────────────────────
async function resizeImage(
  filePath: string,
  height: number = 320
): Promise<void> {
  const tempPath = filePath + '.tmp';
  try {
    fs.renameSync(filePath, tempPath);
    await sharp(tempPath)
      .resize({ height, fit: 'cover', position: 'center' })
      .jpeg({ quality: 90 })
      .toFile(filePath);
    fs.unlinkSync(tempPath);
  } catch (err) {
    console.error('Image resize error:', err);
    // Restore original if resize fails
    if (fs.existsSync(tempPath) && !fs.existsSync(filePath)) {
      fs.renameSync(tempPath, filePath);
    }
  }
}

// ─── Google OAuth Setup ───────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

passport.serializeUser((user: any, done) => done(null, user));
passport.deserializeUser((user: any, done) => done(null, user));

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy(
    { clientID: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, callbackURL: GOOGLE_CALLBACK_URL },
    (_accessToken: string, _refreshToken: string, profile: any, done: Function) => done(null, profile)
  ));
} else {
  console.warn('[OAuth] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set. Google OAuth is disabled.');
}

router.use(passport.initialize());
router.use(passport.session());

// ─── Health Check ─────────────────────────────────────────────────────────
router.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

type SessionAuthUser = {
  id: number;
  role: string;
  email: string;
  name: string;
  status: string;
};

const getSessionAuthUser = (req: Request): SessionAuthUser | null => {
  return ((req.session as any)?.authUser || null) as SessionAuthUser | null;
};

const requireAuth = (req: Request, res: Response, next: Function) => {
  if (!getSessionAuthUser(req)) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

const requireRoles = (...roles: string[]) => {
  return (req: Request, res: Response, next: Function) => {
    const actor = getSessionAuthUser(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required' });
    const actorRole = String(actor.role || '').toUpperCase();
    const allowedRoles = roles.map((r) => String(r).toUpperCase());
    if (!allowedRoles.includes(actorRole)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
};

const requireSelfOrRoles = (...roles: string[]) => {
  return (req: Request, res: Response, next: Function) => {
    const actor = getSessionAuthUser(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required' });
    if (String(actor.id) === String(req.params.id)) return next();
    if (roles.includes(actor.role)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  };
};

router.get('/auth/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const actor = getSessionAuthUser(req)!;
    const user: any = await User.findByPk(actor.id, {
      attributes: ['id', 'name', 'email', 'role', 'status', 'profilePic', 'joinedDate', 'capitalShare', 'googleVerified'],
    });
    if (!user) {
      (req.session as any).authUser = null;
      return res.status(401).json({ error: 'Session user not found' });
    }
    res.json(user);
  } catch (err) {
    console.error('Auth me error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Google OAuth: Initiate ───────────────────────────────────────────────
router.get('/auth/google', (req: Request, res: Response, next) => {
  const { email } = req.query;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email query param required' });
  }
  // Reset any prior Google verification state before starting a new flow
  (req.session as any).googleVerifiedEmail = null;
  (req.session as any).pendingEmail = null;
  // Store pending email for verification
  (req.session as any).pendingEmail = email.toLowerCase().trim();
  passport.authenticate('google', { scope: ['email', 'profile'], prompt: 'select_account' })(req, res, next);
});

// ─── Google OAuth: Callback ───────────────────────────────────────────────
router.get(
  '/auth/google/callback',
  (req: Request, res: Response, next) => {
    if (!GOOGLE_CLIENT_ID) {
      return res.redirect(`${FRONTEND_URL}/?register=true&error=oauth_disabled`);
    }
    // Clear any stale verification state before handling callback
    (req.session as any).googleVerifiedEmail = null;
    (req.session as any).pendingEmail = null;
    passport.authenticate('google', { session: false, failureRedirect: `${FRONTEND_URL}/?register=true&error=google_failed` })(req, res, next);
  },
  async (req: Request, res: Response) => {
    try {
      const googleUser = (req as any).user;
      const googleEmail: string = (googleUser?.emails?.[0]?.value || '').toLowerCase().trim();

      if (!googleEmail) {
        return res.redirect(`${FRONTEND_URL}/?register=true&error=no_email`);
      }
      const existing = await User.findOne({ where: { email: googleEmail } });
      if (existing) {
        return res.redirect(`${FRONTEND_URL}/?register=true&error=already_registered`);
      }
      (req.session as any).googleVerifiedEmail = googleEmail;
      delete (req.session as any).pendingEmail;
      return res.redirect(`${FRONTEND_URL}/?register=true&google_verified=true&email=${encodeURIComponent(googleEmail)}`);
    } catch (err) {
      console.error('Google OAuth callback error', err);
      (req.session as any).googleVerifiedEmail = null;
      (req.session as any).pendingEmail = null;
      return res.redirect(`${FRONTEND_URL}/?register=true&error=server_error`);
    }
  }
);

// ─── Google OAuth: Check Verified Session ────────────────────────────────
router.get('/auth/google/status', (req: Request, res: Response) => {
  const verified = (req.session as any).googleVerifiedEmail || null;
  res.json({ verifiedEmail: verified });
});

// ─── Auth: Logout ──────────────────────────────────────────────────────────
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const actor = getSessionAuthUser(req);
    const { userId, email, name } = req.body || {};
    try {
      await Log.create({
        level: 'info',
        message: 'User logout',
        meta: JSON.stringify({
          userId: actor?.id || userId,
          email: actor?.email || email,
          name: actor?.name || name,
          ip: req.ip,
          ua: req.headers['user-agent'],
        }),
      });
    } catch {}
    if (req.session) {
      req.session.destroy(() => {});
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Auth: Login ───────────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password, challengeAnswer } = req.body;
    const ipAddress: string = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent: string = req.headers['user-agent'] || '';

    // Rate limit check
    const rateLimited = await securityService.isRateLimited(ipAddress);
    if (rateLimited) {
      await securityService.logLoginAttempt({
        email: email || 'unknown',
        ipAddress,
        userAgent,
        success: false,
        failureReason: 'Rate limited',
      });
      return res.status(429).json({
        error: 'Too many login attempts from this IP address. Please try again later.',
        rateLimited: true,
      });
    }

    // Account lock check
    const lockStatus = await securityService.isAccountLocked(email);
    if (lockStatus.locked) {
      await securityService.logLoginAttempt({
        email,
        ipAddress,
        userAgent,
        success: false,
        failureReason: 'Account locked',
      });
      return res.status(423).json({
        error: `Account temporarily locked. Please try again in ${lockStatus.minutesRemaining} minutes.`,
        accountLocked: true,
        minutesRemaining: lockStatus.minutesRemaining,
      });
    }

    // Security challenge check
    const needsChallenge = await securityService.shouldShowChallenge(
      email,
      ipAddress
    );
    if (needsChallenge && challengeAnswer !== undefined) {
      const expected = (req.session as any).loginChallengeAnswer;
      const challengeValid = securityService.validateChallenge(
        challengeAnswer,
        expected
      );
      delete (req.session as any).loginChallengeAnswer;
      if (!challengeValid) {
        await securityService.logLoginAttempt({
          email,
          ipAddress,
          userAgent,
          success: false,
          failureReason: 'Challenge failed',
        });
        return res.status(401).json({
          error: 'Security challenge failed. Please try again.',
          challengeFailed: true,
        });
      }
    } else if (needsChallenge) {
      const challenge = securityService.generateChallenge();
      (req.session as any).loginChallengeAnswer = challenge.answer;
      return res.status(403).json({
        challengeRequired: true,
        challenge: challenge.question,
      });
    }

    // Validate credentials
    const user: any = await User.findOne({ where: { email } });
    if (!user) {
      await securityService.logLoginAttempt({
        email,
        ipAddress,
        userAgent,
        success: false,
        failureReason: 'User not found',
      });
      return res.status(404).json({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await securityService.logLoginAttempt({
        email,
        ipAddress,
        userAgent,
        success: false,
        failureReason: 'Incorrect password',
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status === 'Pending') {
      await securityService.logLoginAttempt({
        email,
        ipAddress,
        userAgent,
        success: false,
        failureReason: 'Account pending',
      });
      return res.status(403).json({
        error: 'Account pending approval',
        statusPending: true,
      });
    }

    if (user.status === 'Inactive') {
      await securityService.logLoginAttempt({
        email,
        ipAddress,
        userAgent,
        success: false,
        failureReason: 'Account inactive',
      });
      return res.status(403).json({
        error: 'Account inactive',
        statusInactive: true,
      });
    }

    // Successful login
    await securityService.logLoginAttempt({
      email,
      ipAddress,
      userAgent,
      success: true,
      failureReason: null,
    });
    await securityService.updateLastLogin(user.id, ipAddress, userAgent);
    const suspicious = await securityService.isSuspiciousIP(ipAddress);

    const { id, name, role, status, profilePic, joinedDate, capitalShare, lastLogin } = user;
    const normalizedRole = String(role || '').toUpperCase();
    (req.session as any).authUser = {
      id,
      role: normalizedRole,
      email: user.email,
      name,
      status,
    };
    try {
      await Log.create({
        level: 'info',
        message: 'Login successful',
        meta: JSON.stringify({
          userId: id,
          email,
          role,
          ipAddress,
          suspicious: suspicious ? 'yes' : 'no',
        }),
      });
    } catch {}

    await new Promise<void>((resolve) => {
      req.session.save(() => resolve());
    });
    return res.json({
      id,
      name,
      email: user.email,
      role: normalizedRole,
      status,
      profilePic,
      joinedDate,
      capitalShare,
      lastLogin,
      securityAlert: suspicious
        ? 'Login from a previously flagged IP address'
        : null,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Auth: Register ────────────────────────────────────────────────────────
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, email, password } = req.body;

    const normalizedEmail = String(email || '').toLowerCase().trim();
    const sessionVerified = String((req.session as any).googleVerifiedEmail || '').toLowerCase().trim();
    const isGoogleVerified = !!normalizedEmail && sessionVerified === normalizedEmail;

    if (!isGoogleVerified) {
      return res.status(400).json({
        error: 'Email verification is required before registration',
        code: 'EMAIL_VERIFICATION_REQUIRED',
      });
    }

    const existing = await User.findOne({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);
    if (isGoogleVerified) delete (req.session as any).googleVerifiedEmail;
    const user: any = await User.create({ name, email, password: hashed, googleVerified: isGoogleVerified });
    try {
      await Log.create({
        level: 'info',
        message: 'User registered',
        meta: JSON.stringify({ userId: user.id, email }),
      });
    } catch {}
    const { id, role, status, profilePic, joinedDate, capitalShare } = user;
    return res.status(201).json({
      id,
      name: user.name,
      email: user.email,
      role,
      status,
      profilePic,
      joinedDate,
      capitalShare,
      googleVerified: user.googleVerified,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Validate Password ─────────────────────────────────────────────────────
router.post('/validate-password', (req: Request, res: Response) => {
  try {
    const password = String(req.body?.password || '');
    const result = validatePasswordStrength(password);
    const score = calculatePasswordStrength(password);
    const label = getPasswordStrengthLabel(score);
    return res.json({
      valid: result.valid,
      errors: result.errors,
      strength: {
        score,
        label: label.label,
        color: label.color,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Check Login Security Status ───────────────────────────────────────────
router.post('/check-login-security', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    const ipAddress: string = req.ip || req.connection.remoteAddress || 'unknown';
    const [rateLimited, lockStatus, needsChallenge, suspicious] =
      await Promise.all([
        securityService.isRateLimited(ipAddress),
        securityService.isAccountLocked(email),
        securityService.shouldShowChallenge(email, ipAddress),
        securityService.isSuspiciousIP(ipAddress),
      ]);
    return res.json({
      rateLimited,
      accountLocked: lockStatus.locked,
      minutesRemaining: lockStatus.minutesRemaining || 0,
      challengeRequired: needsChallenge,
      suspiciousIP: suspicious,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Users ─────────────────────────────────────────────────────────────────
const USER_ATTRS = [
  'id', 'name', 'email', 'role', 'status', 'profilePic', 'joinedDate', 'capitalShare',
] as const;
const ALLOWED_ROLES = ['MEMBER', 'ADMIN', 'SECRETARY', 'TREASURER'] as const;

router.get('/users', requireRoles('ADMIN', 'SECRETARY', 'TREASURER'), async (req: Request, res: Response) => {
  try {
    const { search, role, status, page, limit } = req.query;
    const where: any = {};
    if (search) {
      where[Op.or as any] = [
        { name: { [Op.like as any]: `%${search}%` } },
        { email: { [Op.like as any]: `%${search}%` } },
      ];
    }
    if (role) where.role = role;
    if (status) where.status = status;
    const pageNum = parseInt(page as string) || 0;
    const limitNum = parseInt(limit as string) || 0;
    if (pageNum && limitNum) {
      const { count: total, rows } = await (User as any).findAndCountAll({
        where, attributes: [...USER_ATTRS], offset: (pageNum - 1) * limitNum, limit: limitNum,
      });
      return res.json({ items: rows, total, page: pageNum, totalPages: Math.ceil(total / limitNum) });
    }
    const users = await User.findAll({ where, attributes: [...USER_ATTRS] });
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/users/:id', requireSelfOrRoles('ADMIN', 'SECRETARY', 'TREASURER'), async (req: Request, res: Response) => {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: [...USER_ATTRS],
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/users/:id', requireSelfOrRoles('ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const actor = getSessionAuthUser(req);
    const payload = { ...(req.body || {}) };
    if (actor?.role !== 'ADMIN') {
      delete (payload as any).role;
      delete (payload as any).status;
      delete (payload as any).capitalShare;
    }
    if ((payload as any)?.role && !ALLOWED_ROLES.includes((payload as any).role)) {
      return res.status(400).json({ error: 'Invalid role. Allowed roles: MEMBER, ADMIN, SECRETARY, TREASURER' });
    }
    await User.update(payload, { where: { id } });
    const user = await User.findByPk(id, {
      attributes: ['id', 'name', 'email', 'role', 'status', 'capitalShare', 'profilePic', 'joinedDate'],
    });
    try {
      await Log.create({
        level: 'info',
        message: 'User updated',
        meta: JSON.stringify({ userId: id, updates: req.body }),
      });
    } catch {}
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/users/:id/status', requireRoles('ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    await User.update({ status }, { where: { id } });
    try {
      await Log.create({
        level: 'info',
        message: 'User status changed',
        meta: JSON.stringify({ userId: id, status }),
      });
    } catch {}
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/users/:id/role', requireRoles('ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    if (!role) return res.status(400).json({ error: 'Role is required' });
    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Allowed roles: MEMBER, ADMIN, SECRETARY, TREASURER' });
    }
    await User.update({ role }, { where: { id } });
    const user = await User.findByPk(id, {
      attributes: ['id', 'name', 'email', 'role'],
    });
    try {
      await Log.create({
        level: 'info',
        message: 'User role changed',
        meta: JSON.stringify({ userId: id, role }),
      });
    } catch {}
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/users/:id', requireRoles('ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await User.destroy({ where: { id } });
    try {
      await Log.create({
        level: 'warning',
        message: 'User deleted',
        meta: JSON.stringify({ userId: id }),
      });
    } catch {}
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post(
  '/users/:id/upload-profile',
  requireSelfOrRoles('ADMIN'),
  upload.single('profilePic'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      await resizeImage(req.file.path);
      const url = `/uploads/${req.file.filename}`;
      await User.update({ profilePic: url }, { where: { id } });
      try {
        await Log.create({
          level: 'info',
          message: 'Profile photo uploaded',
          meta: JSON.stringify({ userId: id, url, filename: req.file.originalname }),
        });
      } catch {}
      res.json({ url });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ─── Projects ──────────────────────────────────────────────────────────────
router.get('/projects', async (req: Request, res: Response) => {
  try {
    const { search, category, status, page, limit } = req.query;
    const where: any = {};
    if (search) {
      where[Op.or as any] = [
        { title: { [Op.like as any]: `%${search}%` } },
        { description: { [Op.like as any]: `%${search}%` } },
      ];
    }
    if (category) where.category = category;
    if (status) where.status = status;
    const pageNum = parseInt(page as string) || 0;
    const limitNum = parseInt(limit as string) || 0;
    const findOptions: any = {
      where,
      include: [
        {
          model: Milestone,
          as: 'milestones',
          attributes: ['id', 'date', 'description', 'createdAt'],
          separate: true,
          order: [['date', 'ASC']],
        },
      ],
    };
    if (pageNum && limitNum) {
      findOptions.offset = (pageNum - 1) * limitNum;
      findOptions.limit = limitNum;
      const { count: total, rows } = await (Project as any).findAndCountAll(findOptions);
      const projects = rows.map((p: any) => {
        const data = p.toJSON();
        data.progressProof = data.progressProof ? (() => { try { return JSON.parse(data.progressProof); } catch { return []; } })() : [];
        data.reportMilestones = data.milestones || [];
        delete data.milestones;
        return data;
      });
      return res.json({ items: projects, total, page: pageNum, totalPages: Math.ceil(total / limitNum) });
    }
    const rows = await Project.findAll(findOptions);
    const projects = rows.map((p: any) => {
      const data = p.toJSON();
      data.progressProof = data.progressProof ? (() => { try { return JSON.parse(data.progressProof); } catch { return []; } })() : [];
      data.reportMilestones = data.milestones || [];
      delete data.milestones;
      return data;
    });
    res.json(projects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/projects', requireRoles('ADMIN', 'SECRETARY'), upload.none(), async (req: Request, res: Response) => {
  try {
    const { title, description, category, timelineStart, timelineEnd, reportMilestones } =
      req.body;
    const project: any = await Project.create({
      title,
      description,
      category,
      timelineStart: timelineStart || null,
      timelineEnd: timelineEnd || null,
    });

    if (reportMilestones) {
      let milestones: any;
      try {
        milestones = typeof reportMilestones === 'string' ? JSON.parse(reportMilestones) : reportMilestones;
      } catch {
        return res.status(400).json({ error: 'Invalid reportMilestones JSON format' });
      }
      if (Array.isArray(milestones)) {
        for (const m of milestones) {
          if (m.date) {
            await Milestone.create({
              projectId: project.id,
              date: m.date,
              description: m.description || '',
            });
          }
        }
      }
    }

    const result: any = (
      await Project.findByPk(project.id, {
        include: [{ model: Milestone, as: 'milestones', attributes: ['id', 'date', 'description'] }],
      })
    ).toJSON();
    result.reportMilestones = result.milestones || [];
    delete result.milestones;

    try {
      await Log.create({
        level: 'info',
        message: 'Project created',
        meta: JSON.stringify({ projectId: project.id, title, category }),
      });
    } catch {}
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/projects/:id', requireRoles('ADMIN', 'SECRETARY'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, description, category, status, timelineStart, timelineEnd, reportMilestones } =
      req.body;
    const project: any = await Project.findByPk(id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (title !== undefined) project.title = title;
    if (description !== undefined) project.description = description;
    if (category !== undefined) project.category = category;
    if (status !== undefined) project.status = status;
    if (timelineStart !== undefined) project.timelineStart = timelineStart || null;
    if (timelineEnd !== undefined) project.timelineEnd = timelineEnd || null;
    await project.save();

    if (reportMilestones !== undefined) {
      let milestones: any;
      try {
        milestones = Array.isArray(reportMilestones)
          ? reportMilestones
          : JSON.parse(reportMilestones || '[]');
      } catch {
        return res.status(400).json({ error: 'Invalid reportMilestones JSON format' });
      }
      await Milestone.destroy({ where: { projectId: id } });
      for (const m of milestones) {
        if (m.date) {
          await Milestone.create({
            projectId: id,
            date: m.date,
            description: m.description || '',
          });
        }
      }
    }

    const updated: any = (
      await Project.findByPk(id, {
        include: [{ model: Milestone, as: 'milestones', attributes: ['id', 'date', 'description'] }],
      })
    ).toJSON();
    updated.reportMilestones = updated.milestones || [];
    delete updated.milestones;

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/projects/:id', requireRoles('ADMIN', 'SECRETARY'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const project: any = await Project.findByPk(id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    await project.destroy();
    try {
      await Log.create({
        level: 'info',
        message: 'Project deleted',
        meta: JSON.stringify({ projectId: id, title: project.title }),
      });
    } catch {}
    res.json({ message: 'Project deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Reports ───────────────────────────────────────────────────────────────
const reportUpload = upload.fields([
  { name: 'reportImage', maxCount: 1 },
  { name: 'additionalImages', maxCount: 10 },
  { name: 'videos', maxCount: 5 },
]);

router.get('/reports', async (req: Request, res: Response) => {
  try {
    const { search, type, status, approvalStatus, projectId, from, to, page, limit } = req.query;
    const where: any = {};
    if (search) {
      where[Op.or as any] = [
        { title: { [Op.like as any]: `%${search}%` } },
        { description: { [Op.like as any]: `%${search}%` } },
        { tags: { [Op.like as any]: `%${search}%` } },
      ];
    }
    if (type) where.reportType = type;
    if (status) where.status = status;
    if (approvalStatus) where.approvalStatus = approvalStatus;
    if (projectId) where.projectId = projectId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt[Op.gte as any] = new Date(from as string);
      if (to) where.createdAt[Op.lte as any] = new Date(to as string);
    }
    const include = [
      { model: Project, attributes: ['id', 'title'] },
      { model: User, attributes: ['id', 'name', 'role'], as: undefined },
    ];
    const pageNum = parseInt(page as string) || 0;
    const limitNum = parseInt(limit as string) || 0;
    if (pageNum && limitNum) {
      const offset = (pageNum - 1) * limitNum;
      const { count: total, rows } = await (Report as any).findAndCountAll({
        where, include, order: [['createdAt', 'DESC']], offset, limit: limitNum,
      });
      return res.json({ items: rows, total, page: pageNum, totalPages: Math.ceil(total / limitNum) });
    }
    const reports = await Report.findAll({
      where,
      include: [
        { model: Project, attributes: ['id', 'title'] },
        { model: User, attributes: ['id', 'name', 'role'] },
      ],
      order: [['createdAt', 'DESC']],
    });
    res.json(reports);
  } catch (err) {
    console.error('Reports GET error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Report Analytics ─────────────────────────────────────────────────────
router.get('/reports/analytics', async (_req: Request, res: Response) => {
  try {
    const [total, byType, byApprovalStatus, byPriority, allReports] = await Promise.all([
      Report.count(),
      sequelize.query(
        `SELECT reportType as type, COUNT(*) as count FROM Reports WHERE reportType IS NOT NULL GROUP BY reportType`,
        { type: (sequelize as any).QueryTypes?.SELECT || 'SELECT' }
      ),
      sequelize.query(
        `SELECT approvalStatus as status, COUNT(*) as count FROM Reports WHERE approvalStatus IS NOT NULL GROUP BY approvalStatus`,
        { type: (sequelize as any).QueryTypes?.SELECT || 'SELECT' }
      ),
      sequelize.query(
        `SELECT priority, COUNT(*) as count FROM Reports WHERE priority IS NOT NULL GROUP BY priority`,
        { type: (sequelize as any).QueryTypes?.SELECT || 'SELECT' }
      ),
      Report.findAll({
        attributes: ['createdAt', 'progressPercentage', 'budgetAllocated', 'budgetUsed', 'reportType', 'projectId'],
        include: [{ model: Project, attributes: ['title'] }],
        order: [['createdAt', 'ASC']],
      }),
    ]);

    // Reports by month
    const monthMap: Record<string, number> = {};
    (allReports as any[]).forEach((r: any) => {
      const d = new Date(r.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthMap[key] = (monthMap[key] || 0) + 1;
    });
    const byMonth = Object.entries(monthMap).map(([month, count]) => ({ month, count }));

    // Budget summary (Financial reports only)
    const financial = (allReports as any[]).filter((r: any) => r.reportType === 'Financial');
    const budgetSummary = {
      totalAllocated: financial.reduce((sum: number, r: any) => sum + parseFloat(r.budgetAllocated || 0), 0),
      totalUsed: financial.reduce((sum: number, r: any) => sum + parseFloat(r.budgetUsed || 0), 0),
    };

    // Avg progress per project
    const projectProgress: Record<string, { title: string; total: number; count: number }> = {};
    (allReports as any[]).forEach((r: any) => {
      const pid = String(r.projectId);
      if (!projectProgress[pid]) projectProgress[pid] = { title: (r as any).Project?.title || pid, total: 0, count: 0 };
      projectProgress[pid].total += parseFloat(r.progressPercentage || 0);
      projectProgress[pid].count += 1;
    });
    const avgProgressPerProject = Object.values(projectProgress).map((p) => ({
      projectTitle: p.title,
      avgProgress: p.count ? Math.round((p.total / p.count) * 100) / 100 : 0,
    }));

    // Top 5 projects by report count
    const projectCounts: Record<string, { title: string; count: number; projectId: string }> = {};
    (allReports as any[]).forEach((r: any) => {
      const pid = String(r.projectId);
      if (!projectCounts[pid]) projectCounts[pid] = { title: (r as any).Project?.title || pid, count: 0, projectId: pid };
      projectCounts[pid].count += 1;
    });
    const topProjectsByReports = Object.values(projectCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    res.json({ totalReports: total, byType, byApprovalStatus, byPriority, byMonth, budgetSummary, avgProgressPerProject, topProjectsByReports });
  } catch (err) {
    console.error('Report analytics error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/projects/:id/reports', async (req: Request, res: Response) => {
  try {
    const reports = await Report.findAll({
      where: { projectId: req.params.id },
      include: [{ model: User, attributes: ['id', 'name', 'role'] }],
      order: [['createdAt', 'DESC']],
    });
    res.json(reports);
  } catch (err) {
    console.error('Project reports GET error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post(
  '/projects/:id/reports',
  requireRoles('ADMIN', 'SECRETARY'),
  reportUpload,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const actor = getSessionAuthUser(req)!;
      const { title, description } = req.body;
      const files = req.files as Record<string, Express.Multer.File[]>;

      let imageUrl: string | null = null;
      if (files?.reportImage?.[0]) {
        const file = files.reportImage[0];
        await resizeImage(file.path);
        imageUrl = `/uploads/${file.filename}`;
      }

      let additionalImages: string | null = null;
      if (files?.additionalImages?.length) {
        const paths: string[] = [];
        for (const file of files.additionalImages) {
          await resizeImage(file.path);
          paths.push(`/uploads/${file.filename}`);
        }
        additionalImages = JSON.stringify(paths);
      }

      let videos: string | null = null;
      if (files?.videos?.length) {
        videos = JSON.stringify(files.videos.map((f) => `/uploads/${f.filename}`));
      }

      const project: any = await Project.findByPk(id);
      if (!project) return res.status(404).json({ error: 'Project not found' });

      const report: any = await Report.create({
        projectId: id,
        userId: actor.id,
        submittedBy: actor.id,
        approvalStatus: 'Pending',
        title,
        description,
        imageUrl,
        additionalImages,
        videos,
        milestoneId: req.body.milestoneId || null,
      });

      try {
        await Log.create({
          level: 'info',
          message: 'Report created',
          meta: JSON.stringify({ reportId: report.id, projectId: id, title }),
        });
      } catch {}
      res.status(201).json(report);
    } catch (err) {
      console.error('Report POST error', err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

router.put(
  '/reports/:id',
  requireRoles('ADMIN', 'SECRETARY'),
  reportUpload,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const report: any = await Report.findByPk(id);
      if (!report) return res.status(404).json({ error: 'Report not found' });
      const files = req.files as Record<string, Express.Multer.File[]>;

      // Scalar fields
      const scalars = [
        'title', 'description', 'reportType', 'status', 'projectId', 'milestoneId',
        'progressPercentage', 'reportPeriodStart', 'reportPeriodEnd',
        'budgetAllocated', 'budgetUsed', 'expenditureDetails',
        'achievements', 'milestonesReached', 'challenges', 'risksIdentified',
        'mitigationActions', 'nextSteps', 'recommendations',
        'location', 'teamMembers', 'beneficiaries', 'tags', 'priority', 'isPublic',
      ] as const;
      for (const key of scalars) {
        if (req.body[key] !== undefined) (report as any)[key] = req.body[key];
      }

      if (files?.reportImage?.[0]) {
        const file = files.reportImage[0];
        await resizeImage(file.path);
        report.imageUrl = `/uploads/${file.filename}`;
      }

      if (files?.additionalImages?.length) {
        const paths: string[] = [];
        for (const file of files.additionalImages) {
          await resizeImage(file.path);
          paths.push(`/uploads/${file.filename}`);
        }
        let existing: string[] = [];
        if (report.additionalImages) {
          try {
            existing = JSON.parse(report.additionalImages);
          } catch {}
        }
        report.additionalImages = JSON.stringify([...existing, ...paths]);
      }

      if (files?.videos?.length) {
        const newPaths = files.videos.map((f) => `/uploads/${f.filename}`);
        let existing: string[] = [];
        if (report.videos) {
          try {
            existing = JSON.parse(report.videos);
          } catch {}
        }
        report.videos = JSON.stringify([...existing, ...newPaths]);
      }

      await report.save();
      try {
        await Log.create({
          level: 'info',
          message: 'Report updated',
          meta: JSON.stringify({ reportId: id, title: report.title }),
        });
      } catch {}
      res.json(report);
    } catch (err) {
      console.error('Report PUT error', err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

router.delete('/reports/:id', requireRoles('ADMIN', 'SECRETARY'), async (req: Request, res: Response) => {
  try {
    const deleted = await Report.destroy({ where: { id: req.params.id } });
    try {
      await Log.create({
        level: 'warning',
        message: 'Report deleted',
        meta: JSON.stringify({ reportId: req.params.id }),
      });
    } catch {}
    res.json({ ok: true, deleted });
  } catch (err) {
    console.error('Report DELETE error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Report: Confirm ──────────────────────────────────────────────────────
router.put('/reports/:id/confirm', requireRoles('ADMIN', 'SECRETARY'), async (req: Request, res: Response) => {
  try {
    const actor = getSessionAuthUser(req)!;
    const { note } = req.body;
    const confirmerId = actor.id;
    const report: any = await Report.findByPk(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (report.approvalStatus === 'Approved') return res.status(400).json({ error: 'Report already approved' });
    const confirmer: any = await User.findByPk(confirmerId, { attributes: ['id', 'role'] });
    if (!confirmer) return res.status(404).json({ error: 'Confirmer not found' });
    const submitter: any = await User.findByPk(report.submittedBy || report.userId, { attributes: ['id', 'role'] });
    if (submitter) {
      const sRole = String(submitter.role || '').toUpperCase();
      const cRole = String(confirmer.role || '').toUpperCase();
      const allowed =
        (sRole === 'ADMIN' && cRole === 'SECRETARY') ||
        (sRole === 'SECRETARY' && cRole === 'ADMIN');
      if (!allowed) {
        return res.status(403).json({ error: 'You are not authorized to confirm this report' });
      }
    }
    if (String(confirmerId) === String(report.submittedBy || report.userId)) {
      return res.status(403).json({ error: 'You cannot confirm your own report' });
    }
    report.approvalStatus = 'Approved';
    report.confirmedBy = confirmerId;
    report.confirmedAt = new Date();
    report.confirmationNote = note || null;
    await report.save();
    try {
      await Log.create({ level: 'info', message: 'Report confirmed', meta: JSON.stringify({ reportId: req.params.id, confirmerId }) });
    } catch {}
    res.json(report);
  } catch (err) {
    console.error('Report confirm error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Report: Reject ───────────────────────────────────────────────────────
router.put('/reports/:id/reject', requireRoles('ADMIN', 'SECRETARY'), async (req: Request, res: Response) => {
  try {
    const actor = getSessionAuthUser(req)!;
    const { note } = req.body;
    const confirmerId = actor.id;
    const report: any = await Report.findByPk(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const confirmer: any = await User.findByPk(confirmerId, { attributes: ['id', 'role'] });
    if (!confirmer) return res.status(404).json({ error: 'Confirmer not found' });
    const submitter: any = await User.findByPk(report.submittedBy || report.userId, { attributes: ['id', 'role'] });
    if (submitter) {
      const sRole = String(submitter.role || '').toUpperCase();
      const cRole = String(confirmer.role || '').toUpperCase();
      const allowed =
        (sRole === 'ADMIN' && cRole === 'SECRETARY') ||
        (sRole === 'SECRETARY' && cRole === 'ADMIN');
      if (!allowed) return res.status(403).json({ error: 'You are not authorized to reject this report' });
    }
    if (String(confirmerId) === String(report.submittedBy || report.userId)) {
      return res.status(403).json({ error: 'You cannot reject your own report' });
    }
    report.approvalStatus = 'Rejected';
    report.confirmedBy = confirmerId;
    report.confirmedAt = new Date();
    report.confirmationNote = note || null;
    await report.save();
    try {
      await Log.create({ level: 'warning', message: 'Report rejected', meta: JSON.stringify({ reportId: req.params.id, confirmerId, note }) });
    } catch {}
    res.json(report);
  } catch (err) {
    console.error('Report reject error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Logs ──────────────────────────────────────────────────────────────────
router.get('/logs', requireRoles('ADMIN'), async (req: Request, res: Response) => {
  try {
    const page = Math.max(parseInt(String(req.query.page)) || 1, 1);
    const limit = Math.max(parseInt(String(req.query.limit)) || 10, 1);
    const offset = (page - 1) * limit;
    const { search, level } = req.query;
    const where: any = {};
    if (level) where.level = level;
    if (search) {
      where[Op.or as any] = [
        { message: { [Op.like as any]: `%${search}%` } },
        { meta: { [Op.like as any]: `%${search}%` } },
      ];
    }
    const { count: total, rows } = await (Log as any).findAndCountAll({
      where, offset, limit, order: [['createdAt', 'DESC']],
    });
    res.json({ items: rows, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Logs GET error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── FAQs ──────────────────────────────────────────────────────────────────
router.get('/faqs', async (_req: Request, res: Response) => {
  try {
    const rows = await Faq.findAll({ order: [['id', 'ASC']] });
    const items = rows.map((r: any) => {
      const obj = r.toJSON();
      obj.keywords = (() => {
        try {
          return JSON.parse(obj.keywords || '[]');
        } catch {
          return [];
        }
      })();
      return obj;
    });
    res.json(items);
  } catch (err) {
    console.error('FAQs GET error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/faqs', requireRoles('ADMIN', 'SECRETARY'), async (req: Request, res: Response) => {
  try {
    const { question, answer, keywords } = req.body;
    if (!question || !answer)
      return res.status(400).json({ error: 'Question and answer are required' });
    const kw = Array.isArray(keywords)
      ? JSON.stringify(keywords)
      : typeof keywords === 'string'
      ? keywords
      : '[]';
    const row: any = await Faq.create({ question, answer, keywords: kw });
    try {
      await Log.create({
        level: 'info',
        message: 'FAQ created',
        meta: JSON.stringify({ id: row.id, question }),
      });
    } catch {}
    const obj = row.toJSON();
    obj.keywords = Array.isArray(keywords) ? keywords : [];
    res.status(201).json(obj);
  } catch (err) {
    console.error('FAQs POST error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/faqs/:id', requireRoles('ADMIN', 'SECRETARY'), async (req: Request, res: Response) => {
  try {
    const row: any = await Faq.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'FAQ not found' });
    const { question, answer, keywords } = req.body;
    if (question !== undefined) row.question = question;
    if (answer !== undefined) row.answer = answer;
    if (keywords !== undefined) {
      row.keywords = Array.isArray(keywords)
        ? JSON.stringify(keywords)
        : typeof keywords === 'string'
        ? keywords
        : '[]';
    }
    await row.save();
    try {
      await Log.create({
        level: 'info',
        message: 'FAQ updated',
        meta: JSON.stringify({ id: req.params.id }),
      });
    } catch {}
    const obj = row.toJSON();
    obj.keywords = (() => {
      try {
        return JSON.parse(obj.keywords || '[]');
      } catch {
        return [];
      }
    })();
    res.json(obj);
  } catch (err) {
    console.error('FAQs PUT error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/faqs/:id', requireRoles('ADMIN', 'SECRETARY'), async (req: Request, res: Response) => {
  try {
    const deleted = await Faq.destroy({ where: { id: req.params.id } });
    try {
      await Log.create({
        level: 'warning',
        message: 'FAQ deleted',
        meta: JSON.stringify({ id: req.params.id }),
      });
    } catch {}
    res.json({ ok: true, deleted });
  } catch (err) {
    console.error('FAQs DELETE error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Content ───────────────────────────────────────────────────────────────
router.get('/content', async (_req: Request, res: Response) => {
  try {
    const rows = await Content.findAll();
    const obj: Record<string, unknown> = {};
    rows.forEach((r: any) => {
      try {
        obj[r.key] = JSON.parse(r.value);
      } catch {
        obj[r.key] = r.value;
      }
    });
    res.json(obj);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/content', requireRoles('ADMIN', 'SECRETARY'), async (req: Request, res: Response) => {
  try {
    const payload: Record<string, unknown> = req.body || {};
    for (const key of Object.keys(payload)) {
      const val = JSON.stringify(payload[key]);
      const [row, created] = await Content.findOrCreate({
        where: { key },
        defaults: { value: val },
      });
      if (!created) await Content.update({ value: val }, { where: { key } });
    }
    try {
      await Log.create({
        level: 'info',
        message: 'Content updated',
        meta: JSON.stringify({ keys: Object.keys(payload) }),
      });
    } catch {}
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Settings ─────────────────────────────────────────────────────────────
router.get('/settings', async (_req: Request, res: Response) => {
  try {
    let settings: any = await Settings.findOne();
    if (!settings) settings = await Settings.create({});
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/settings', requireRoles('ADMIN'), async (req: Request, res: Response) => {
  try {
    const { siteName, primaryColor, secondaryColor, accentColor, maintenanceMode } =
      req.body;
    let settings: any = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create(req.body);
    } else {
      await settings.update({
        siteName: siteName ?? settings.siteName,
        primaryColor: primaryColor ?? settings.primaryColor,
        secondaryColor: secondaryColor ?? settings.secondaryColor,
        accentColor: accentColor ?? settings.accentColor,
        maintenanceMode: maintenanceMode ?? settings.maintenanceMode,
      });
    }
    try {
      await Log.create({
        level: 'info',
        message: 'Settings updated',
        meta: JSON.stringify(req.body),
      });
    } catch {}
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post(
  '/settings/upload-logo',
  requireRoles('ADMIN'),
  upload.single('logo'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const url = `/uploads/${req.file.filename}`;
      let settings: any = await Settings.findOne();
      if (!settings) {
        settings = await Settings.create({ siteLogo: url });
      } else {
        await settings.update({ siteLogo: url });
      }
      try {
        await Log.create({
          level: 'info',
          message: 'Logo uploaded',
          meta: JSON.stringify({ url, filename: req.file.originalname }),
        });
      } catch {}
      res.json({ url, settings });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ─── Announcements ─────────────────────────────────────────────────────────
const announcementUpload = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'video', maxCount: 1 },
  { name: 'file', maxCount: 1 },
]);

router.get('/announcements', async (req: Request, res: Response) => {
  try {
    const { search, from, to } = req.query;
    const where: any = {};
    if (search) {
      where[Op.or as any] = [
        { title: { [Op.like as any]: `%${search}%` } },
        { description: { [Op.like as any]: `%${search}%` } },
      ];
    }
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt[Op.gte as any] = new Date(from as string);
      if (to) where.createdAt[Op.lte as any] = new Date(to as string);
    }
    const announcements = await Announcement.findAll({
      where,
      include: [{ model: User, attributes: ['id', 'name', 'role'] }],
      order: [
        ['isPinned', 'DESC'],
        ['createdAt', 'DESC'],
      ],
    });
    res.json(announcements);
  } catch (err) {
    console.error('Announcements GET error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post(
  '/announcements',
  requireRoles('ADMIN', 'SECRETARY'),
  announcementUpload,
  async (req: Request, res: Response) => {
    try {
      const { userId, title, description, isPinned } = req.body;
      const files = req.files as Record<string, Express.Multer.File[]>;

      let imageUrl: string | null = null;
      let videoUrl: string | null = null;
      let fileUrl: string | null = null;
      let fileName: string | null = null;

      if (files?.image?.[0]) {
        const f = files.image[0];
        await resizeImage(f.path, 400);
        imageUrl = `/uploads/${f.filename}`;
      }
      if (files?.video?.[0]) {
        videoUrl = `/uploads/${files.video[0].filename}`;
      }
      if (files?.file?.[0]) {
        fileUrl = `/uploads/${files.file[0].filename}`;
        fileName = files.file[0].originalname;
      }

      const announcement: any = await Announcement.create({
        userId,
        title,
        description,
        imageUrl,
        videoUrl,
        fileUrl,
        fileName,
        isPinned: isPinned === 'true' || isPinned === true,
      });

      const result = await Announcement.findByPk(announcement.id, {
        include: [{ model: User, attributes: ['id', 'name', 'role'] }],
      });

      try {
        await Log.create({
          level: 'info',
          message: 'Announcement created',
          meta: JSON.stringify({ announcementId: announcement.id, title }),
        });
      } catch {}
      res.status(201).json(result);
    } catch (err) {
      console.error('Announcement POST error', err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

router.put(
  '/announcements/:id',
  requireRoles('ADMIN', 'SECRETARY'),
  announcementUpload,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const announcement: any = await Announcement.findByPk(id);
      if (!announcement)
        return res.status(404).json({ error: 'Announcement not found' });
      const files = req.files as Record<string, Express.Multer.File[]>;
      const { title, description, isPinned } = req.body;

      if (title !== undefined) announcement.title = title;
      if (description !== undefined) announcement.description = description;
      if (isPinned !== undefined)
        announcement.isPinned = isPinned === 'true' || isPinned === true;

      if (files?.image?.[0]) {
        const f = files.image[0];
        await resizeImage(f.path, 400);
        announcement.imageUrl = `/uploads/${f.filename}`;
      }
      if (files?.video?.[0]) {
        announcement.videoUrl = `/uploads/${files.video[0].filename}`;
      }
      if (files?.file?.[0]) {
        announcement.fileUrl = `/uploads/${files.file[0].filename}`;
        announcement.fileName = files.file[0].originalname;
      }

      announcement.updatedAt = new Date();
      await announcement.save();

      const result = await Announcement.findByPk(id, {
        include: [{ model: User, attributes: ['id', 'name', 'role'] }],
      });

      try {
        await Log.create({
          level: 'info',
          message: 'Announcement updated',
          meta: JSON.stringify({ announcementId: id, title: announcement.title }),
        });
      } catch {}
      res.json(result);
    } catch (err) {
      console.error('Announcement PUT error', err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

router.delete('/announcements/:id', requireRoles('ADMIN', 'SECRETARY'), async (req: Request, res: Response) => {
  try {
    const announcement: any = await Announcement.findByPk(req.params.id);
    if (!announcement)
      return res.status(404).json({ error: 'Announcement not found' });
    await announcement.destroy();
    try {
      await Log.create({
        level: 'warning',
        message: 'Announcement deleted',
        meta: JSON.stringify({ announcementId: req.params.id, title: announcement.title }),
      });
    } catch {}
    res.json({ ok: true });
  } catch (err) {
    console.error('Announcement DELETE error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Capital Share: Summary (all members) ───────────────────────────────
// NOTE: /capital-share/summary MUST be registered before /capital-share/:memberId
router.get('/capital-share/summary', requireRoles('ADMIN', 'TREASURER'), async (req: Request, res: Response) => {
  try {
    const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
    const page = Math.max(parseInt(String(req.query.page)) || 1, 1);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 200);
    const offset = (page - 1) * limit;
    const rows = await CapitalShareTransaction.findAll({
      where: { status: 'Confirmed' },
      include: [{ model: User, foreignKey: 'memberId', as: 'member', attributes: ['id', 'name'] }],
      order: [['createdAt', 'DESC']],
    });
    const map: Record<string, { memberId: string; memberName: string; totalConfirmed: number; transactionCount: number }> = {};
    (rows as any[]).forEach((r: any) => {
      const mid = String(r.memberId);
      if (!map[mid]) map[mid] = { memberId: mid, memberName: r.member?.name || mid, totalConfirmed: 0, transactionCount: 0 };
      map[mid].totalConfirmed += parseFloat(r.amount || 0);
      map[mid].transactionCount += 1;
    });
    const all = Object.values(map).sort((a, b) => b.totalConfirmed - a.totalConfirmed);
    if (!hasPagination) {
      return res.json(all);
    }
    const items = all.slice(offset, offset + limit);
    const total = Object.keys(map).length;
    res.json({ items, total, page, totalPages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    console.error('Capital share summary error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Capital Share: Pending Transactions (all members) ─────────────────
// NOTE: /capital-share/pending MUST be registered before /capital-share/:memberId
router.get('/capital-share/pending', requireRoles('ADMIN', 'TREASURER'), async (_req: Request, res: Response) => {
  try {
    const txs = await CapitalShareTransaction.findAll({
      where: { status: 'Pending' },
      include: [
        { model: User, foreignKey: 'memberId', as: 'member', attributes: ['id', 'name'] },
        { model: User, foreignKey: 'addedById', as: 'addedBy', attributes: ['id', 'name', 'role'] },
      ],
      order: [['createdAt', 'DESC']],
    });
    res.json(txs);
  } catch (err) {
    console.error('Capital share pending error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Capital Share: All Transactions (all members) ─────────────────────
// NOTE: /capital-share/transactions MUST be registered before /capital-share/:memberId
router.get('/capital-share/transactions', requireRoles('ADMIN', 'TREASURER'), async (_req: Request, res: Response) => {
  try {
    const txs = await CapitalShareTransaction.findAll({
      include: [
        { model: User, foreignKey: 'memberId', as: 'member', attributes: ['id', 'name'] },
        { model: User, foreignKey: 'addedById', as: 'addedBy', attributes: ['id', 'name', 'role'] },
        { model: User, foreignKey: 'confirmedById', as: 'confirmedBy', attributes: ['id', 'name', 'role'] },
      ],
      order: [['createdAt', 'DESC']],
    });
    res.json(txs);
  } catch (err) {
    console.error('Capital share transactions error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Capital Share: Ledger for one member ───────────────────────────────
router.get('/capital-share/:memberId', requireAuth, async (req: Request, res: Response) => {
  try {
    const actor = getSessionAuthUser(req)!;
    if (actor.role === 'MEMBER' && String(actor.id) !== String(req.params.memberId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const txs = await CapitalShareTransaction.findAll({
      where: { memberId: req.params.memberId },
      include: [
        { model: User, foreignKey: 'addedById', as: 'addedBy', attributes: ['id', 'name', 'role'] },
        { model: User, foreignKey: 'confirmedById', as: 'confirmedBy', attributes: ['id', 'name', 'role'] },
      ],
      order: [['createdAt', 'ASC']],
    });
    let running = 0;
    const withBalance = (txs as any[]).map((t: any) => {
      const obj = t.toJSON();
      if (obj.status === 'Confirmed') running += parseFloat(obj.amount || 0);
      obj.runningBalance = running;
      return obj;
    });
    res.json(withBalance);
  } catch (err) {
    console.error('Capital share ledger error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Capital Share: Add Transaction ────────────────────────────────────
router.post('/capital-share', requireRoles('ADMIN', 'TREASURER'), async (req: Request, res: Response) => {
  try {
    const actor = getSessionAuthUser(req)!;
    const { memberId, amount, paymentType, referenceNumber, notes } = req.body;
    if (!memberId || !amount || !paymentType) {
      return res.status(400).json({ error: 'memberId, amount, paymentType are required' });
    }
    const addedById = actor.id;
    const adder: any = await User.findByPk(addedById, { attributes: ['id', 'role'] });
    if (!adder) return res.status(404).json({ error: 'addedBy user not found' });
    if (!['ADMIN', 'TREASURER'].includes(String(adder.role || '').toUpperCase())) {
      return res.status(403).json({ error: 'Only ADMIN or TREASURER can add capital share transactions' });
    }
    const tx: any = await CapitalShareTransaction.create({
      memberId, addedById, amount, paymentType,
      referenceNumber: referenceNumber || null,
      notes: notes || null,
      status: 'Pending',
    });
    try {
      await Log.create({ level: 'info', message: 'Capital share transaction added', meta: JSON.stringify({ txId: tx.id, memberId, addedById, amount }) });
    } catch {}
    res.status(201).json(tx);
  } catch (err) {
    console.error('Capital share POST error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Capital Share: Confirm Transaction ────────────────────────────────
router.put('/capital-share/:txId/confirm', requireRoles('ADMIN', 'TREASURER'), async (req: Request, res: Response) => {
  try {
    const actor = getSessionAuthUser(req)!;
    const confirmerId = actor.id;
    const tx: any = await sequelize.transaction(async (transaction: any) => {
      const row: any = await CapitalShareTransaction.findByPk(req.params.txId, { transaction });
      if (!row) throw Object.assign(new Error('NOT_FOUND'), { statusCode: 404, clientMessage: 'Transaction not found' });
      if (row.status === 'Confirmed') throw Object.assign(new Error('ALREADY_CONFIRMED'), { statusCode: 400, clientMessage: 'Transaction already confirmed' });
      const confirmer: any = await User.findByPk(confirmerId, { attributes: ['id', 'role'], transaction });
      if (!confirmer) throw Object.assign(new Error('CONFIRMER_NOT_FOUND'), { statusCode: 404, clientMessage: 'Confirmer not found' });
      const adder: any = await User.findByPk(row.addedById, { attributes: ['id', 'role'], transaction });
      if (adder) {
        const adderRole = String(adder.role || '').toUpperCase();
        const confirmerRole = String(confirmer.role || '').toUpperCase();
        const allowed = (adderRole === 'TREASURER' && confirmerRole === 'ADMIN') ||
            (adderRole === 'ADMIN' && confirmerRole === 'TREASURER');
        if (!allowed) throw Object.assign(new Error('FORBIDDEN'), { statusCode: 403, clientMessage: 'Invalid confirmer role for this transaction' });
      }
      if (String(confirmerId) === String(row.addedById)) {
        throw Object.assign(new Error('SELF_CONFIRM'), { statusCode: 403, clientMessage: 'Cannot confirm your own transaction' });
      }
      row.status = 'Confirmed';
      row.confirmedById = confirmerId;
      row.confirmedAt = new Date();
      await row.save({ transaction });
      await User.increment('capitalShare', { by: parseFloat(row.amount), where: { id: row.memberId }, transaction } as any);
      return row;
    });
    try {
      await Log.create({ level: 'info', message: 'Capital share confirmed', meta: JSON.stringify({ txId: tx.id, confirmerId, amount: tx.amount }) });
    } catch {}
    res.json(tx);
  } catch (err) {
    const statusCode = (err as any)?.statusCode;
    const clientMessage = (err as any)?.clientMessage;
    if (statusCode && clientMessage) return res.status(statusCode).json({ error: clientMessage });
    console.error('Capital share confirm error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Capital Share: Reject Transaction ─────────────────────────────────
router.put('/capital-share/:txId/reject', requireRoles('ADMIN', 'TREASURER'), async (req: Request, res: Response) => {
  try {
    const actor = getSessionAuthUser(req)!;
    const { notes } = req.body;
    const confirmerId = actor.id;
    const tx: any = await CapitalShareTransaction.findByPk(req.params.txId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    const confirmer: any = await User.findByPk(confirmerId, { attributes: ['id', 'role'] });
    const adder: any = await User.findByPk(tx.addedById, { attributes: ['id', 'role'] });
    if (adder && confirmer) {
      const adderRole = String(adder.role || '').toUpperCase();
      const confirmerRole = String(confirmer.role || '').toUpperCase();
      const allowed = (adderRole === 'TREASURER' && confirmerRole === 'ADMIN') ||
              (adderRole === 'ADMIN' && confirmerRole === 'TREASURER');
      if (!allowed) return res.status(403).json({ error: 'Invalid confirmer role' });
    }
    tx.status = 'Rejected';
    if (notes) tx.notes = notes;
    await tx.save();
    try {
      await Log.create({ level: 'warning', message: 'Capital share rejected', meta: JSON.stringify({ txId: tx.id, confirmerId }) });
    } catch {}
    res.json(tx);
  } catch (err) {
    console.error('Capital share reject error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
