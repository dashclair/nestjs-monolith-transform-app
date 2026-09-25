import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateGrantDto {
  @IsUUID()
  roleId: string;

  @IsUUID()
  permissionId: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  actions?: string[];
}
