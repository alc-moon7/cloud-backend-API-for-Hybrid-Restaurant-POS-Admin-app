import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

import { env } from '../config/env.js';
import { HttpError, unauthorized } from '../shared/http-error.js';

export const authMiddleware: RequestHandler = (request, _response, next) => {
  if (!env.deviceApiToken) return next();
  if (
    request.path === '/health' ||
    request.path === '/api/v1/health' ||
    request.path.startsWith('/owner/') ||
    request.path.startsWith('/api/v1/owner/') ||
    request.path === '/staff/auth/login' ||
    request.path === '/api/v1/staff/auth/login' ||
    /^\/(?:api\/v1\/)?outlets\/[^/]+\/menu(?:\/.*)?$/.test(request.path) ||
    /^\/(?:api\/v1\/)?outlets\/[^/]+\/orders(?:\/.*)?$/.test(request.path)
  ) {
    return next();
  }

  const header = request.header('authorization') ?? '';
  const expected = `Bearer ${env.deviceApiToken}`;
  if (header !== expected) return next(unauthorized());
  next();
};

export const notFoundMiddleware: RequestHandler = (request, _response, next) => {
  next(new HttpError(404, `Route not found: ${request.method} ${request.path}`));
};

export const errorMiddleware: ErrorRequestHandler = (
  error,
  _request,
  response,
  _next,
) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      ok: false,
      error: 'Validation failed.',
      details: error.flatten(),
    });
    return;
  }

  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  response.status(statusCode).json({
    ok: false,
    error: error instanceof Error ? error.message : 'Internal server error.',
    detail: error instanceof Error ? error.message : 'Internal server error.',
    details: error instanceof HttpError ? error.details : undefined,
  });
};
