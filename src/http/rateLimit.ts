import type { Request, RequestHandler } from 'express';

import { sendApiError } from './errors.js';

type RateLimitOptions = {
  keyPrefix: string;
  maxRequests: number;
  windowMs: number;
  keyGenerator?: (request: Request) => string;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();

function getForwardedIp(request: Request) {
  const forwardedFor = request.header('x-forwarded-for');

  if (!forwardedFor) {
    return null;
  }

  return forwardedFor.split(',')[0]?.trim() || null;
}

function getClientIp(request: Request) {
  return getForwardedIp(request) ?? request.ip ?? request.socket.remoteAddress ?? 'unknown';
}

export function playerOrIpRateLimitKey(request: Request) {
  return request.player?.id ?? getClientIp(request);
}

function pruneExpiredBuckets(now: number) {
  if (buckets.size < 10_000) {
    return;
  }

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function createRateLimit(options: RateLimitOptions): RequestHandler {
  return (request, response, next) => {
    const now = Date.now();
    const key = `${options.keyPrefix}:${(options.keyGenerator ?? getClientIp)(request)}`;
    const existingBucket = buckets.get(key);
    const bucket =
      existingBucket && existingBucket.resetAt > now
        ? existingBucket
        : {
            count: 0,
            resetAt: now + options.windowMs,
          };

    bucket.count += 1;
    buckets.set(key, bucket);
    pruneExpiredBuckets(now);

    if (bucket.count <= options.maxRequests) {
      next();
      return;
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    response.setHeader('Retry-After', String(retryAfterSeconds));
    sendApiError(response, 429, 'RATE_LIMITED', 'Too many requests');
  };
}
