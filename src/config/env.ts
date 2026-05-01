import 'dotenv/config';

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://hybrid_pos:hybrid_pos_password@localhost:5432/hybrid_pos',
  deviceApiToken: process.env.DEVICE_API_TOKEN?.trim() ?? '',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
};
