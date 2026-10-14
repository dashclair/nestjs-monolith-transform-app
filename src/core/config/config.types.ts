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
  THROTTLE_USERS_READ_TTL?: number; // default 60
  THROTTLE_USERS_LIST_LIMIT?: number; // default 20
  THROTTLE_USERS_LIST_TTL?: number; // default 60 (секунд)

  /**
   * Users list (GET /users) pagination
   */
  USERS_LIST_MAX_LIMIT?: number; // default 100 — верхняя граница `limit`
  USERS_LIST_DEFAULT_LIMIT?: number; // default 20, не больше USERS_LIST_MAX_LIMIT

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
   * Email change confirmation
   */
  AUTH_EMAIL_CHANGE_CONFIRMATION_METHOD?: 'otp' | 'magic_link';

  DELETE_ACCOUNT_CONFIRMATION_METHOD?: 'otp' | 'magic_link';

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
  STORAGE_S3_ACCESS_KEY_ID?: string;
  STORAGE_S3_SECRET_ACCESS_KEY?: string;
  STORAGE_S3_FORCE_PATH_STYLE?: boolean; // default false
  STORAGE_MAX_FILE_BYTES?: number; // bytes, default 50 MiB; larger results are not saved

  TRANSFORM_TIMEOUT_MS?: number; // default 30000, milliseconds
  THROTTLE_TRANSFORM_LIMIT?: number; // default 10
  THROTTLE_TRANSFORM_TTL?: number; // default 60, seconds
  TRANSFORM_MAX_SIZE_CSV?: number; // bytes, default 10 MiB
  TRANSFORM_MAX_SIZE_JSON?: number; // bytes, default 10 MiB
  TRANSFORM_MAX_SIZE_XML?: number; // bytes, default 10 MiB
  TRANSFORM_MAX_SIZE_YAML?: number; // bytes, default 5 MiB
  TRANSFORM_TEXT_WORKERS?: number; // worker threads for text conversion, default 2
  TRANSFORM_TEXT_MAX_DEPTH?: number; // max nesting depth of parsed data, default 64
  TRANSFORM_TEXT_MAX_NODES?: number; // max number of nodes in parsed data, default 1000000
  TRANSFORM_MAX_SIZE_PNG?: number; // bytes, default 20 MiB
  TRANSFORM_MAX_SIZE_JPEG?: number; // bytes, default 20 MiB
  TRANSFORM_MAX_SIZE_SVG?: number; // bytes, default 2 MiB
  IMAGE_MAX_INPUT_PIXELS?: number; // width × height of the input, default 50000000 (~7000×7000)
  IMAGE_SVG_MAX_WIDTH?: number; // px, default 4096
  IMAGE_SVG_MAX_HEIGHT?: number; // px, default 4096
  IMAGE_JPEG_DEFAULT_QUALITY?: number; // 1–100, default 80
  TRANSFORMATIONS_RETENTION_DAYS?: number; // default 90
  TRANSFORMATIONS_CLEANUP_ENABLED?: boolean; // default true
  TRANSFORMATIONS_CLEANUP_CRON?: string; // default '0 * * * *'
  TRANSFORMATIONS_CLEANUP_BATCH?: number; // rows per DELETE, default 500
  THROTTLE_TRANSFORMATIONS_HISTORY_LIMIT?: number; // default 30
  THROTTLE_TRANSFORMATIONS_HISTORY_TTL?: number; // default 60, seconds
  THROTTLE_ADMIN_TRANSFORMATIONS_HISTORY_LIMIT?: number; // default 20
  THROTTLE_ADMIN_TRANSFORMATIONS_HISTORY_TTL?: number; // default 60, seconds
  THROTTLE_TRANSFORMATIONS_DOWNLOAD_LIMIT?: number; // default 10
  THROTTLE_TRANSFORMATIONS_DOWNLOAD_TTL?: number; // default 60, seconds
  THROTTLE_ADMIN_TRANSFORMATIONS_DOWNLOAD_LIMIT?: number; // default 10
  THROTTLE_ADMIN_TRANSFORMATIONS_DOWNLOAD_TTL?: number; // default 60, seconds
}
