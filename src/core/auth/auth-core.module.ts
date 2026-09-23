import { Module } from '@nestjs/common';
import { JwtModule as NestJwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { ConfigModule } from '@/core/config/config.module';
import { ConfigService } from '@/core/config/config.service';

import { TokenService } from './services/token.service';

// JWT signing/verification infra only. The `'jwt'` passport strategy that
// `JwtAuthGuard` relies on is registered by `AuthModule` (`modules/auth`),
// since validating a token requires looking up the user.
@Module({
  imports: [
    PassportModule,
    NestJwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
      }),
    }),
  ],
  providers: [TokenService],
  exports: [NestJwtModule, PassportModule, TokenService],
})
export class AuthCoreModule {}
