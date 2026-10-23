import { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { HttpError } from '../types';

// Express 4 doesn't catch rejected promises from async handlers.
// Wrapping a handler with this forwards any error to the central error handler below.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

// Unknown routes -> consistent JSON instead of Express's default HTML page.
export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Route not found' });
}

// Every error ends up here, so clients always receive {error: string}.
// The 4-argument signature is how Express recognises an error handler.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  // Upload problems from multer (e.g. file too large).
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? 'Receipt must be 5MB or smaller' : `Upload error: ${err.message}`;
    res.status(400).json({ error: message });
    return;
  }

  // Malformed JSON body (thrown by express.json()).
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  // Postgres foreign-key violation: the token is valid but the user row is gone.
  if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23503') {
    res.status(401).json({ error: 'User no longer exists. Please log in again.' });
    return;
  }

  // Anything else is a bug: log details server-side, but don't leak them to the client.
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
