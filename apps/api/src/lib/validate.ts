import { z } from 'zod';
import { HttpProblem } from './errors.js';

/** Parses input with a zod schema or throws a 422 problem with per-field errors. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input ?? {});
  if (r.success) return r.data;
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    if (!errors[key]) errors[key] = issue.message;
  }
  throw new HttpProblem(422, 'validation_failed', 'Some fields are invalid.', errors);
}

export const uuid = z.uuid();
export const limitSchema = z.coerce.number().int().min(1).max(50).default(20);
export const pageQuery = z.object({ cursor: z.string().max(500).optional(), limit: limitSchema });
