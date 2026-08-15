import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import type { Player } from '../players/player.types.js';

const issuer = 'chess-elite-backend';
const audience = 'chess-elite-mobile';

export type PlayerTokenPayload = {
  playerId: string;
  tokenVersion: number;
};

function requireJwtSecret() {
  if (!env.jwtSecret || env.jwtSecret === 'replace-with-a-long-random-secret') {
    throw new Error('JWT_SECRET is required');
  }

  return env.jwtSecret;
}

export function signPlayerToken(player: Player) {
  return jwt.sign(
    {
      tokenVersion: player.tokenVersion,
    },
    requireJwtSecret(),
    {
      audience,
      expiresIn: '180d',
      issuer,
      subject: player.id,
    },
  );
}

export function verifyPlayerToken(token: string): PlayerTokenPayload {
  const decodedToken = jwt.verify(token, requireJwtSecret(), {
    audience,
    issuer,
  });

  if (!decodedToken || typeof decodedToken !== 'object') {
    throw new Error('Invalid token');
  }

  const playerId = decodedToken.sub;
  const tokenVersion = decodedToken.tokenVersion;

  if (typeof playerId !== 'string' || typeof tokenVersion !== 'number') {
    throw new Error('Invalid token payload');
  }

  return {
    playerId,
    tokenVersion,
  };
}

