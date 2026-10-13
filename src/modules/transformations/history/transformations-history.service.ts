import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { isUUID } from 'class-validator';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';
import {
  applyKeysetCursor,
  applyKeysetSorting,
  decodeCursor,
  encodeCursor,
  fetchKeysetPage,
  isIsoTimestamp,
  KeysetCursor,
  SortDirection,
} from '@/core/database/keyset-pagination';

import { Transformation } from '../entities/transformation.entity';
import {
  TransformationHistoryItemDto,
  TransformationHistoryQueryDto,
  TransformationHistoryResponseDto,
} from './transformations-history.dto';
import { User } from '@/modules/users/entities/user.entity';

const SORT_COLUMN = 'transformation.createdAt';
const ID_COLUMN = 'transformation.id';
const DIRECTION: SortDirection = 'DESC';
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TransformationsHistoryService {
  private readonly logger = new Logger(TransformationsHistoryService.name);

  constructor(
    @InjectRepository(Transformation)
    private readonly repo: Repository<Transformation>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  async getTransformationHistory(
    query: TransformationHistoryQueryDto,
    userId: string,
    actorUserId: string = userId,
  ): Promise<TransformationHistoryResponseDto> {
    this.assertDateRange(query);

    const cursor = query.cursor ? this.decodeHistoryCursor(query.cursor) : null;

    const qb = this.repo
      .createQueryBuilder('transformation')
      .select([
        'transformation.id',
        'transformation.type',
        'transformation.sourceFormat',
        'transformation.targetFormat',
        'transformation.status',
        'transformation.errorCode',
        'transformation.fileSize',
        'transformation.durationMs',
        'transformation.createdAt',
      ])
      .where('transformation.userId = :userId', { userId })
      .andWhere('transformation.createdAt >= :retentionCutoff', {
        retentionCutoff: this.retentionCutoff(),
      });

    this.applyFilters(qb, query);
    applyKeysetSorting(qb, SORT_COLUMN, ID_COLUMN, DIRECTION);

    if (cursor) {
      applyKeysetCursor(qb, SORT_COLUMN, ID_COLUMN, DIRECTION, cursor);
    }

    const { items, hasNextPage } = await fetchKeysetPage(qb, query.limit);

    const last = items.at(-1);

    this.logger.log({
      ...this.describeRequest(query, userId, actorUserId),
      resultCount: items.length,
      result: 200,
    });

    return {
      items: items.map((transformation) => this.toHistoryItem(transformation)),
      nextCursor:
        hasNextPage && last
          ? encodeCursor({
              value: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  async getTransformationHistoryByAdmin(
    query: TransformationHistoryQueryDto,
    userId: string,
    actorUserId: string,
  ): Promise<TransformationHistoryResponseDto> {
    const userExists = await this.userRepo.existsBy({ id: userId });

    if (!userExists) {
      this.logger.log({
        ...this.describeRequest(query, userId, actorUserId),
        result: 404,
      });
      throw new NotFoundException('User not found');
    }

    return this.getTransformationHistory(query, userId, actorUserId);
  }

  private describeRequest(
    query: TransformationHistoryQueryDto,
    targetUserId: string,
    actorUserId: string,
  ) {
    return {
      event: 'transformations.history.viewed',
      actorUserId,
      targetUserId,
      type: query.type ?? null,
      status: query.status ?? null,
      sourceFormat: query.sourceFormat ?? null,
      targetFormat: query.targetFormat ?? null,
      hasDateRange: Boolean(query.createdAtFrom || query.createdAtTo),
      limit: query.limit,
      hasCursor: Boolean(query.cursor),
    };
  }

  private assertDateRange(query: TransformationHistoryQueryDto): void {
    if (
      query.createdAtFrom &&
      query.createdAtTo &&
      new Date(query.createdAtFrom) > new Date(query.createdAtTo)
    ) {
      throw new BadRequestException('createdAtFrom must be before createdAtTo');
    }
  }

  private decodeHistoryCursor(cursor: string): KeysetCursor {
    return decodeCursor<KeysetCursor>(
      cursor,
      (parsed) =>
        typeof parsed?.value === 'string' &&
        typeof parsed.id === 'string' &&
        isUUID(parsed.id) &&
        isIsoTimestamp(parsed.value),
    );
  }

  private retentionCutoff(): Date {
    const days = Number(
      this.configService.get('TRANSFORMATIONS_RETENTION_DAYS'),
    );

    return new Date(Date.now() - days * DAY_MS);
  }

  private applyFilters(
    qb: SelectQueryBuilder<Transformation>,
    query: TransformationHistoryQueryDto,
  ): void {
    if (query.type) {
      qb.andWhere('transformation.type = :type', { type: query.type });
    }

    if (query.sourceFormat) {
      qb.andWhere('transformation.sourceFormat = :sourceFormat', {
        sourceFormat: query.sourceFormat,
      });
    }

    if (query.targetFormat) {
      qb.andWhere('transformation.targetFormat = :targetFormat', {
        targetFormat: query.targetFormat,
      });
    }

    if (query.status) {
      qb.andWhere('transformation.status = :status', { status: query.status });
    }

    if (query.createdAtFrom) {
      qb.andWhere('transformation.createdAt >= :createdAtFrom', {
        createdAtFrom: new Date(query.createdAtFrom),
      });
    }

    if (query.createdAtTo) {
      qb.andWhere('transformation.createdAt < :createdAtTo', {
        createdAtTo: new Date(query.createdAtTo),
      });
    }
  }

  private toHistoryItem(
    transformation: Transformation,
  ): TransformationHistoryItemDto {
    return plainToInstance(
      TransformationHistoryItemDto,
      {
        ...transformation,
        errorCode: transformation.errorCode ?? undefined,
        fileAvailable: false,
      },
      { excludeExtraneousValues: true, exposeUnsetFields: false },
    );
  }
}
