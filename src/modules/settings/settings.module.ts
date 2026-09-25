import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RbacModule } from '@/modules/rbac';
import { Setting } from './entities/setting.entity';
import { AuthSettingsController } from './auth-settings.controller';
import { AuthSettingsService } from './auth-settings.service';

// ConfigModule is @Global, so ConfigService needs no import here.
@Module({
  imports: [TypeOrmModule.forFeature([Setting]), RbacModule],
  controllers: [AuthSettingsController],
  providers: [AuthSettingsService],
  exports: [AuthSettingsService],
})
export class SettingsModule {}
