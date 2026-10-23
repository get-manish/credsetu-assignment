import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { pool } from '../src/db';

// Runs every .sql file in migrations/ in alphabetical order (001_..., 002_...).
// Our SQL uses IF NOT EXISTS, so running this repeatedly is harmless.
// Exported so the test suite can build the schema with the exact same code.
export async function runMigrations(db: Pool): Promise<void> {
  const dir = path.resolve(__dirname, '..', 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    await db.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    console.log(`Applied migration: ${file}`);
  }
}

// Only run when called from the command line (`npm run migrate`), not when imported by tests.
if (require.main === module) {
  runMigrations(pool)
    .then(() => pool.end())
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
