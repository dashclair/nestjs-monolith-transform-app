import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { ValueTransformer } from 'typeorm';

import { User } from '@/modules/users/entities/user.entity';
import type {
  ConversionOptions,
  FileStatus,
  Format,
  TransformationKind,
  TransformationStatus,
} from '@/modules/transformations/core/types';
import type { TransformationErrorCode } from '@/modules/transformations/core/transformation-error';

// File sizes are bounded by config and fit into JavaScript's safe integer range.
const bigintToNumber: ValueTransformer = {
  to: (value: number): number => value,
  from: (value: string): number => Number(value),
};

@Entity('transformations')
@Index('IDX_transformations_user_created_id', ['userId', 'createdAt', 'id'])
@Index('IDX_transformations_created_at', ['createdAt'])
export class Transformation {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_transformations_id',
  })
  id: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_transformations_user',
  })
  user: User;

  @Column({ type: 'varchar', length: 16 })
  type: TransformationKind;

  @Column({ type: 'varchar', length: 16, nullable: true })
  sourceFormat: Format | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  targetFormat: Format | null;

  @Column({ type: 'varchar', length: 16 })
  status: TransformationStatus;

  @Column({ type: 'varchar', length: 64, nullable: true })
  errorCode: TransformationErrorCode | null;

  @Column('bigint', { transformer: bigintToNumber })
  fileSize: number;

  @Column('int')
  durationMs: number;

  @Column('jsonb', { nullable: true })
  options: ConversionOptions | null;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt: Date;

  @Column({ type: 'varchar', length: 512, nullable: true })
  storageKey: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  fileStatus: FileStatus | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  resultFileName: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  resultMimeType: string | null;

  @Column('bigint', { nullable: true, transformer: bigintToNumber })
  resultSize: number | null;
}
