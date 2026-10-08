import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

// Parsed `options` JSON of POST /api/images/convert. Static bounds only: the
// width/height maximum comes from config and the "does this option apply to
// this pair" rules need the detected source — both live in validateOptions().
export class ImageOptionsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  quality?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;

  @IsOptional()
  @Matches(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  background?: string;
}

// Plain-object form returned by validateOptions(): a mapped type, unlike the
// class, is assignable to ConversionOptions (Record<string, unknown>).
export type ImageOptions = Pick<
  ImageOptionsDto,
  'quality' | 'width' | 'height' | 'background'
>;
