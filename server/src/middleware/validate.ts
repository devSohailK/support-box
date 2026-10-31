import type { RequestHandler } from 'express';
import type { z } from 'zod';

type Schemas = {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
};

export type Validated = {
  body?: unknown;
  query?: unknown;
  params?: unknown;
};

/**
 * Validates request parts against zod schemas. Every route that takes input must use this.
 * Parsed values are placed on res.locals.validated (req.query is read-only in Express 5).
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, res, next) => {
    const validated: Validated = {};
    for (const part of ['body', 'query', 'params'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (!result.success) {
        res.status(400).json({
          error: 'validation_error',
          part,
          issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
        return;
      }
      validated[part] = result.data;
    }
    res.locals.validated = validated;
    next();
  };
}
