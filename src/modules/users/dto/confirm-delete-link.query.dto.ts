import { IsString } from 'class-validator';

export class ConfirmDeleteLinkQueryDto {
  @IsString()
  token: string;
}
