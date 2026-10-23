import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { HttpError } from '../types';

// Reads "Authorization: Bearer <token>", verifies it, and attaches the user id to the request.
// Every /loans route sits behind this, and queries always filter by req.user.id.
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new HttpError(401, 'Missing or malformed Authorization header'));
  }

  try {
    const payload = jwt.verify(header.slice('Bearer '.length), config.jwtSecret);
    // jwt.verify returns string | JwtPayload; we only ever sign objects with `sub`.
    if (typeof payload === 'string' || typeof payload.sub !== 'string') {
      return next(new HttpError(401, 'Invalid token'));
    }
    req.user = { id: payload.sub };
    next();
  } catch {
    // Expired, tampered, wrong secret... the client only needs to know it must log in again.
    next(new HttpError(401, 'Invalid or expired token'));
  }
}
