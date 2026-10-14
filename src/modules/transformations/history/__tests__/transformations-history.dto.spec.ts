import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { TransformationHistoryQueryDto } from '../dto/transformations-history.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const validate = (
  query: Record<string, string>,
): Promise<TransformationHistoryQueryDto> =>
  pipe.transform(query, {
    type: 'query',
    metatype: TransformationHistoryQueryDto,
  });

describe('TransformationHistoryQueryDto', () => {
  it('applies defaults when no params are passed', async () => {
    const dto = await validate({});

    expect(dto.limit).toBe(20);
    expect(dto.cursor).toBeUndefined();
    expect(dto.type).toBeUndefined();
    expect(dto.sourceFormat).toBeUndefined();
    expect(dto.targetFormat).toBeUndefined();
    expect(dto.status).toBeUndefined();
    expect(dto.createdAtFrom).toBeUndefined();
    expect(dto.createdAtTo).toBeUndefined();
  });

  it('converts a string limit to a number', async () => {
    const dto = await validate({ limit: '50' });

    expect(dto.limit).toBe(50);
  });

  it('accepts limit at the bounds', async () => {
    await expect(validate({ limit: '1' })).resolves.toMatchObject({
      limit: 1,
    });
    await expect(validate({ limit: '100' })).resolves.toMatchObject({
      limit: 100,
    });
  });

  it('accepts every filter together', async () => {
    const dto = await validate({
      cursor: 'abc',
      type: 'image',
      sourceFormat: 'svg',
      targetFormat: 'png',
      status: 'error',
      createdAtFrom: '2026-10-01',
      createdAtTo: '2026-10-12T10:00:00+03:00',
    });

    expect(dto).toMatchObject({
      cursor: 'abc',
      type: 'image',
      sourceFormat: 'svg',
      targetFormat: 'png',
      status: 'error',
      createdAtFrom: '2026-10-01',
      createdAtTo: '2026-10-12T10:00:00+03:00',
    });
  });

  it.each(['csv', 'json', 'xml', 'yaml', 'png', 'jpeg', 'svg'])(
    'accepts format %s in both format filters',
    async (format) => {
      await expect(
        validate({ sourceFormat: format, targetFormat: format }),
      ).resolves.toMatchObject({ sourceFormat: format, targetFormat: format });
    },
  );

  it.each([
    ['limit=0', { limit: '0' }],
    ['limit above 100', { limit: '101' }],
    ['non-numeric limit', { limit: 'abc' }],
    ['fractional limit', { limit: '1.5' }],
    ['unknown type', { type: 'video' }],
    ['unknown sourceFormat', { sourceFormat: 'pdf' }],
    ['unknown targetFormat', { targetFormat: 'gif' }],
    ['unknown status', { status: 'pending' }],
    ['a non-ISO date', { createdAtFrom: '10/01/2026' }],
    ['a free-form date', { createdAtFrom: 'yesterday' }],
    ['an impossible date', { createdAtTo: '2026-02-30' }],
    ['an ISO week date', { createdAtFrom: '2026-W41' }],
    ['an ISO ordinal date', { createdAtTo: '2026-285' }],
    ['an unknown query param', { userId: 'someone-else' }],
  ])('rejects %s with 400', async (_label, query) => {
    await expect(validate(query)).rejects.toThrow(BadRequestException);
  });
});
