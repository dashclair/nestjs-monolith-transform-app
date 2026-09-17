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
  THROTTLE_USERS_READ_LIMIT?: number; // default 20
  THROTTLE_USERS_READ_TTL?: number;   // default 60 

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
  COOKIE_SAMESITE?: 'lax' | 'strict' | 'none'; // default 'lax'
  COOKIE_SECURE?: boolean; // default false — включить в проде (HTTPS)

  AUTH_LOGIN_REQUIRE_EMAIL_CONFIRMATION?: boolean;
  AUTH_LOGIN_CONFIRMATION_METHOD?: 'otp' | 'magic_link';
  AUTH_LOGIN_MAX_FAILED_ATTEMPTS?: number;
  AUTH_LOGIN_LOCKOUT_MINUTES?: number;

  /**
   * Registration email confirmation
   */
  AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION?: boolean;
  AUTH_REGISTER_CONFIRMATION_METHOD?: 'otp' | 'magic_link';

  /**
   * Email verification (OTP / magic link) parameters
   */
  EMAIL_VERIFICATION_TTL_MINUTES?: number;
  EMAIL_VERIFICATION_MAX_ATTEMPTS?: number;
  EMAIL_VERIFICATION_RESEND_INTERVAL_SECONDS?: number;
  OTP_LENGTH?: number;

  /**
   * Password policy
   */
  AUTH_PASSWORD_MIN_LENGTH?: number;
  AUTH_PASSWORD_REQUIRE_COMPLEXITY?: boolean;

  /**
   * Mailer (SMTP)
   */
  MAIL_HOST?: string;
  MAIL_PORT?: number;
  MAIL_USER?: string;
  MAIL_PASSWORD?: string;
  MAIL_SECURE?: boolean;
  MAIL_FROM?: string;

  /**
   * File transformation storage options
   */
  STORAGE_DRIVER?: 'local' | 's3';
  STORAGE_LOCAL_PATH?: string;
  STORAGE_S3_BUCKET?: string;
  STORAGE_S3_REGION?: string;
  STORAGE_S3_ENDPOINT?: string;
}
