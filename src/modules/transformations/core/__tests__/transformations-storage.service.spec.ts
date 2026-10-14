import { Logger } from '@nestjs/common';
import type { Repository } from 'typeorm';

import type { StorageService } from '@/core/storage/storage.service';
import { Transformation } from '@/modules/transformations/entities/transformation.entity';
import { TransformationsStorageService } from '../transformations-storage.service';
import type { ConversionResult } from '../types';

describe('TransformationsStorageService', () => {
  const STORAGE_KEY = 'transformations/user-1/transformation-1.csv';

  const history = (storageKey: string | null = STORAGE_KEY) =>
    Object.assign(new Transformation(), {
      id: 'transformation-1',
      userId: 'user-1',
      storageKey,
      fileStatus: storageKey === null ? null : 'pending',
    });
  const result: ConversionResult = {
    body: Buffer.from('a\n1\n'),
    mimeType: 'text/csv; charset=utf-8',
    extension: 'csv',
  };

  const repo = { update: vi.fn(() => Promise.resolve({ affected: 1 })) };
  const storage = { put: vi.fn(() => Promise.resolve()) };
  const service = new TransformationsStorageService(
    repo as unknown as Repository<Transformation>,
    storage as unknown as StorageService,
  );

  const log = vi.spyOn(Logger.prototype, 'log');
  const error = vi.spyOn(Logger.prototype, 'error');

  beforeEach(() => {
    vi.clearAllMocks();
    for (const spy of [log, error]) {
      spy.mockReset().mockImplementation(() => undefined);
    }
  });

  afterAll(() => {
    for (const spy of [log, error]) {
      spy.mockRestore();
    }
  });

  it('uploads under the row key and marks the row stored', async () => {
    await service.saveResult(history(), result);

    expect(storage.put).toHaveBeenCalledExactlyOnceWith(
      STORAGE_KEY,
      result.body,
      { contentType: 'text/csv; charset=utf-8' },
    );
    expect(repo.update).toHaveBeenCalledExactlyOnceWith(
      { id: 'transformation-1' },
      { fileStatus: 'stored' },
    );
  });

  it('logs the saved file without its contents', async () => {
    await service.saveResult(history(), result);

    expect(log).toHaveBeenCalledExactlyOnceWith({
      event: 'transformation.file.saved',
      userId: 'user-1',
      transformationId: 'transformation-1',
      storageKey: STORAGE_KEY,
      resultSize: 4,
      durationMs: expect.any(Number) as unknown,
      result: 'success',
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('marks the row failed and logs safe metadata when the upload fails', async () => {
    storage.put.mockRejectedValueOnce(new Error('secret bucket details'));

    await expect(
      service.saveResult(history(), result),
    ).resolves.toBeUndefined();

    expect(repo.update).toHaveBeenCalledExactlyOnceWith(
      { id: 'transformation-1' },
      { fileStatus: 'failed' },
    );
    expect(error).toHaveBeenCalledExactlyOnceWith({
      event: 'transformation.file.save_failed',
      userId: 'user-1',
      transformationId: 'transformation-1',
      storageKey: STORAGE_KEY,
      resultSize: 4,
      durationMs: expect.any(Number) as unknown,
      reason: 'storage_error',
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret');
    expect(log).not.toHaveBeenCalled();
  });

  it('marks the row failed when the stored update fails after the upload', async () => {
    repo.update.mockRejectedValueOnce(new Error('connection lost'));

    await service.saveResult(history(), result);

    expect(repo.update).toHaveBeenLastCalledWith(
      { id: 'transformation-1' },
      { fileStatus: 'failed' },
    );
    expect(error).toHaveBeenCalledOnce();
  });

  it('never rejects, even when marking the row failed also fails', async () => {
    storage.put.mockRejectedValueOnce(new Error('storage down'));
    repo.update.mockRejectedValueOnce(new Error('database down'));

    await expect(
      service.saveResult(history(), result),
    ).resolves.toBeUndefined();
  });

  it('does nothing for a row without a storage key', async () => {
    await service.saveResult(history(null), result);

    expect(storage.put).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });
});
