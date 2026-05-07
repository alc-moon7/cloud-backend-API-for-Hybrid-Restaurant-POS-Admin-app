import type { Request } from 'express';

export type SessionPayload = {
  kind: 'owner' | 'staff';
  ownerId: string;
  restaurantId?: string | null;
  outletId?: string | null;
  role: 'owner' | 'admin';
  phone?: string;
  issuedAt: string;
};

export function issueSessionToken(payload: Omit<SessionPayload, 'issuedAt'>) {
  return Buffer.from(
    JSON.stringify({
      ...payload,
      issuedAt: new Date().toISOString(),
    } satisfies SessionPayload),
    'utf8',
  ).toString('base64url');
}

export function parseSessionToken(token: string | null | undefined): SessionPayload | null {
  if (!token) return null;
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.kind !== 'owner' && parsed.kind !== 'staff') return null;
    if (!parsed.ownerId || !parsed.role || !parsed.issuedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readBearerToken(request: Request) {
  const authorization = request.header('authorization') ?? '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : null;
}
