import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { isUUID } from 'class-validator';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';

import { User } from '../entities/user.entity';
import {
  ListUsersQueryDto,
  ListUsersResponseDto,
  SortOrder,
  UserListItemDto,
  UserSortField,
  UserStatus,
} from '../dto/list-users.dto';
import {
  decodeUsersCursor,
  encodeUsersCursor,
} from '../utils/users-list-cursor';

const SORT_COLUMNS = {
  [UserSortField.CreatedAt]: 'user.createdAt',
  [UserSortField.Email]: 'user.email',
} satisfies Record<UserSortField, string>;

@Injectable()
export class UsersListService {
  private readonly logger = new Logger(UsersListService.name);

  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  async getUsersList(
    query: ListUsersQueryDto,
    actorUserId: string,
  ): Promise<ListUsersResponseDto> {
    const limit = this.resolveListLimit(query.limit);

    const qb = this.repo
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.email',
        'user.photo',
        'user.createdAt',
        'user.deletedAt',
      ]);

    this.applySearch(qb, query.q);
    this.applyStatusFilter(qb, query.status);
    this.applySorting(qb, query.sort, query.order);
    this.applyCursor(qb, query);

    // limit + 1 — the extra row only signals that a next page exists
    const users = await qb.take(limit + 1).getMany();

    const hasNextPage = users.length > limit;

    const items = hasNextPage ? users.slice(0, limit) : users;

    const lastUser = items.at(-1);

    this.logger.log({
      event: 'users.list.viewed',
      actorUserId,
      hasSearchQuery: Boolean(query.q),
      status: query.status ?? null,
      sort: query.sort,
      order: query.order,
      limit,
      hasCursor: Boolean(query.cursor),
      resultCount: items.length,
      result: 200,
    });

    return {
      items: items.map((user) => this.toListItem(user)),
      nextCursor:
        hasNextPage && lastUser
          ? encodeUsersCursor({
              value:
                query.sort === UserSortField.Email
                  ? lastUser.email
                  : lastUser.createdAt.toISOString(),
              id: lastUser.id,
              sort: query.sort,
              order: query.order,
            })
          : null,
    };
  }

  private resolveListLimit(limit?: number): number {
    const maxLimit = Number(this.configService.get('USERS_LIST_MAX_LIMIT'));

    if (limit === undefined) {
      return Number(this.configService.get('USERS_LIST_DEFAULT_LIMIT'));
    }

    if (limit > maxLimit) {
      throw new BadRequestException(
        `limit must not be greater than ${maxLimit}`,
      );
    }

    return limit;
  }

  private applySearch(qb: SelectQueryBuilder<User>, q?: string): void {
    if (!q) {
      return;
    }

    if (isUUID(q)) {
      qb.andWhere('user.id = :id', { id: q });
      return;
    }

    const escaped = q.replace(/[\\%_]/g, '\\$&');
    qb.andWhere('user.email ILIKE :q', { q: `%${escaped}%` });
  }

  private applyStatusFilter(
    qb: SelectQueryBuilder<User>,
    status?: UserStatus,
  ): void {
    if (!status) {
      return;
    }

    switch (status) {
      case UserStatus.Active:
        qb.andWhere('user.deletedAt IS NULL');
        break;

      case UserStatus.Deleted:
        qb.andWhere('user.deletedAt IS NOT NULL');
        break;
    }
  }

  private applySorting(
    qb: SelectQueryBuilder<User>,
    sort: UserSortField,
    order: SortOrder,
  ): void {
    const direction = order === SortOrder.Asc ? 'ASC' : 'DESC';

    qb.orderBy(SORT_COLUMNS[sort], direction);
    qb.addOrderBy('user.id', direction);
  }

  private applyCursor(
    qb: SelectQueryBuilder<User>,
    query: ListUsersQueryDto,
  ): void {
    if (!query.cursor) {
      return;
    }

    const { value, id } = decodeUsersCursor(
      query.cursor,
      query.sort,
      query.order,
    );
    const operator = query.order === SortOrder.Asc ? '>' : '<';

    qb.andWhere(
      `(${SORT_COLUMNS[query.sort]}, user.id) ${operator} (:value, :id)`,
      { value, id },
    );
  }

  private toListItem(user: User): UserListItemDto {
    return plainToInstance(
      UserListItemDto,
      {
        ...user,
        status: user.deletedAt ? UserStatus.Deleted : UserStatus.Active,
      },
      { excludeExtraneousValues: true },
    );
  }
}
