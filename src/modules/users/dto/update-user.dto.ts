import { IsEmail, IsOptional, IsString, IsUrl } from "class-validator";

import { NormalizeEmail } from "@/common/validation/normalize-email.decorator";

export class UpdateUserDto {
    @IsOptional() @IsString() @IsUrl() photo?: string;
    @IsOptional() @IsEmail() @NormalizeEmail() email?: string;
}