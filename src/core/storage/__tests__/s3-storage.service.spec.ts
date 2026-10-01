import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectCommandOutput,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';

import { S3StorageService } from '../drivers/s3-storage.service';
import { StorageNotFoundError } from '../storage.errors';

describe('S3StorageService', () => {
  const bucket = 'test-bucket';
  const s3Mock = mockClient(S3Client);
  let client: S3Client;
  let service: S3StorageService;

  const body = (data: string) =>
    Readable.from([
      Buffer.from(data),
    ]) as unknown as GetObjectCommandOutput['Body'];

  beforeEach(() => {
    s3Mock.reset();
    client = new S3Client({ region: 'us-east-1' });
    service = new S3StorageService(client, bucket);
  });

  afterAll(() => {
    s3Mock.restore();
  });

  describe('put', () => {
    it('sends PutObject with the bucket, key, body and metadata', async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      const data = Buffer.from('hello');

      await service.put('a/file.txt', data, {
        contentType: 'text/plain',
        cacheControl: 'max-age=60',
      });

      const calls = s3Mock.commandCalls(PutObjectCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input).toEqual({
        Bucket: bucket,
        Key: 'a/file.txt',
        Body: data,
        ContentType: 'text/plain',
        CacheControl: 'max-age=60',
      });
    });

    it('leaves CacheControl undefined when not provided', async () => {
      s3Mock.on(PutObjectCommand).resolves({});

      await service.put('k', Buffer.from('x'), { contentType: 'text/plain' });

      const [call] = s3Mock.commandCalls(PutObjectCommand);
      expect(call.args[0].input.CacheControl).toBeUndefined();
    });

    it('propagates SDK errors', async () => {
      s3Mock.on(PutObjectCommand).rejects(new Error('boom'));

      await expect(
        service.put('k', Buffer.from('x'), { contentType: 'text/plain' }),
      ).rejects.toThrow('boom');
    });
  });

  describe('get', () => {
    it('returns the body stream and content length', async () => {
      s3Mock
        .on(GetObjectCommand, { Bucket: bucket, Key: 'file.txt' })
        .resolves({ Body: body('hello world'), ContentLength: 11 });

      const { stream, size } = await service.get('file.txt');

      expect(size).toBe(11);
      expect((await buffer(stream)).toString()).toBe('hello world');
    });

    it('reports size 0 when ContentLength is missing', async () => {
      s3Mock.on(GetObjectCommand).resolves({ Body: body('') });

      const { stream, size } = await service.get('file.txt');

      expect(size).toBe(0);
      stream.destroy();
    });

    it('maps NoSuchKey to StorageNotFoundError', async () => {
      s3Mock
        .on(GetObjectCommand)
        .rejects(new NoSuchKey({ message: 'not found', $metadata: {} }));

      const error = await service.get('missing').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(StorageNotFoundError);
      expect(error).toMatchObject({ key: 'missing' });
    });

    it('throws StorageNotFoundError when the response has no body', async () => {
      s3Mock.on(GetObjectCommand).resolves({});

      await expect(service.get('k')).rejects.toBeInstanceOf(
        StorageNotFoundError,
      );
    });

    it('propagates other SDK errors unchanged', async () => {
      const accessDenied = new Error('denied');
      accessDenied.name = 'AccessDenied';
      s3Mock.on(GetObjectCommand).rejects(accessDenied);

      await expect(service.get('k')).rejects.toBe(accessDenied);
    });
  });

  describe('delete', () => {
    it('sends DeleteObject for the key', async () => {
      s3Mock.on(DeleteObjectCommand).resolves({});

      await service.delete('a/file.txt');

      const calls = s3Mock.commandCalls(DeleteObjectCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input).toEqual({
        Bucket: bucket,
        Key: 'a/file.txt',
      });
    });

    it('propagates SDK errors', async () => {
      s3Mock.on(DeleteObjectCommand).rejects(new Error('boom'));

      await expect(service.delete('k')).rejects.toThrow('boom');
    });
  });

  describe('lifecycle', () => {
    it('checks that the bucket exists on module init', async () => {
      s3Mock.on(HeadBucketCommand).resolves({});

      await service.onModuleInit();

      const calls = s3Mock.commandCalls(HeadBucketCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input).toEqual({ Bucket: bucket });
    });

    it('fails module init when the bucket is unreachable', async () => {
      const notFound = new Error('NotFound');
      notFound.name = 'NotFound';
      s3Mock.on(HeadBucketCommand).rejects(notFound);

      await expect(service.onModuleInit()).rejects.toBe(notFound);
    });

    it('destroys the client on module destroy', () => {
      const destroy = vi.spyOn(client, 'destroy');

      service.onModuleDestroy();

      expect(destroy).toHaveBeenCalledOnce();
    });
  });
});
