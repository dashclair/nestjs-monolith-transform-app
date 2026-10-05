import { HttpStatus, Injectable, StreamableFile } from '@nestjs/common';
import { ConversionEngine } from './conversion-engine';
import { readMultipart } from './multipart-reader';
import { plainToInstance } from 'class-transformer';
import { ConvertFieldsDto } from './dto/convert-fields.dto';
import { validate } from 'class-validator';
import { TransformationError } from './transformation-error';
import { TransformationHistoryService } from './transformation-history.service';
import { FastifyReply, FastifyRequest } from 'fastify';
import { RequestUser } from '@/core/auth/auth.types';
import { ConfigService } from '@/core/config/config.service';
import {
  ConversionOptions,
  ConversionRequest,
  ConversionResult,
  Format,
} from './types';

export interface ProgressCallback {
  fileSize: number;
  sourceFormat: Format | null;
}

@Injectable()
export class TransformationPipelineService {
  constructor(
    private readonly historyService: TransformationHistoryService,
    private readonly configService: ConfigService,
  ) {}

  async conversionWithTimeout(
    engine: ConversionEngine,
    convertRequest: ConversionRequest,
    timeoutMs: number,
  ): Promise<ConversionResult> {
    const controller = new AbortController();

    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new TransformationError(
          'CONVERSION_TIMEOUT',
          HttpStatus.REQUEST_TIMEOUT,
          'Conversion timed out',
        );

        reject(error);
        controller.abort();
      }, timeoutMs);
    });
    try {
      const conversion = engine.convert(convertRequest, controller.signal);

      return await Promise.race([conversion, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async run(
    engine: ConversionEngine,
    request: FastifyRequest & { user: RequestUser },
    reply: FastifyReply,
  ): Promise<StreamableFile> {
    const startedAt = performance.now();
    const historyContext: {
      sourceFormat: Format | null;
      targetFormat: Format | null;
      fileSize: number;
      options: ConversionOptions | null;
    } = {
      sourceFormat: null,
      targetFormat: null,
      fileSize: 0,
      options: null,
    };
    try {
      const onProgress = ({ fileSize, sourceFormat }: ProgressCallback) => {
        historyContext.fileSize = fileSize;
        historyContext.sourceFormat = sourceFormat;
      };

      const input = await readMultipart(request, engine, onProgress);

      historyContext.sourceFormat = input.source;
      historyContext.fileSize = input.fileSize;

      const fields = plainToInstance(ConvertFieldsDto, input.fields);
      const errors = await validate(fields, {
        whitelist: true,
        forbidNonWhitelisted: true,
        validationError: {
          target: false,
          value: false,
        },
      });

      if (errors.length > 0) {
        throw new TransformationError(
          'INVALID_FIELDS',
          HttpStatus.BAD_REQUEST,
          'Invalid transformation fields',
        );
      }

      const supportedPairs = engine.supportedPairs();
      const targetSupported = supportedPairs.some(
        (pair) => pair.target === fields.targetFormat,
      );

      if (!targetSupported) {
        throw new TransformationError(
          'INVALID_FIELDS',
          HttpStatus.BAD_REQUEST,
          'Unsupported target format',
        );
      }

      historyContext.targetFormat = fields.targetFormat;

      const directionSupported = supportedPairs.some(
        (pair) =>
          pair.source === input.source && pair.target === fields.targetFormat,
      );

      if (!directionSupported) {
        throw new TransformationError(
          'UNSUPPORTED_DIRECTION',
          HttpStatus.BAD_REQUEST,
          'Unsupported conversion direction',
        );
      }

      let rawOptions: unknown = {};

      if (fields.options !== undefined) {
        try {
          rawOptions = JSON.parse(fields.options);
        } catch {
          throw new TransformationError(
            'INVALID_FIELDS',
            HttpStatus.BAD_REQUEST,
            'Options must contain valid JSON',
          );
        }
      }

      const options = engine.validateOptions(
        input.source,
        fields.targetFormat,
        rawOptions,
      );
      historyContext.options = options;

      const result = await this.conversionWithTimeout(
        engine,
        {
          source: input.source,
          target: fields.targetFormat,
          body: input.body,
          options,
        },
        Number(this.configService.get('TRANSFORM_TIMEOUT_MS')),
      );

      const durationMs = Math.round(performance.now() - startedAt);

      const history = await this.historyService.write({
        userId: request.user.userId,
        type: engine.kind,
        ...historyContext,
        durationMs,
        status: 'success',
        errorCode: null,
      });

      reply.code(HttpStatus.OK).headers({
        'Content-Type': result.mimeType,
        'Content-Disposition': `attachment; filename="converted.${result.extension}"`,
      });

      if (history !== null) {
        reply.header('X-Transformation-Id', history.id);
      }

      return new StreamableFile(result.body);
    } catch (error) {
      const failure =
        error instanceof TransformationError
          ? error
          : new TransformationError(
              'INTERNAL_ERROR',
              HttpStatus.INTERNAL_SERVER_ERROR,
              'Internal server error',
            );
      await this.historyService.write({
        userId: request.user.userId,
        type: engine.kind,
        ...historyContext,
        status: 'error',
        errorCode: failure.code,
        durationMs: Math.round(performance.now() - startedAt),
      });

      throw failure;
    }
  }
}
