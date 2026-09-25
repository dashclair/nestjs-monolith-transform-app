import { Config } from '@/core/config/config.types';
import { EmailVerificationMethod } from '@/core/email-verification/email-verification-method.enum';

export interface AuthSettings {
  registrationConfirmationRequired: boolean;
  registrationConfirmationMethod: EmailVerificationMethod;
  loginConfirmationRequired: boolean;
  loginConfirmationMethod: EmailVerificationMethod;
}

export const AUTH_SETTING_DEFINITIONS = {
  registrationConfirmationRequired: {
    env: 'AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION',
    kind: 'boolean',
    fallback: false,
  },
  registrationConfirmationMethod: {
    env: 'AUTH_REGISTER_CONFIRMATION_METHOD',
    kind: 'method',
    fallback: EmailVerificationMethod.OTP,
  },
  loginConfirmationRequired: {
    env: 'AUTH_LOGIN_REQUIRE_EMAIL_CONFIRMATION',
    kind: 'boolean',
    fallback: false,
  },
  loginConfirmationMethod: {
    env: 'AUTH_LOGIN_CONFIRMATION_METHOD',
    kind: 'method',
    fallback: EmailVerificationMethod.OTP,
  },
} as const satisfies Record<
  keyof AuthSettings,
  {
    env: keyof Config;
    kind: 'boolean' | 'method';
    fallback: boolean | EmailVerificationMethod;
  }
>;

export type AuthSettingKey = keyof AuthSettings;

export const AUTH_SETTING_KEYS = Object.keys(
  AUTH_SETTING_DEFINITIONS,
) as AuthSettingKey[];

export function isAuthSettingValue(
  key: AuthSettingKey,
  value: unknown,
): boolean {
  return AUTH_SETTING_DEFINITIONS[key].kind === 'boolean'
    ? typeof value === 'boolean'
    : value === EmailVerificationMethod.OTP ||
        value === EmailVerificationMethod.MAGIC_LINK;
}
