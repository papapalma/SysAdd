/**
 * Auth controller — API-only (no SSR).
 * Session-based helpers kept here if needed by future server-rendered views.
 * All authentication is handled via the /api/login and /api/register routes.
 */
import { Request, Response } from 'express';

export const notFound = (_req: Request, res: Response): void => {
  res.status(404).json({ error: 'Not found' });
};
