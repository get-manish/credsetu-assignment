import { Pool } from 'pg';
import { config } from './config';

// One shared connection pool for the whole app. pg reuses connections for us.
export const pool = new Pool({ connectionString: config.databaseUrl });

// Tiny helper so route code reads `query(sql, params)`.
// Always pass user input through `params` ($1, $2, ...) - never build SQL by string concatenation.
export function query<T extends object = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
) {
  return pool.query<T>(text, params);
}
