import { IsString } from 'class-validator';

export class ConfirmEmailChangeLinkQueryDto {
  @IsString()
  token: string;
}
