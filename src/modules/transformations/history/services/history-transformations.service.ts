import { extname } from 'path';

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { isUUID } from 'class-validator';
import { MoreThanOrEqual, Repository, SelectQueryBuilder } from 'typeorm';

import { attachmentDisposition } from '@/common/http/content-disposition';
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

import { Transformation } from '../../entities/transformation.entity';
import {
  TransformationHistoryItemDto,
  TransformationHistoryQueryDto,
  TransformationHistoryResponseDto,
} from '../dto/transformations-history.dto';
import { retentionCutoff } from '../utils/retention.utils';
import { User } from '@/modules/users/entities/user.entity';
import { TransformationsStorageService } from '../../core/transformations-storage.service';
import { StorageNotFoundError } from '@/core/storage/storage.errors';
import { StoredObject } from '@/core/storage/storage.types';

const SORT_COLUMN = 'transformation.createdAt';
const ID_COLUMN = 'transformation.id';
const DIRECTION: SortDirection = 'DESC';

@Injectable()
export class TransformationsHistoryService {
  private readonly logger = new Logger(TransformationsHistoryService.name);

  constructor(
    @InjectRepository(Transformation)
    private readonly repo: Repository<Transformation>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly configService: ConfigService,
    private readonly storageService: TransformationsStorageService,
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
        'transformation.fileStatus',
        'transformation.resultFileName',
      ])
      .where('transformation.userId = :userId', { userId })
      .andWhere('transformation.createdAt >= :retentionCutoff', {
        retentionCutoff: retentionCutoff(
          Number(this.configService.get('TRANSFORMATIONS_RETENTION_DAYS')),
        ),
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

  async downloadFile(
    itemId: string,
    userId: string,
    actorUserId: string,
  ): Promise<StreamableFile> {
    const startedAt = performance.now();
    const describe = (fields: Record<string, unknown>) => ({
      ...this.describeDownload(itemId, userId, actorUserId),
      ...fields,
      durationMs: Math.round(performance.now() - startedAt),
    });

    const transformation = await this.repo.findOneBy({
      id: itemId,
      userId,
      createdAt: MoreThanOrEqual(
        retentionCutoff(
          Number(this.configService.get('TRANSFORMATIONS_RETENTION_DAYS')),
        ),
      ),
    });

    if (!transformation) {
      this.logger.log(
        describe({
          event: 'transformation.file.download_failed',
          result: 404,
          reason: 'item_not_found',
        }),
      );
      throw new NotFoundException('Item not found');
    }

    const { storageKey } = transformation;

    if (transformation.fileStatus !== 'stored' || !storageKey) {
      this.logger.log(
        describe({
          event: 'transformation.file.download_failed',
          result: 404,
          reason: 'file_not_available',
          fileStatus: transformation.fileStatus,
        }),
      );
      throw new NotFoundException('Item not found');
    }

    let stored: StoredObject;

    try {
      stored = await this.storageService.downloadResult(storageKey);
    } catch (error) {
      if (error instanceof StorageNotFoundError) {
        this.logger.error(
          describe({
            event: 'transformation.file.missing',
            result: 404,
            storageKey,
          }),
        );
        throw new NotFoundException('Item not found');
      }

      this.logger.error(
        describe({
          event: 'transformation.file.download_failed',
          result: 500,
          reason: 'storage_error',
          storageKey,
        }),
      );
      throw error;
    }

    this.logger.log(
      describe({
        event: 'transformation.file.downloaded',
        result: 200,
        resultSize: stored.size,
      }),
    );

    return new StreamableFile(stored.stream, {
      type: transformation.resultMimeType ?? 'application/octet-stream',
      length: stored.size,
      disposition: attachmentDisposition(
        transformation.resultFileName ?? `converted${extname(storageKey)}`,
      ),
    });
  }

  async downloadFileByAdmin(
    itemId: string,
    userId: string,
    actorUserId: string,
  ): Promise<StreamableFile> {
    const existUser = await this.userRepo.findOne({ where: { id: userId } });

    if (!existUser) {
      this.logger.log({
        ...this.describeDownload(itemId, userId, actorUserId),
        event: 'transformation.file.download_failed',
        result: 404,
        reason: 'user_not_found',
      });
      throw new NotFoundException('User not found');
    }

    return this.downloadFile(itemId, userId, actorUserId);
  }

  private describeDownload(
    transformationId: string,
    targetUserId: string,
    actorUserId: string,
  ) {
    return { transformationId, targetUserId, actorUserId };
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
        resultFileName: transformation.resultFileName,
        errorCode: transformation.errorCode ?? undefined,
        fileAvailable: transformation.fileStatus === 'stored' ? true : false,
      },
      { excludeExtraneousValues: true, exposeUnsetFields: false },
    );
  }
}
