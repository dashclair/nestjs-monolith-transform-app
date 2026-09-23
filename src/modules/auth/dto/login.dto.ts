import { IsEmail, IsString } from 'class-validator';
import { NormalizeEmail } from '@/common/validation/normalize-email.decorator';

export class LoginDto {
  @IsEmail()
  @NormalizeEmail()
  email: string;

  @IsString()
  password: string;
}
