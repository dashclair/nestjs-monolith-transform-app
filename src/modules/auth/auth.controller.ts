import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle, seconds } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Public } from '@/core/auth/public.decorator';

import { ConfirmMagicLinkQueryDto } from './dto/confirm-magic-link.query.dto';
import { ConfirmOtpDto } from './dto/confirm-otp.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';
import { AuthService } from './services/auth.service';

import { setAuthCookies } from '@/core/auth/cookie.util';
import { TokenPair } from '@/core/auth/services/token.service';
import { ConfigService } from '@/core/config/config.service';
import type { StringValue } from 'ms';

@ApiTags('Auth')
@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService
  ) { }

  private applyAuthCookies(response: FastifyReply, tokens: TokenPair): void {
    setAuthCookies(response, tokens, {
      secure: String(this.configService.get('COOKIE_SECURE')) === 'true',
      sameSite: this.configService.get('COOKIE_SAMESITE') as 'lax' | 'strict' | 'none',
      accessTtl: this.configService.get('JWT_ACCESS_TTL') as StringValue,
      refreshTtl: this.configService.get('JWT_REFRESH_TTL') as StringValue,
    });
  }

  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const result = await this.authService.login(dto);

    if ('requiresConfirmation' in result) {
      return result;
    }

    this.applyAuthCookies(response, result);
    return { success: true }
  }

  @Throttle({ default: { limit: 10, ttl: seconds(60) } })
  @Post('login/confirm-otp')
  @HttpCode(HttpStatus.OK)
  async confirmLoginOtp(
    @Body() dto: ConfirmOtpDto,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const tokens = await this.authService.confirmLoginOtp(dto.email, dto.code);

    this.applyAuthCookies(response, tokens)
    return { success: true }
  }

  @Throttle({ default: { limit: 10, ttl: seconds(60) } })
  @Get('login/confirm-link')
  async confirmLoginLink(
    @Query() dto: ConfirmMagicLinkQueryDto,
    @Res({ passthrough: true }) response: FastifyReply,) {
    const tokens = await this.authService.confirmLoginMagicLink(dto.email, dto.token);
    this.applyAuthCookies(response, tokens)

    return { success: true }
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
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const refreshToken = request.cookies?.refresh_token;
    if (!refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.authService.refresh(refreshToken);
    this.applyAuthCookies(response, tokens);
    return { success: true };
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

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) response: FastifyReply) {
    response.clearCookie('access_token', { path: '/' });
    response.clearCookie('refresh_token', { path: '/auth/refresh' });
    return { loggedOut: true };
  }
}
