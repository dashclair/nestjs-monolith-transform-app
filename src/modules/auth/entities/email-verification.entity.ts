import { User } from '@/modules/users/entities/user.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EmailVerificationMethod } from '../../../core/email-verification/email-verification-method.enum';
import { EmailVerificationPurpose } from '../../../core/email-verification/email-verification-purpose.enum';

@Entity({ name: 'email_verifications' })
@Index(['userId', 'purpose'])
export class EmailVerification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'enum', enum: EmailVerificationMethod })
  method: EmailVerificationMethod;

  @Column({ type: 'varchar' })
  codeHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'int', default: 0 })
  attemptsUsed: number;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSentAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({
    type: 'enum',
    enum: EmailVerificationPurpose,
    default: EmailVerificationPurpose.REGISTER,
  })
  purpose: EmailVerificationPurpose;
}
