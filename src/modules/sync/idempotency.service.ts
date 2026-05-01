import type { Request, Response } from 'express';

import { pool, withTransaction } from '../../db/pool.js';

type IdempotentResult = {
  statusCode: number;
  body: Record<string, unknown>;
};

export async function withIdempotency(
  request: Request,
  response: Response,
  action: () => Promise<IdempotentResult>,
) {
  const key = request.header('Idempotency-Key')?.trim();
  if (!key) {
    const result = await action();
    response.status(result.statusCode).json(result.body);
    return;
  }

  const existing = await pool.query(
    'SELECT status_code, response_body FROM idempotency_keys WHERE key = $1',
    [key],
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    response.status(row.status_code).json(row.response_body);
    return;
  }

  const result = await withTransaction(async (client) => {
    const actionResult = await action();
    await client.query(
      `
        INSERT INTO idempotency_keys (key, status_code, response_body)
        VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (key) DO NOTHING
      `,
      [key, actionResult.statusCode, JSON.stringify(actionResult.body)],
    );
    return actionResult;
  });

  response.status(result.statusCode).json(result.body);
}
