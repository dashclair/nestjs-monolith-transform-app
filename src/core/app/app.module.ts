import { ClassSerializerInterceptor, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';

import { AuthCoreModule } from '@/core/auth/auth-core.module';
import { JwtAuthGuard } from '@/core/auth/jwt-auth.guard';
import { ConfigModule } from '@/core/config/config.module';
import { DatabaseModule } from '@/core/database/database.module';
import { AllExceptionsFilter } from '@/core/error-handling/all-exceptions.filter';
import { TestErrorsController } from '@/core/error-handling/test-errors.controller';
import { HealthModule } from '@/core/health/health.module';
import { ThrottlerModule } from '@/core/throttler/throttler.module';

/**
 *
 * Application modules
 *
 */
import { AuthModule } from '@/modules/auth/auth.module';
import { UsersModule } from '@/modules/users/users.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    ThrottlerModule,
    AuthCoreModule,
    /**
     *
     * Application modules
     *
     */
    AuthModule,
    UsersModule,
  ],
  controllers: [TestErrorsController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ClassSerializerInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
