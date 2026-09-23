import { throttleFromConfig } from './throttle-from-config';

describe('throttleFromConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves limit and ttl (seconds → ms) from env at call time, not at decoration time', () => {
    const options = throttleFromConfig(
      'THROTTLE_USERS_LIST_LIMIT',
      'THROTTLE_USERS_LIST_TTL',
    );

    // Set *after* the decorator options were built — mirrors ConfigModule
    // writing Joi defaults into process.env during app bootstrap, which
    // happens after controller modules are imported.
    vi.stubEnv('THROTTLE_USERS_LIST_LIMIT', '7');
    vi.stubEnv('THROTTLE_USERS_LIST_TTL', '30');

    const { limit, ttl } = options.default;
    expect(limit()).toBe(7);
    expect(ttl()).toBe(30_000);
  });
});
