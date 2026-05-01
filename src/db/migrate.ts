import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pool } from './pool.js';

async function main() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const sql = await readFile(
    join(currentDir, 'migrations', '001_init.sql'),
    'utf8',
  );
  await pool.query(sql);
  await pool.end();
  console.log('Database migration completed.');
}

main().catch(async (error) => {
  console.error('Database migration failed.');
  console.error(error);
  await pool.end();
  process.exit(1);
});
