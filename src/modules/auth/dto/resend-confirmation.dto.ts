import { IsEmail } from 'class-validator';

import { NormalizeEmail } from '@/common/validation/normalize-email.decorator';

export class ResendConfirmationDto {
  @IsEmail()
  @NormalizeEmail()
  email: string;
}
