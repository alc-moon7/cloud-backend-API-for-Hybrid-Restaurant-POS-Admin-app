export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function badRequest(message: string, details?: unknown): HttpError {
  return new HttpError(400, message, details);
}

export function notFound(message: string): HttpError {
  return new HttpError(404, message);
}

export function unauthorized(message = 'Unauthorized.'): HttpError {
  return new HttpError(401, message);
}
