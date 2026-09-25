import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { ConfigService } from '@/core/config/config.service';
import { Setting } from './entities/setting.entity';
import {
  AUTH_SETTING_DEFINITIONS,
  AUTH_SETTING_KEYS,
  AuthSettingKey,
  AuthSettings,
  isAuthSettingValue,
} from './auth-settings.registry';
import { UpdateAuthSettingsDto } from './dto/auth-settings.dto';

@Injectable()
export class AuthSettingsService {
  private readonly logger = new Logger(AuthSettingsService.name);

  constructor(
    @InjectRepository(Setting) private readonly settings: Repository<Setting>,
    private readonly config: ConfigService,
  ) {}

  async getEffectiveSettings(): Promise<AuthSettings> {
    const rows = await this.settings.find({
      where: { key: In(AUTH_SETTING_KEYS) },
    });
    const stored = new Map(rows.map((row) => [row.key, row.value]));
    const result = {} as Record<AuthSettingKey, unknown>;
    for (const key of AUTH_SETTING_KEYS) {
      const value = stored.has(key) ? stored.get(key) : this.fromEnv(key);
      if (!isAuthSettingValue(key, value)) {
        throw new InternalServerErrorException(
          `Invalid configuration for ${key}`,
        );
      }
      result[key] = value;
    }
    return result as AuthSettings;
  }

  private fromEnv(key: AuthSettingKey): unknown {
    const { env, kind, fallback } = AUTH_SETTING_DEFINITIONS[key];
    const raw = this.config.get(env);
    if (raw === undefined) return fallback;
    return kind === 'boolean' ? String(raw) === 'true' : raw;
  }

  @Transactional()
  async updateSettings(
    dto: UpdateAuthSettingsDto,
    actorUserId: string,
  ): Promise<AuthSettings> {
    const entries = Object.entries(dto).filter(
      ([, value]) => value !== undefined,
    ) as Array<[AuthSettingKey, string | boolean | null]>;

    if (!entries.length) {
      throw new BadRequestException('Provide at least one auth setting');
    }

    for (const [key, value] of entries) {
      if (value === null) {
        await this.settings.delete({ key });
      } else {
        await this.settings.upsert({ key, value }, ['key']);
      }
    }

    this.logger.log({
      event: 'settings.auth.updated',
      actorUserId,
      changes: dto,
    });
    return this.getEffectiveSettings();
  }
}
