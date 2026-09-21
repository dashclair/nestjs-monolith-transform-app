import { IsEmail, IsOptional, IsString, IsUrl } from "class-validator";

import { NormalizeEmail } from "@/modules/auth/dto/normalize-email.decorator";

export class UpdateUserDto {
    @IsOptional() @IsString() @IsUrl() photo?: string;
    @IsOptional() @IsEmail() @NormalizeEmail() email?: string;
}