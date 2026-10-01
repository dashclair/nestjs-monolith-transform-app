import { randomUUID } from 'node:crypto';
import {
  type FileHandle,
  mkdir,
  open,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { StorageService } from '../storage.service';
import { StorageNotFoundError } from '../storage.errors';
import { StoredObject } from '../storage.types';

export class LocalStorageService extends StorageService {
  private readonly root: string;

  constructor(root: string) {
    super();
    this.root = path.resolve(root);
  }

  // PutObjectMeta is ignored: the local filesystem has nowhere to keep it.
  async put(key: string, body: Buffer): Promise<void> {
    const filePath = this.resolvePath(key);
    await mkdir(path.dirname(filePath), { recursive: true });

    // Write to a temp file and rename so readers never see a partial object.
    const tempPath = `${filePath}.tmp-${randomUUID()}`;
    try {
      await writeFile(tempPath, body);
      await rename(tempPath, filePath);
    } catch (err) {
      await rm(tempPath, { force: true });
      throw err;
    }
  }

  async get(key: string): Promise<StoredObject> {
    const filePath = this.resolvePath(key);

    // Open first and stat the handle, so size and stream refer to the same file.
    let handle: FileHandle;
    try {
      handle = await open(filePath, 'r');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StorageNotFoundError(key);
      }
      throw err;
    }

    try {
      const { size } = await handle.stat();
      return { stream: handle.createReadStream(), size };
    } catch (err) {
      await handle.close();
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolvePath(key), { force: true });
  }

  private resolvePath(key: string): string {
    if (!key || key.includes('\0')) {
      throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
    }

    const filePath = path.resolve(this.root, key);
    const relative = path.relative(this.root, filePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Storage key escapes root: ${JSON.stringify(key)}`);
    }
    return filePath;
  }
}
