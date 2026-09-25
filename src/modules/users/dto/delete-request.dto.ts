import { IsOptional, IsString } from 'class-validator';

export class DeleteRequestDto {
  @IsOptional() @IsString() reason?: string;
}
