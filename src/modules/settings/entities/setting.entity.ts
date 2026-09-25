import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SettingValue =
  | string
  | number
  | boolean
  | unknown[]
  | Record<string, unknown>;

@Entity({ name: 'settings' })
export class Setting {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  key: string;

  // A missing row means "use the env fallback"; PATCH with null deletes the row.
  @Column({ type: 'jsonb' })
  value: SettingValue;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
