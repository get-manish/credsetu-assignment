import { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import { ZodTypeAny } from 'zod';

type Source = 'body' | 'params' | 'query';

// Reusable validation middleware: validate(schema) or validate(schema, 'params').
// On success the parsed (trimmed / converted) data replaces the raw input, so
// route handlers can trust the types. On failure we answer 400 with a list of problems.
export function validate(schema: ZodTypeAny, source: Source = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      // If multer already saved a receipt but the other fields are invalid, delete it
      // so rejected requests don't leave orphan files behind.
      if (req.file) fs.unlink(req.file.path, () => undefined);

      // Keep only the FIRST problem per field, so the user sees one clear message per input
      // (e.g. "-5" would otherwise report both "bad format" and "must be greater than 0").
      const firstPerField = new Map<string, string>();
      for (const issue of result.error.issues) {
        const field = issue.path.join('.') || source;
        if (!firstPerField.has(field)) firstPerField.set(field, issue.message);
      }

      res.status(400).json({
        error: 'Validation failed',
        details: [...firstPerField].map(([field, message]) => ({ field, message })),
      });
      return;
    }

    // Express types these as read-only-ish generic objects; the parsed value is the
    // same shape plus conversions, so assigning it back is safe.
    (req as unknown as Record<Source, unknown>)[source] = result.data;
    next();
  };
}
