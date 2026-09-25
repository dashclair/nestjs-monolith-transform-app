import { Transform, TransformFnParams } from 'class-transformer';
import { IsBoolean, IsEnum, ValidateIf } from 'class-validator';
import { EmailVerificationMethod } from '@/core/email-verification/email-verification-method.enum';

// Keep raw input: global implicit conversion would turn "false" into true.
const rawValue = ({ obj, key }: TransformFnParams): unknown =>
  (obj as Record<string, unknown>)[key];
// null is a valid value: it resets the setting to its env fallback.
const isSet = (_object: unknown, value: unknown): boolean =>
  value !== undefined && value !== null;

export class UpdateAuthSettingsDto {
  @Transform(rawValue)
  @ValidateIf(isSet)
  @IsBoolean()
  registrationConfirmationRequired?: boolean | null;

  @Transform(rawValue)
  @ValidateIf(isSet)
  @IsEnum(EmailVerificationMethod)
  registrationConfirmationMethod?: EmailVerificationMethod | null;

  @Transform(rawValue)
  @ValidateIf(isSet)
  @IsBoolean()
  loginConfirmationRequired?: boolean | null;

  @Transform(rawValue)
  @ValidateIf(isSet)
  @IsEnum(EmailVerificationMethod)
  loginConfirmationMethod?: EmailVerificationMethod | null;
}
