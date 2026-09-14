import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Propagation, Transactional } from 'typeorm-transactional';
import { User } from './entities/user.entity';
import { Repository } from 'typeorm';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) { }

  findByEmail(email: string, relations: string[] = []): Promise<User | null> {
    return this.repo.findOne({ where: { email }, relations });
  }

  findById(id: string, relations: string[] = []): Promise<User | null> {
    return this.repo.findOne({ where: { id }, relations });
  }

  create(data: {
    email: string;
    passwordHash: string;
    isEmailVerified: boolean;
  }): Promise<User> {
    return this.repo.save(this.repo.create(data));
  }

  save(user: User): Promise<User> {
    return this.repo.save(user);
  }

  /**
   * Recorded in its own transaction (REQUIRES_NEW) so the attempt count and
   * lockout survive even when the caller (AuthService.login()) throws right
   * after this resolves — a throw there would otherwise roll back the
   * enclosing @Transactional() call, silently discarding the increment and
   * making AUTH_LOGIN_MAX_FAILED_ATTEMPTS never actually trigger.
   */
  @Transactional({ propagation: Propagation.REQUIRES_NEW })
  async recordFailedLoginAttempt(
    user: User,
    {
      maxAttempts,
      lockoutMinutes,
    }: { maxAttempts: number; lockoutMinutes: number },
  ): Promise<boolean> {
    user.failedLoginAttempts += 1;
    const locked = user.failedLoginAttempts >= maxAttempts;
    if (locked) {
      user.lockedUntil = new Date(Date.now() + lockoutMinutes * 60_000);
    }
    await this.repo.save(user);
    return locked;
  }
}
