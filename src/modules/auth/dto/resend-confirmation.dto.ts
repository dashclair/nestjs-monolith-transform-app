import { IsEmail } from 'class-validator';

import { NormalizeEmail } from './normalize-email.decorator';

export class ResendConfirmationDto {
  @IsEmail()
  @NormalizeEmail()
  email: string;
}
