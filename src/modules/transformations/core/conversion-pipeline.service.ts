import { HttpStatus, Injectable, Logger, StreamableFile } from '@nestjs/common';
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
  FileStatus,
  Format,
} from './types';
import { randomUUID } from 'crypto';
import { TransformationsStorageService } from './transformations-storage.service';
import { win32 } from 'path';

function buildResultFileName(
  original: string | null,
  extension: string,
): string {
  const base = original ? win32.basename(original).replace(/\.[^.]*$/, '') : '';
  const safe = base
    .replace(/\p{Cc}/gu, '')
    .trim()
    .slice(0, 200);
  return `${safe || 'converted'}.${extension}`;
}

export interface ProgressCallback {
  fileSize: number;
  sourceFormat: Format | null;
}

@Injectable()
export class TransformationPipelineService {
  private readonly logger = new Logger(TransformationPipelineService.name);

  constructor(
    private readonly historyService: TransformationHistoryService,
    private readonly configService: ConfigService,
    private readonly storage: TransformationsStorageService,
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
          // The field itself is a valid string (ConvertFieldsDto); its content
          // is the options, so this is an options error, not a fields one.
          throw new TransformationError(
            'INVALID_OPTIONS',
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

      historyContext.options = result.options ?? options;

      const durationMs = Math.round(performance.now() - startedAt);
      const transformationId = randomUUID();

      let fileStatus: FileStatus | null = null;
      let storageKey: string | null = null;
      const resultFileName = buildResultFileName(
        input.originalFileName,
        result.extension,
      );

      if (fields.save === 'true') {
        const maxBytes = Number(
          this.configService.get('STORAGE_MAX_FILE_BYTES'),
        );

        if (result.body.length > maxBytes) {
          fileStatus = 'skipped';
        } else {
          fileStatus = 'pending';
          storageKey = `transformations/${request.user.userId}/${transformationId}.${result.extension}`;
        }
      }

      const history = await this.historyService.write({
        id: transformationId,
        userId: request.user.userId,
        type: engine.kind,
        ...historyContext,
        durationMs,
        status: 'success',
        errorCode: null,
        storageKey,
        fileStatus,
        resultMimeType: result.mimeType,
        resultSize: result.body.length,
        resultFileName: resultFileName,
      });

      if (fileStatus !== null) {
        if (history === null) {
          // No row to attach the file to, so nothing could ever download it.
          this.logger.warn({
            event: 'transformation.file.save_skipped',
            userId: request.user.userId,
            transformationId: null,
            storageKey: null,
            resultSize: result.body.length,
            reason: 'history_write_failed',
          });
        } else if (fileStatus === 'skipped') {
          this.logger.warn({
            event: 'transformation.file.save_skipped',
            userId: request.user.userId,
            transformationId: history.id,
            storageKey: null,
            resultSize: result.body.length,
            reason: 'too_large',
          });
        } else {
          // Not awaited: saving must not delay the response.
          void this.storage.saveResult(history, result);
        }
      }

      this.logger.log({
        event: 'transformation.convert.success',
        userId: request.user.userId,
        type: engine.kind,
        sourceFormat: historyContext.sourceFormat,
        targetFormat: historyContext.targetFormat,
        fileSize: historyContext.fileSize,
        outputSize: result.body.length,
        durationMs,
        transformationId: history?.id ?? null,
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
      const durationMs = Math.round(performance.now() - startedAt);

      await this.historyService.write({
        userId: request.user.userId,
        type: engine.kind,
        ...historyContext,
        status: 'error',
        errorCode: failure.code,
        durationMs,
      });

      const logEntry = {
        event: 'transformation.convert.failed',
        userId: request.user.userId,
        type: engine.kind,
        sourceFormat: historyContext.sourceFormat,
        targetFormat: historyContext.targetFormat,
        fileSize: historyContext.fileSize,
        durationMs,
        errorCode: failure.code,
        status: failure.getStatus(),
      };

      if (failure.code === 'INTERNAL_ERROR') {
        this.logger.error(
          logEntry,
          error instanceof Error ? error.stack : String(error),
        );
      } else {
        this.logger.warn(logEntry);
      }

      throw failure;
    }
  }
}
