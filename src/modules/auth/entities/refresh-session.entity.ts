import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import { User } from '@/modules/users/entities/user.entity';

@Entity({ name: 'refresh_sessions' })
export class RefreshSession {
  // Equals the refresh token's `jti`. Generated in the app (not by the DB)
  // because the id has to go into the JWT payload before the token is signed.
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  // SHA-256 hex of the signed refresh token.
  @Column({ type: 'char', length: 64 })
  tokenHash: string;

  @Index()
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  // Session that replaced this one on rotation. A request with a revoked
  // session that has a successor is a reuse (stolen token) signal.
  @Column({ type: 'uuid', nullable: true })
  replacedById: string | null;

  @ManyToOne(() => RefreshSession, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'replacedById' })
  replacedBy: RefreshSession | null;

  @Column({ type: 'varchar', nullable: true })
  userAgent: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
