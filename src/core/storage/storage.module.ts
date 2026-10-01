import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { ConfigService } from '../config/config.service';
import { S3Client } from '@aws-sdk/client-s3';
import { S3StorageService } from './drivers/s3-storage.service';
import { LocalStorageService } from './drivers/local-storage.service';

@Module({
  providers: [
    {
      provide: StorageService,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageService => {
        if (config.get('STORAGE_DRIVER') !== 's3') {
          return new LocalStorageService(config.get('STORAGE_LOCAL_PATH'));
        }
        const accessKeyId = config.get('STORAGE_S3_ACCESS_KEY_ID');
        const secretAccessKey = config.get('STORAGE_S3_SECRET_ACCESS_KEY');
        const client = new S3Client({
          region: config.get('STORAGE_S3_REGION'),
          endpoint: config.get('STORAGE_S3_ENDPOINT') || undefined,
          forcePathStyle:
            String(config.get('STORAGE_S3_FORCE_PATH_STYLE')) === 'true',
          credentials: accessKeyId
            ? { accessKeyId, secretAccessKey }
            : undefined,
        });
        return new S3StorageService(client, config.get('STORAGE_S3_BUCKET'));
      },
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
