import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { StorageService } from '../storage.service';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PutObjectMeta, StoredObject } from '../storage.types';
import { StorageNotFoundError } from '../storage.errors';
import { Readable } from 'stream';

export class S3StorageService
  extends StorageService
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {
    super();
  }

  async put(key: string, body: Buffer, meta: PutObjectMeta) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: meta.contentType,
        CacheControl: meta.cacheControl,
      }),
    );
  }

  async get(key: string): Promise<StoredObject> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );

      if (!response.Body) {
        throw new StorageNotFoundError(key);
      }

      return {
        stream: response.Body as Readable,
        size: response.ContentLength ?? 0,
      };
    } catch (error) {
      if (error instanceof NoSuchKey) throw new StorageNotFoundError(key);
      throw error;
    }
  }

  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }
  async onModuleInit() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  onModuleDestroy() {
    this.client.destroy();
  }
}
