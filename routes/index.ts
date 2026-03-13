import { Router, Request, Response } from 'express';

const router = Router();

/**
 * GET /
 * Returns API information. The React frontend is served separately.
 */
router.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'MICACO API',
    version: '2.0.0',
    status: 'running',
    api: '/api',
    health: '/api/health',
  });
});

export default router;
