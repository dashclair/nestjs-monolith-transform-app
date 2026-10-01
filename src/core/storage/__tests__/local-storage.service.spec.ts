import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buffer } from 'node:stream/consumers';

import { LocalStorageService } from '../drivers/local-storage.service';
import { StorageNotFoundError } from '../storage.errors';
import { StorageService } from '../storage.service';

describe('LocalStorageService', () => {
  const meta = { contentType: 'application/octet-stream' };
  let root: string;
  // Typed as the abstract contract, which is how consumers call it.
  let service: StorageService;

  const read = async (key: string) => {
    const { stream, size } = await service.get(key);
    return { body: await buffer(stream), size };
  };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'local-storage-spec-'));
    service = new LocalStorageService(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  });

  describe('put / get', () => {
    it('round-trips the stored bytes and reports their size', async () => {
      const body = Buffer.from('hello world');

      await service.put('file.txt', body, meta);

      await expect(read('file.txt')).resolves.toEqual({ body, size: 11 });
    });

    it('creates missing parent directories for nested keys', async () => {
      await service.put('a/b/c/file.bin', Buffer.from([1, 2, 3]), meta);

      const { body } = await read('a/b/c/file.bin');
      expect([...body]).toEqual([1, 2, 3]);
    });

    it('overwrites an existing object', async () => {
      await service.put('file.txt', Buffer.from('old content'), meta);
      await service.put('file.txt', Buffer.from('new'), meta);

      const { body, size } = await read('file.txt');
      expect(body.toString()).toBe('new');
      expect(size).toBe(3);
    });

    it('stores an empty body', async () => {
      await service.put('empty', Buffer.alloc(0), meta);

      await expect(read('empty')).resolves.toEqual({
        body: Buffer.alloc(0),
        size: 0,
      });
    });

    it('leaves no temp files behind after a successful write', async () => {
      await service.put('dir/file.txt', Buffer.from('x'), meta);

      expect(await readdir(path.join(root, 'dir'))).toEqual(['file.txt']);
    });

    it('removes the temp file when the final rename fails', async () => {
      // A directory sits where the file should go, so rename() fails.
      await service.put('target/inner.txt', Buffer.from('x'), meta);

      await expect(
        service.put('target', Buffer.from('y'), meta),
      ).rejects.toThrow();
      expect(await readdir(root)).toEqual(['target']);
    });
  });

  describe('get', () => {
    it('throws StorageNotFoundError for a missing key', async () => {
      const error = await service.get('missing.txt').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(StorageNotFoundError);
      expect(error).toMatchObject({ key: 'missing.txt' });
    });

    it('throws StorageNotFoundError when a parent directory is missing', async () => {
      await expect(service.get('no/such/dir/file')).rejects.toBeInstanceOf(
        StorageNotFoundError,
      );
    });
  });

  describe('delete', () => {
    it('removes a stored object', async () => {
      await service.put('file.txt', Buffer.from('x'), meta);

      await service.delete('file.txt');

      await expect(service.get('file.txt')).rejects.toBeInstanceOf(
        StorageNotFoundError,
      );
    });

    it('is idempotent for a missing key', async () => {
      await expect(service.delete('missing.txt')).resolves.toBeUndefined();
    });
  });

  describe('key validation', () => {
    const escaping = ['../escape.txt', 'a/../../escape.txt', '.', 'a/..'];

    it.each(escaping)('rejects key %j that escapes the root', async (key) => {
      await expect(service.put(key, Buffer.from('x'), meta)).rejects.toThrow(
        /escapes root/,
      );
      await expect(service.get(key)).rejects.toThrow(/escapes root/);
      await expect(service.delete(key)).rejects.toThrow(/escapes root/);
    });

    it('rejects an absolute path outside the root', async () => {
      const outside = path.join(tmpdir(), 'outside.txt');

      await expect(service.get(outside)).rejects.toThrow(/escapes root/);
    });

    it('does not let a sibling directory with a shared prefix pass', async () => {
      // `<root>-evil` starts with `<root>` but is outside it.
      const sibling = `../${path.basename(root)}-evil/file.txt`;

      await expect(service.get(sibling)).rejects.toThrow(/escapes root/);
    });

    it.each(['', 'a\0b'])('rejects invalid key %j', async (key) => {
      await expect(service.get(key)).rejects.toThrow(/Invalid storage key/);
    });

    it('allows ".." segments that stay inside the root', async () => {
      await service.put('a/../file.txt', Buffer.from('x'), meta);

      const { body } = await read('file.txt');
      expect(body.toString()).toBe('x');
    });

    it('never touches files outside the root on delete', async () => {
      const outside = path.join(path.dirname(root), 'keep-me.txt');
      await writeFile(outside, 'x');
      try {
        await expect(service.delete('../keep-me.txt')).rejects.toThrow();
        expect(await readdir(path.dirname(root))).toContain('keep-me.txt');
      } finally {
        await rm(outside, { force: true });
      }
    });
  });

  it('resolves a relative root against the working directory', () => {
    const relative = new LocalStorageService('./some-storage');

    expect(relative['root']).toBe(path.resolve('./some-storage'));
  });
});
