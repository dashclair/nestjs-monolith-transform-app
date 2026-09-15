import {
  initializeTransactionalContext,
  StorageDriver,
} from 'typeorm-transactional';

// e2e specs boot AppModule directly via Test.createTestingModule(), bypassing
// main.ts's bootstrap() — so the @Transactional() context (normally set up
// once there) has to be initialized here instead, before any test creates a
// DataSource, or every @Transactional() method throws "No storage driver
// defined" the first time it runs.
initializeTransactionalContext({ storageDriver: StorageDriver.AUTO });
