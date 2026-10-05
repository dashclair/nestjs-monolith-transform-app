import { Logger } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { Transformation } from '@/modules/transformations/entities/transformation.entity';
import { TransformationHistoryService } from '../transformation-history.service';
import type { WriteTransformationInput } from '../transformation-history.service';

describe('TransformationHistoryService', () => {
  const input: WriteTransformationInput = {
    userId: 'user-1',
    type: 'file',
    sourceFormat: 'json',
    targetFormat: 'csv',
    status: 'success',
    errorCode: null,
    fileSize: 1250,
    durationMs: 20,
    options: null,
  };

  const repo = {
    create: vi.fn((data: WriteTransformationInput) =>
      Object.assign(new Transformation(), data),
    ),
    save: vi.fn((entry: Transformation) =>
      Promise.resolve(
        Object.assign(entry, {
          id: 'transformation-1',
          createdAt: new Date('2026-10-03T00:00:00Z'),
        }),
      ),
    ),
  };
  const service = new TransformationHistoryService(
    repo as unknown as Repository<Transformation>,
  );

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('writes a success entry and returns its generated id', async () => {
    const entry = await service.write(input);
    expect(entry).toMatchObject({ ...input, id: 'transformation-1' });
    expect(repo.create).toHaveBeenCalledWith(input);
  });

  it('writes an error entry with unknown formats stored as null', async () => {
    const errorInput: WriteTransformationInput = {
      ...input,
      sourceFormat: null,
      targetFormat: null,
      status: 'error',
      errorCode: 'UNSUPPORTED_FORMAT',
    };
    expect(await service.write(errorInput)).toMatchObject(errorInput);
  });

  it('returns null and logs safe metadata when the database write fails', async () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    repo.save.mockRejectedValueOnce(
      new Error('SQL parameters may contain private content'),
    );

    await expect(service.write(input)).resolves.toBeNull();
    expect(log).toHaveBeenCalledExactlyOnceWith({
      event: 'transformation.history.write_failed',
      userId: input.userId,
      type: 'file',
      status: 'success',
      errorCode: null,
    });
  });
});
