import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  addTransactionalDataSource,
  deleteDataSourceByName,
} from 'typeorm-transactional';

import { ConfigModule } from '@/core/config/config.module';
import { ConfigService } from '@/core/config/config.service';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const migrationsRun =
          String(config.get('POSTGRES_MIGRATIONS_RUN')) === 'true';

        return {
          type: 'postgres',

          host: config.get('POSTGRES_HOST'),
          port: Number(config.get('POSTGRES_PORT')),
          username: config.get('POSTGRES_USER'),
          password: config.get('POSTGRES_PASSWORD'),
          database: config.get('POSTGRES_DB'),

          autoLoadEntities: true,

          migrationsTableName: 'migrations',
          // TypeORM resolves this glob into migration classes eagerly,
          // regardless of migrationsRun below — only load it when it'll
          // actually be used, so POSTGRES_MIGRATIONS_RUN=false skips the
          // dynamic require()/import() of every .migration.ts file entirely
          // (that lookup relies on a global TS-transform require hook like
          // ts-node's, which isn't present when this module boots under
          // Vitest for e2e tests).
          migrations: migrationsRun
            ? [__dirname + '/../../database/migrations/*.migration{.ts,.js}']
            : [],
          migrationsRun,

          synchronize: String(config.get('POSTGRES_SYNCHRONIZE')) === 'true',
          logging: String(config.get('POSTGRES_LOGGING')) === 'true',
        };
      },
      dataSourceFactory(options) {
        if (!options) {
          throw new Error('Invalid options passed');
        }

        deleteDataSourceByName('default');

        return Promise.resolve(
          addTransactionalDataSource(new DataSource(options)),
        );
      },
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
