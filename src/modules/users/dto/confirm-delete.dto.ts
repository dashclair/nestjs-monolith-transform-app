import { IsString } from 'class-validator';

export class ConfirmDeleteDto {
  @IsString()
  code: string;
}
