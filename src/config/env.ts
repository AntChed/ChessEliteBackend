import dotenv from 'dotenv';

dotenv.config();

const defaultPort = 3000;

function readPort(value: string | undefined) {
  if (!value) {
    return defaultPort;
  }

  const parsedPort = Number(value);

  return Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : defaultPort;
}

export const env = {
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: readPort(process.env.PORT),
};

export const isProduction = env.nodeEnv === 'production';
