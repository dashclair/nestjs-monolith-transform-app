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
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
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
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Throttle({ default: { limit: 10, ttl: seconds(60) } })
  @Post('login/confirm-otp')
  @HttpCode(HttpStatus.OK)
  async confirmLoginOtp(@Body() dto: ConfirmOtpDto) {
    return this.authService.confirmLoginOtp(dto.email, dto.code);
  }

  @Throttle({ default: { limit: 10, ttl: seconds(60) } })
  @Get('login/confirm-link')
  async confirmLoginLink(@Query() dto: ConfirmMagicLinkQueryDto) {
    return this.authService.confirmLoginMagicLink(dto.email, dto.token);
  }

  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  @Post('login/resend')
  @HttpCode(HttpStatus.OK)
  async resendLogin(@Body() dto: ResendConfirmationDto) {
    return this.authService.resendLoginConfirmation(dto.email);
  }

  @Throttle({ default: { limit: 20, ttl: seconds(60) } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
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
