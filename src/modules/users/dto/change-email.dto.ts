import { IsEmail } from 'class-validator';

import { NormalizeEmail } from '@/modules/auth/dto/normalize-email.decorator';

export class ChangeEmailDto {
  @IsEmail()
  @NormalizeEmail()
  newEmail: string;
}
