import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle, seconds } from '@nestjs/throttler';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login() {
    return { message: 'Not implemented yet' };
  }

  @Throttle({ default: { limit: 3, ttl: seconds(60) } })
  @Post('register')
  register() {
    return { message: 'Not implemented yet' };
  }
}
