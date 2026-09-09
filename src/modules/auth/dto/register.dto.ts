import { IsEmail, IsString, MinLength } from 'class-validator';

import { NormalizeEmail } from './normalize-email.decorator';

export class RegisterDto {
  @IsEmail()
  @NormalizeEmail()
  email: string;

  // Mirrors the default AUTH_PASSWORD_MIN_LENGTH (8). class-validator
  // decorators are static and can't read ConfigService, so this doesn't
  // follow the config value if it's changed — see IMPLEMENTATION-LOG.md,
  // T-011 Phase 4.
  @IsString()
  @MinLength(8)
  password: string;
}
