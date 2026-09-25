import { Expose } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export enum UserStatus {
  Active = 'active',
  Deleted = 'deleted',
}

export enum UserSortField {
  CreatedAt = 'created_at',
  Email = 'email',
}

export enum SortOrder {
  Asc = 'asc',
  Desc = 'desc',
}

export class ListUsersQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  q?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsEnum(UserSortField)
  sort: UserSortField = UserSortField.CreatedAt;

  @IsOptional()
  @IsEnum(SortOrder)
  order: SortOrder = SortOrder.Desc;
}

export class UserListItemDto {
  @Expose() id: string;
  @Expose() email: string;
  @Expose() photo: string | null;
  @Expose() createdAt: Date;
  @Expose() status: UserStatus;
}

export class ListUsersResponseDto {
  items: UserListItemDto[];
  nextCursor: string | null;
}
