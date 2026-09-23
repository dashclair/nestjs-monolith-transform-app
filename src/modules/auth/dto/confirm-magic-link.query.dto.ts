import { IsEmail, IsString } from 'class-validator';

import { NormalizeEmail } from '@/common/validation/normalize-email.decorator';

export class ConfirmMagicLinkQueryDto {
  @IsEmail()
  @NormalizeEmail()
  email: string;

  @IsString()
  token: string;
}
