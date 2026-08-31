import { StringLiteral } from "typescript";

export interface Config {
  PORT: number;
  NODE_ENV: 'development' | 'production';
  APP_NAME?: string;
  API_PREFIX?: string;
  API_VERSION: string;
  SWAGGER_PATH?: string;

  /**
   * Cookie secret
   */
  COOKIE_SECRET: string;

  /**
   * Health check options
   */
  HEALTH_CHECK_ENABLED?: boolean;
  HEALTH_DISK_PATH?: string;
  HEALTH_DISK_THRESHOLD?: number;

  /**
   * Throttler options
   */
  THROTTLE_GLOBAL_TTL?: number;
  THROTTLE_GLOBAL_LIMIT?: number;

  /**
   * PostgreSQL database options
   */
  POSTGRES_HOST: string;
  POSTGRES_PORT: number;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
  POSTGRES_SYNCHRONIZE?: boolean;
  POSTGRES_LOGGING?: boolean;
  POSTGRES_MIGRATIONS_RUN?: boolean;

  /**
   * Auth / JWT options
   */
  JWT_SECRET: string;
  JWT_ACCESS_TTL?: string;
  JWT_REFRESH_TTL?: string;

  /**
   * File transformation storage options
   */
  STORAGE_DRIVER?: 'local' | 's3';
  STORAGE_LOCAL_PATH?: string;
  STORAGE_S3_BUCKET?: string;
  STORAGE_S3_REGION?: string;
  STORAGE_S3_ENDPOINT?: string;
}
