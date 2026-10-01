export class StorageNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Storage object not found: ${key}`);
    this.name = 'StorageNotFoundError';
  }
}
