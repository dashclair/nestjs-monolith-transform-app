import { IsString } from 'class-validator';

export class ConfirmEmailChangeDto {
  @IsString()
  code!: string;
}
