import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { IsIsoDateString } from '@/common/validation/is-iso-date-string.decorator';

import {
  FORMATS,
  TRANSFORMATION_KINDS,
  TRANSFORMATION_STATUSES,
} from '../../core/types';
import type {
  Format,
  TransformationKind,
  TransformationStatus,
} from '../../core/types';
import type { TransformationErrorCode } from '../../core/transformation-error';

export class TransformationHistoryQueryDto {
  @ApiPropertyOptional({
    description:
      '`nextCursor` from the previous page. Reset it when filters change.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ enum: [...TRANSFORMATION_KINDS] })
  @IsOptional()
  @IsIn(TRANSFORMATION_KINDS)
  type?: TransformationKind;

  @ApiPropertyOptional({ enum: [...FORMATS] })
  @IsOptional()
  @IsIn(FORMATS)
  sourceFormat?: Format;

  @ApiPropertyOptional({ enum: [...FORMATS] })
  @IsOptional()
  @IsIn(FORMATS)
  targetFormat?: Format;

  @ApiPropertyOptional({ enum: [...TRANSFORMATION_STATUSES] })
  @IsOptional()
  @IsIn(TRANSFORMATION_STATUSES)
  status?: TransformationStatus;

  @ApiPropertyOptional({
    description: 'ISO 8601, inclusive.',
    example: '2026-10-01T00:00:00Z',
  })
  @IsOptional()
  @IsIsoDateString()
  createdAtFrom?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601, exclusive.',
    example: '2026-11-01T00:00:00Z',
  })
  @IsOptional()
  @IsIsoDateString()
  createdAtTo?: string;
}

export class TransformationHistoryItemDto {
  @ApiProperty({ format: 'uuid' })
  @Expose()
  id: string;

  @ApiProperty({ enum: [...TRANSFORMATION_KINDS] })
  @Expose()
  type: TransformationKind;

  @ApiProperty({
    enum: [...FORMATS],
    nullable: true,
    description: 'null when the source format could not be detected.',
  })
  @Expose()
  sourceFormat: Format | null;

  @ApiProperty({ enum: [...FORMATS], nullable: true })
  @Expose()
  targetFormat: Format | null;

  @ApiProperty({ enum: [...TRANSFORMATION_STATUSES] })
  @Expose()
  status: TransformationStatus;

  @ApiProperty({ description: 'Bytes.' })
  @Expose()
  fileSize: number;

  @ApiProperty()
  @Expose()
  durationMs: number;

  @ApiPropertyOptional({ description: 'Present only when status is error.' })
  @Expose()
  errorCode?: TransformationErrorCode;

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty({
    description:
      'Whether the result file was saved and can be downloaded (`fileStatus` is `stored`).',
  })
  @Expose()
  fileAvailable: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'File name the download is served under; null when the conversion failed.',
  })
  @Expose()
  resultFileName: string | null;
}

export class TransformationHistoryResponseDto {
  @ApiProperty({ type: [TransformationHistoryItemDto] })
  items: TransformationHistoryItemDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor: string | null;
}
