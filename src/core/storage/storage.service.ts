import { PutObjectMeta, StoredObject } from './storage.types';

export abstract class StorageService {
  abstract put(key: string, body: Buffer, meta: PutObjectMeta): Promise<void>;
  abstract get(key: string): Promise<StoredObject>; // throws StorageNotFoundError
  abstract delete(key: string): Promise<void>; // idempotent
}
