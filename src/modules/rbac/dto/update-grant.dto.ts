import { IsArray, IsOptional, IsString } from "class-validator";

export class UpdateGrantDto {
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    actions?: string[];
}