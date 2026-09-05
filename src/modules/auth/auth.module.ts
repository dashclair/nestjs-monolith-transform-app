import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailVerification } from './entities/email-verification.entity';

@Module({
  imports: [TypeOrmModule.forFeature([EmailVerification])],
  controllers: [AuthController],
  exports: [TypeOrmModule],
})
export class AuthModule {}
