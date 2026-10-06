import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransformationHistoryService } from './core/transformation-history.service';
import { Transformation } from './entities/transformation.entity';
import { TransformationPipelineService } from './core/conversion-pipeline.service';
import { TextTransformationController } from './text/text-transformation.controller';
import { TextTransformationService } from './text/text-transformation.service';
import { TextConversionRunner } from './text/runner/text-conversion.runner';
import { PiscinaRunner } from './text/runner/piscina.runner';

@Module({
  imports: [TypeOrmModule.forFeature([Transformation])],
  controllers: [TextTransformationController],
  providers: [
    TransformationHistoryService,
    TransformationPipelineService,
    TextTransformationService,
    {
      provide: TextConversionRunner,
      useClass: PiscinaRunner,
    },
  ],
  exports: [TypeOrmModule, TransformationHistoryService],
})
export class TransformationsModule {}
