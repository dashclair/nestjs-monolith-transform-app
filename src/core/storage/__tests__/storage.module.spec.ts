import path from 'node:path';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Test } from '@nestjs/testing';
import { mockClient } from 'aws-sdk-client-mock';

import { ConfigService } from '@/core/config/config.service';

import { LocalStorageService } from '../drivers/local-storage.service';
import { S3StorageService } from '../drivers/s3-storage.service';
import { StorageModule } from '../storage.module';
import { StorageService } from '../storage.service';

describe('StorageModule', () => {
  const s3Mock = mockClient(S3Client);

  const s3Config: Record<string, string> = {
    STORAGE_DRIVER: 's3',
    STORAGE_S3_BUCKET: 'prism-files',
    STORAGE_S3_REGION: 'eu-central-1',
    STORAGE_S3_ENDPOINT: 'http://localhost:9000',
    STORAGE_S3_FORCE_PATH_STYLE: 'true',
    STORAGE_S3_ACCESS_KEY_ID: 'key-id',
    STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
  };

  // compile() does not run onModuleInit, so no HeadBucket call is made here.
  const resolveStorage = async (values: Record<string, string | undefined>) => {
    const config = { get: vi.fn((key: string) => values[key]) };
    const module = await Test.createTestingModule({ imports: [StorageModule] })
      .useMocker((token) => (token === ConfigService ? config : undefined))
      .compile();
    return module.get(StorageService);
  };

  beforeEach(() => {
    s3Mock.reset();
  });

  afterAll(() => {
    s3Mock.restore();
  });

  describe('local driver', () => {
    it('is used when STORAGE_DRIVER is "local"', async () => {
      const storage = await resolveStorage({
        STORAGE_DRIVER: 'local',
        STORAGE_LOCAL_PATH: './storage',
      });

      expect(storage).toBeInstanceOf(LocalStorageService);
      expect((storage as LocalStorageService)['root']).toBe(
        path.resolve('./storage'),
      );
    });

    it('is used when STORAGE_DRIVER is not set', async () => {
      const storage = await resolveStorage({ STORAGE_LOCAL_PATH: './storage' });

      expect(storage).toBeInstanceOf(LocalStorageService);
    });
  });

  describe('s3 driver', () => {
    it('is used when STORAGE_DRIVER is "s3"', async () => {
      const storage = await resolveStorage(s3Config);

      expect(storage).toBeInstanceOf(S3StorageService);
    });

    it('configures the client from STORAGE_S3_* settings', async () => {
      const storage = await resolveStorage(s3Config);
      const client = (storage as S3StorageService)['client'];

      await expect(client.config.region()).resolves.toBe('eu-central-1');
      expect(client.config.forcePathStyle).toBe(true);
      await expect(client.config.credentials()).resolves.toMatchObject({
        accessKeyId: 'key-id',
        secretAccessKey: 'secret',
      });
      const endpoint = await client.config.endpoint?.();
      expect(endpoint).toMatchObject({
        hostname: 'localhost',
        port: 9000,
        protocol: 'http:',
      });
    });

    it('targets the configured bucket', async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      const storage = await resolveStorage(s3Config);

      await storage.put('k', Buffer.from('x'), { contentType: 'text/plain' });

      const [call] = s3Mock.commandCalls(PutObjectCommand);
      expect(call.args[0].input.Bucket).toBe('prism-files');
    });

    it('treats a non-"true" STORAGE_S3_FORCE_PATH_STYLE as false', async () => {
      const storage = await resolveStorage({
        ...s3Config,
        STORAGE_S3_FORCE_PATH_STYLE: 'false',
      });

      expect(
        (storage as S3StorageService)['client'].config.forcePathStyle,
      ).toBe(false);
    });

    it('leaves the endpoint unset when STORAGE_S3_ENDPOINT is empty', async () => {
      const storage = await resolveStorage({
        ...s3Config,
        STORAGE_S3_ENDPOINT: '',
      });

      expect(
        (storage as S3StorageService)['client'].config.endpoint,
      ).toBeUndefined();
    });
  });
});
