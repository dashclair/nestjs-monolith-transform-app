import { Expose } from 'class-transformer';

export class UserProfileDto {
  @Expose() id: string;
  @Expose() email: string;
  @Expose() photo: string | null;
  @Expose() isEmailVerified: boolean;
  @Expose() createdAt: Date;
}
