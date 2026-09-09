import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle, seconds } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';

import { Public } from '@/core/auth/public.decorator';

import { ConfirmMagicLinkQueryDto } from './dto/confirm-magic-link.query.dto';
import { ConfirmOtpDto } from './dto/confirm-otp.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';
import { AuthService } from './services/auth.service';

@ApiTags('Auth')
@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login() {
    return { message: 'Not implemented yet' };
  }

  @Throttle({ default: { limit: 3, ttl: seconds(60) } })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const result = await this.authService.register(dto.email, dto.password);

    response.status(
      'requiresConfirmation' in result ? HttpStatus.OK : HttpStatus.CREATED,
    );

    return result;
  }

  @Throttle({ default: { limit: 10, ttl: seconds(60) } })
  @Post('register/confirm-otp')
  @HttpCode(HttpStatus.OK)
  async confirmOtp(@Body() dto: ConfirmOtpDto) {
    return this.authService.confirmOtp(dto.email, dto.code);
  }

  @Throttle({ default: { limit: 10, ttl: seconds(60) } })
  @Get('register/confirm-link')
  async confirmLink(@Query() dto: ConfirmMagicLinkQueryDto) {
    return this.authService.confirmMagicLink(dto.email, dto.token);
  }

  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  @Post('register/resend')
  @HttpCode(HttpStatus.OK)
  async resend(@Body() dto: ResendConfirmationDto) {
    return this.authService.resend(dto.email);
  }
}
