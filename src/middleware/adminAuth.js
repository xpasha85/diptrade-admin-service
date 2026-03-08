import crypto from 'node:crypto';

import { sendError } from '../http/errors.js';

function tokensMatch(provided, expected) {
  const providedBuf = Buffer.from(provided || '');
  const expectedBuf = Buffer.from(expected || '');

  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

function parseBearer(authHeader) {
  if (!authHeader) return null;

  const [scheme, ...rest] = authHeader.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;

  const token = rest.join(' ').trim();
  return token || null;
}

export function requireAdminToken(expectedToken) {
  if (!expectedToken) {
    throw new Error('ADMIN_TOKEN middleware is not configured');
  }

  return (req, res, next) => {
    const token = parseBearer(req.get('authorization') || '');

    if (!token) {
      return sendError(
        res,
        401,
        'UNAUTHORIZED',
        'Missing or invalid Authorization header. Use Bearer token.'
      );
    }

    if (!tokensMatch(token, expectedToken)) {
      return sendError(res, 403, 'FORBIDDEN', 'Invalid admin token');
    }

    return next();
  };
}
