import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import compression from '@fastify/compress';
import fastifyCookie from '@fastify/cookie';
import { ValidationPipe } from '@nestjs/common';
import {
  initializeTransactionalContext,
  StorageDriver,
} from 'typeorm-transactional';

import { AppModule } from './core/app/app.module';
import { ConfigService } from '@/core/config/config.service';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  initializeTransactionalContext({ storageDriver: StorageDriver.AUTO });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  await app.register(compression);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableCors({
    origin: [
      'http://localhost:5174',
      'http://localhost:4200',
      'http://localhost:8080',
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  const configService = app.get(ConfigService);

  const appName = configService.get('APP_NAME');
  const apiVersion = configService.get('API_VERSION');
  const swaggerPath = configService.get('SWAGGER_PATH');

  await app.register(fastifyCookie, {
    secret: configService.get('COOKIE_SECRET'),
  });

  const port = configService.get('PORT');

  const config = new DocumentBuilder()
    .setTitle(appName)
    .setDescription('REST API for the Prism platform ')
    .setVersion(apiVersion)
    .addBearerAuth()
    .addTag('Auth', 'Authentication and account access')
    .addTag('Users', 'User management')
    .addTag('Transformations', 'File transformation operations')
    .addTag('Health', 'Service health checks')
    .addTag('Diagnostics', 'Diagnostic error endpoints')
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(swaggerPath, app, documentFactory);

  await app.listen(port);
}

void bootstrap();
