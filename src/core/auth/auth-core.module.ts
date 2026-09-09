import { Module } from '@nestjs/common';
import { JwtModule as NestJwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { ConfigModule } from '@/core/config/config.module';
import { ConfigService } from '@/core/config/config.service';
import { UsersModule } from '@/modules/users/users.module';

import { JwtStrategy } from './jwt.strategy';
import { TokenService } from './services/token.service';

@Module({
  imports: [
    PassportModule,
    UsersModule,
    NestJwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
      }),
    }),
  ],
  providers: [JwtStrategy, TokenService],
  exports: [NestJwtModule, PassportModule, TokenService],
})
export class AuthCoreModule {}
