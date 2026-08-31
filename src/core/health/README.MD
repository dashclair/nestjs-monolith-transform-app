# Health Module

The Health module provides a health check endpoint at `GET /health`

## Enable / Disable

The health check is controlled by the `HEALTH_CHECK_ENABLED` environment variable:

| Value   | Behavior                                         |
| ------- | ------------------------------------------------ |
| `true`  | Full health check is performed                   |
| `false` | Returns an empty response (default)              |

When enabled, `checkHealth()` runs the following indicators:

- `database` — pings the TypeORM connection (`TypeOrmHealthIndicator`)
- `memory_heap` / `memory_rss` — process memory usage (`MemoryHealthIndicator`)
- `storage` — disk usage of `HEALTH_DISK_PATH`, unhealthy above `HEALTH_DISK_THRESHOLD` (`DiskHealthIndicator`)

Add to your `.env` file:

```env
HEALTH_CHECK_ENABLED=true
HEALTH_DISK_THRESHOLD=0.9
```

`HEALTH_DISK_PATH` and `HEALTH_DISK_THRESHOLD` are optional. `HEALTH_DISK_THRESHOLD` defaults to `0.9` (90%). `HEALTH_DISK_PATH` has no static default — `HealthService` falls back to `C:\` on Windows and `/` everywhere else, since `check-disk-space` requires an OS-native path (a literal `/` throws `InvalidPathError` on Windows). Set `HEALTH_DISK_PATH` explicitly only to check a different drive/mount.

**Note:** When disabled (default), the endpoint still responds but skips all health indicators and returns `{ status: 'ok', details: {} }`.

## Adding New Health Checks

To add custom health indicators, modify `health.service.ts`. For example, to check an external HTTP dependency:

```typescript
constructor(
  private readonly healthCheckService: HealthCheckService,
  private readonly configService: ConfigService,
  private readonly db: TypeOrmHealthIndicator,
  private readonly memory: MemoryHealthIndicator,
  private readonly disk: DiskHealthIndicator,
  private readonly http: HttpHealthIndicator,
) {}

checkHealth() {
  const diskPath = this.configService.get('HEALTH_DISK_PATH') || (process.platform === 'win32' ? 'C:\\' : '/');
  const diskThreshold = Number(this.configService.get('HEALTH_DISK_THRESHOLD'));

  return this.healthCheckService.check([
    () => this.db.pingCheck('database'),
    () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
    () => this.memory.checkRSS('memory_rss', 150 * 1024 * 1024),
    () => this.disk.checkStorage('storage', { path: diskPath, thresholdPercent: diskThreshold }),
    // Check external service
    () => this.http.pingCheck('api', 'https://api.example.com'),
  ]);
}
```

For the full list of available health indicators and custom indicator creation, see the official NestJS documentation:
**[https://docs.nestjs.com/recipes/terminus](https://docs.nestjs.com/recipes/terminus)**
