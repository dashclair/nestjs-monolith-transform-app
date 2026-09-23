import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Role } from '@/modules/rbac/entities/role.entity';

@Index(['createdAt', 'id'])
@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  email: string;

  @Column({
    type: 'varchar',
    nullable: true,
    default: null
  })
  photo?: string | null;

  @Exclude()
  @Column({ type: 'varchar' })
  passwordHash: string;

  @ManyToMany(() => Role)
  @JoinTable({
    name: 'user_roles',
    joinColumn: { name: 'userId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'roleId', referencedColumnName: 'id' },
  })
  roles: Role[];

  @Column({ type: 'boolean', default: false })
  isEmailVerified: boolean;

  @Column({ type: 'varchar', nullable: true })
  pendingEmail: string | null;

  @CreateDateColumn({ type: 'timestamptz',  precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @Column({ type: 'int', default: 0 })
  failedLoginAttempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  @Column({ type: 'int', default: 0 })
  tokenVersion: number;

  @Column({
    type: 'timestamptz',
    nullable: true,
  })
  deletedAt: Date | null;
}
