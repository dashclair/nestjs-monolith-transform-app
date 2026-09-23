import { BadRequestException, ValidationPipe } from '@nestjs/common';

import {
  ListUsersQueryDto,
  SortOrder,
  UserSortField,
} from '../dto/list-users.dto';

// Same options as the global pipe in `main.ts` — query params arrive as
// strings, so implicit conversion and `forbidNonWhitelisted` are part of the
// contract being tested here, not incidental.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const validate = (query: Record<string, string>): Promise<ListUsersQueryDto> =>
  pipe.transform(query, { type: 'query', metatype: ListUsersQueryDto });

describe('ListUsersQueryDto', () => {
  it('applies defaults when no params are passed', async () => {
    const dto = await validate({});

    // limit's default comes from config, applied in UsersService
    expect(dto.limit).toBeUndefined();
    expect(dto.sort).toBe(UserSortField.CreatedAt);
    expect(dto.order).toBe(SortOrder.Desc);
    expect(dto.cursor).toBeUndefined();
    expect(dto.q).toBeUndefined();
    expect(dto.status).toBeUndefined();
  });

  it('converts a string limit to a number', async () => {
    const dto = await validate({ limit: '50' });

    expect(dto.limit).toBe(50);
  });

  it('accepts every supported sort/order/status combination', async () => {
    const dto = await validate({
      sort: 'email',
      order: 'asc',
      status: 'deleted',
      q: 'ivan',
    });

    expect(dto).toMatchObject({
      sort: UserSortField.Email,
      order: SortOrder.Asc,
      status: 'deleted',
      q: 'ivan',
    });
  });

  it.each([
    // upper bound (USERS_LIST_MAX_LIMIT) is config-driven — see users.service.spec.ts
    ['limit=0', { limit: '0' }],
    ['non-numeric limit', { limit: 'abc' }],
    ['fractional limit', { limit: '1.5' }],
    ['status=blocked (not implemented)', { status: 'blocked' }],
    ['unknown sort field', { sort: 'last_login' }],
    ['unknown order', { order: 'random' }],
    ['q longer than 255 chars', { q: 'a'.repeat(256) }],
    ['unknown query param', { role: 'admin' }],
  ])('rejects %s with 400', async (_label, query) => {
    await expect(validate(query)).rejects.toThrow(BadRequestException);
  });
});
