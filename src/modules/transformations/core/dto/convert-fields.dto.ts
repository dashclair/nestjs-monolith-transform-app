import { IsIn, IsString, ValidateIf } from 'class-validator';

import { FORMATS } from '../types';
import type { Format } from '../types';

export class ConvertFieldsDto {
  @IsIn(FORMATS)
  targetFormat: Format;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['true', 'false'])
  save?: 'true' | 'false';

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  options?: string;
}
