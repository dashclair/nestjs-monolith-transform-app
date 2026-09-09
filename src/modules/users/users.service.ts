import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Repository } from 'typeorm';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) { }

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOneBy({ email });
  }

  findById(id: string): Promise<User | null> {
    return this.repo.findOneBy({ id });
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
}
