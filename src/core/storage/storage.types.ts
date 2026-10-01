import { Readable } from 'stream';

export interface PutObjectMeta {
  contentType: string;
  cacheControl?: string;
}
export interface StoredObject {
  stream: Readable;
  size: number;
}
