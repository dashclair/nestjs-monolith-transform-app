import { IsEmail, IsString } from 'class-validator';

import { NormalizeEmail } from './normalize-email.decorator';

export class ConfirmOtpDto {
  @IsEmail()
  @NormalizeEmail()
  email: string;

  @IsString()
  code: string;
}
