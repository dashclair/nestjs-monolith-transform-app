import type { FastifyMultipartOptions } from '@fastify/multipart';

import type { ConfigService } from '@/core/config/config.service';

// Share these options with the e2e bootstrap when conversion routes are added.
export function getMultipartOptions(
  config: Pick<ConfigService, 'get'>,
): FastifyMultipartOptions {
  const maxLimit = Math.max(
    Number(config.get('TRANSFORM_MAX_SIZE_CSV')),
    Number(config.get('TRANSFORM_MAX_SIZE_JSON')),
    Number(config.get('TRANSFORM_MAX_SIZE_XML')),
    Number(config.get('TRANSFORM_MAX_SIZE_YAML')),
    Number(config.get('TRANSFORM_MAX_SIZE_PNG')),
    Number(config.get('TRANSFORM_MAX_SIZE_JPEG')),
    Number(config.get('TRANSFORM_MAX_SIZE_SVG')),
  );

  return {
    limits: {
      files: 1,
      fields: 10,
      fieldSize: 16 * 1024,
      parts: 11,
      fileSize: maxLimit + 1,
    },
  };
}
