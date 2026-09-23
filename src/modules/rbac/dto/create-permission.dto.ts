import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  MinLength,
} from 'class-validator';

export class CreatePermissionDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  actions: string[];
}
