import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransformationHistoryService } from './core/transformation-history.service';
import { Transformation } from './entities/transformation.entity';
import { TransformationPipelineService } from './core/conversion-pipeline.service';
import { TextTransformationController } from './text/text-transformation.controller';
import { TextTransformationService } from './text/text-transformation.service';
import { TextConversionRunner } from './text/runner/text-conversion.runner';
import { PiscinaRunner } from './text/runner/piscina.runner';
import { ImageTransformationService } from './image/image-transformation.service';
import { ImageTransformationController } from './image/image-transformation.controller';
import { TransformationHistoryController } from './history/transformations-history.controller';
import { TransformationsHistoryService } from './history/transformations-history.service';
import { AdminTransformationHistoryController } from './history/admin-transformation-history.controller';

import { RbacModule } from '../rbac';
import { User } from '../users/entities/user.entity';
import { TransformationsCleanupService } from './history/transformations-cleanup.service';

@Module({
  imports: [TypeOrmModule.forFeature([Transformation, User]), RbacModule],
  controllers: [
    TextTransformationController,
    ImageTransformationController,
    TransformationHistoryController,
    AdminTransformationHistoryController,
  ],
  providers: [
    TransformationHistoryService,
    TransformationPipelineService,
    TextTransformationService,
    {
      provide: TextConversionRunner,
      useClass: PiscinaRunner,
    },
    ImageTransformationService,
    TransformationsHistoryService,
    TransformationsCleanupService,
  ],
  exports: [TypeOrmModule, TransformationHistoryService],
})
export class TransformationsModule {}
