# Журнал реализации тикетов

Этот документ — подробный разбор того, **как** и **почему** были реализованы конкретные тикеты из [`PLAN.md`](./PLAN.md), в отличие от самого плана, где по каждому пункту — только краткий итог. Здесь — ход рассуждений, альтернативы, которые рассматривались, и на что натыкались по пути (включая баги, которые всплыли только при ручной проверке). Цель — чтобы по каждому тикету можно было понять логику реализации и повторить подобный подход самостоятельно на следующих тикетах.

Формат: один раздел на тикет, плюс отдельный раздел на сквозные технические правки, которые не привязаны к одному тикету.

---

## T-002. Подключение БД — ручная проверка Docker/Postgres

### Проблема

В `PLAN.md` T-002 был отмечен как готовый на основании конфигурации (`DatabaseModule`, `docker-compose.yml`, скрипты миграций) — но с пометкой, что реально `docker-compose up` ни разу не запускался, и подключение к БД проверено не было: «падает только из-за того, что Postgres локально не поднят». То есть connectivity end-to-end (контейнер → `.env` → `TypeOrmModule` → реальный коннекшн) оставалась неподтверждённой.

### Что сделано и проверено руками

**1. Поднят контейнер:**

```bash
docker compose up -d
docker compose ps
# mnt-postgres   Up ... (healthy)   0.0.0.0:5432->5432/tcp
```

Healthcheck из `docker-compose.yml` (`pg_isready -U ... -d ...`) реально отрабатывает и переводит контейнер в `healthy`.

**2. Подтверждено, что `.env` корректно связывает контейнер и приложение** — обе стороны читают одни и те же переменные (`POSTGRES_HOST=localhost`, `POSTGRES_PORT=5432`, `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=postgres`, `POSTGRES_DB=app`): контейнер — через `env_file`/`environment` в `docker-compose.yml`, приложение — через `ConfigService` в [`database.module.ts`](../src/core/database/database.module.ts#L14-L21). Никакой рассинхронизации конфигурации нет, дополнительных `.env`-переменных под Docker заводить не потребовалось.

**3. Проверено прямое подключение к БД** (`docker exec ... psql`) — сервер PostgreSQL 18.6 отвечает, база `app` существует и доступна.

**4. Задокументирован рецепт подключения через DBeaver** (host `localhost`, port `5432`, database `app`, user/password `postgres`/`postgres`) — то же самое, что использует и сам контейнер, и приложение.

### Баг/особенность, которая нашлась только при ручном прогоне

При первом холодном старте `npm run start:dev` в логах контейнера словили гонку:

```
ERROR: duplicate key value violates unique constraint "pg_class_relname_nsp_index"
DETAIL: Key (relname, relnamespace)=(migrations_id_seq, 2200) already exists.
STATEMENT: CREATE TABLE "migrations" (...)
```

**Причина:** `nest-cli.json` использует дефолтный `tsc`-компилятор с `"deleteOutDir": true`. При первом запуске `--watch` идёт полная пересборка всего проекта, и файловый watcher в этот момент иногда триггерит **два перезапуска приложения подряд**, прежде чем первый процесс успевает корректно завершиться. Оба инстанса поднимаются с `POSTGRES_MIGRATIONS_RUN=true` ([`database.module.ts:28`](../src/core/database/database.module.ts#L28)) и одновременно пытаются создать служебную таблицу `migrations` — второй проигрывает гонку за `migrations_id_seq`.

Проверено, что это не ломает состояние БД: таблица `migrations` создаётся успешно (владелец — тот процесс, что выиграл гонку), просто пустая, потому что файлов миграций в проекте пока нет ([`src/database/migrations`](../src/database/migrations) — только `.gitkeep`). Гонка voспроизводится именно на **первом холодном старте** watch-режима (полная пересборка из-за `deleteOutDir: true`); на инкрементальных пересборках (правка одного файла) не повторяется, поскольку пересборка быстрая и одиночная. Если ошибка начнёт вылезать при каждом рестарте — это уже отдельный повод разбираться, но как разовое событие на первом старте — не баг проекта, ничего чинить не потребовалось.

### Как проверить руками

```bash
docker compose up -d
docker compose ps
# → mnt-postgres ... Up ... (healthy)

docker exec mnt-postgres psql -U postgres -d app -c "SELECT version();"
# → PostgreSQL 18.6 ...

npm run start:dev
# приложение подключается к БД на localhost:5432, миграции (пока пустые) прогоняются при старте
```

DBeaver: New Connection → PostgreSQL → Host `localhost`, Port `5432`, Database `app`, User/Password `postgres`/`postgres` → Test Connection.

### Затронутые файлы

Изменений кода не потребовалось — сессия была про верификацию уже существующей инфраструктуры, а не про реализацию:

- [`docker-compose.yml`](../docker-compose.yml) — проверен, не менялся
- [`.env`](../.env) / [`.env.example`](../.env.example) — проверены, не менялись
- [`src/core/database/database.module.ts`](../src/core/database/database.module.ts) — проверен, не менялся
- [`src/database/data-source.ts`](../src/database/data-source.ts) — проверен, не менялся
- [`nest-cli.json`](../nest-cli.json) — проверен (объясняет причину гонки миграций), не менялся

---

## T-003. Глобальная валидация и обработка ошибок

### Проблема

`ValidationPipe` в `main.ts` был подключён только с `whitelist: true` — лишние поля из тела запроса тихо вырезались, без сигнала клиенту. Не было ни глобального `ExceptionFilter` (у разных типов исключений — разный формат ответа, а необработанные ошибки могли улететь в дефолтный обработчик Nest с риском утечки stack trace), ни `ClassSerializerInterceptor` (из-за чего `@Exclude()` на будущих полях вроде `passwordHash`, T-010, не применялся бы вообще — сериализация в JSON о декораторах `class-transformer` ничего не знает без интерцептора).

### Что сделано

**1. `ValidationPipe` в [`main.ts`](../src/main.ts#L21-L27) дополнен тремя опциями:**

```typescript
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }),
);
```

- `forbidNonWhitelisted` — вместо тихого вырезания лишних полей теперь `400`. Это защита от **mass assignment** (например, `role: 'admin'` в теле регистрации, T-011) — раньше лишнее поле просто исчезало без следа, что маскирует и баги на фронте, и попытки подсунуть данные мимо DTO.
- `transform` — включает `class-transformer`, чтобы тело/query/params реально становились экземпляром класса DTO, а не оставались plain-объектом. Без этого декораторы вроде `@Type(() => Number)` (понадобятся в T-018 для пагинации) не сработают.
- `transformOptions.enableImplicitConversion` — Fastify всегда отдаёт query-параметры строками; опция включает автоприведение примитивов (`"2" → 2`) без ручного `@Type()` на каждом поле.

**2. Создан [`AllExceptionsFilter`](../src/core/error-handling/all-exceptions.filter.ts):**

```typescript
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | string[] = 'Internal server error';
    if (isHttpException) {
      const response = exception.getResponse();
      message = typeof response === 'string' ? response : (response as { message: string | string[] }).message;
    }

    if (!isHttpException) {
      this.logger.error(`Unhandled exception: ${request.method} ${request.url}`, exception instanceof Error ? exception.stack : String(exception));
    }

    reply.status(status).send({ statusCode: status, message, path: request.url, timestamp: new Date().toISOString() });
  }
}
```

- `@Catch()` **без аргумента**, а не `@Catch(HttpException)` — принципиально: ловит вообще всё, включая не-`HttpException` (баг в сервисе, `TypeError`, будущий `QueryFailedError` от TypeORM). Иначе необработанная ошибка улетела бы мимо фильтра в дефолтный обработчик Nest.
- `FastifyReply`/`FastifyRequest`, а не Express `Response`/`Request` — проект на `@nestjs/platform-fastify`, у Fastify другой API ответа (`reply.status().send()`); это частая ошибка при копировании Express-примеров из интернета.
- Маскировка: для `HttpException` наружу уходит реальное сообщение (осознанные 400/404/etc — их текст безопасен и полезен клиенту), для всего остального — жёстко `'Internal server error'`, настоящий текст/stack пишутся только в лог. Это защита от случайной утечки деталей реализации через `500`.

**3. `ClassSerializerInterceptor` и `AllExceptionsFilter` зарегистрированы через DI, а не в `main.ts`:**

```typescript
// AppModule
providers: [
  { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
  { provide: APP_FILTER, useClass: AllExceptionsFilter },
],
```

`main.ts` выполняется только при реальном запуске приложения — тесты, поднимающие `Test.createTestingModule({ imports: [AppModule] }).compile()`, его не трогают вообще. Если регистрировать фильтр императивно через `app.useGlobalFilters(...)` в `main.ts` (так было сделано изначально, до ревью), в e2e-тестах он просто не применялся бы, и тест на формат ошибки проверял бы не то, что реально работает в проде. `APP_FILTER`/`APP_INTERCEPTOR` — провайдеры внутри модуля, поэтому подключаются одинаково и в реальном приложении, и в `TestingModule`.

Это стало общим правилом проекта: любой guard/filter/interceptor, который должен действовать глобально — через `APP_GUARD`/`APP_FILTER`/`APP_INTERCEPTOR` в `AppModule`, а не императивно в `main.ts`. Тот же принцип позже переиспользован в T-005 для `ThrottlerGuard`.

### Баг/пробел, который нашёлся только при ручной проверке

Первая версия тикета была отмечена как готовая только на основании чтения кода — реальной проверки через запрос не было. При попытке проверить руками выяснилось:
- Диагностических роутов, способных бросить не-`HttpException`-ошибку, в проекте не было вообще — `UsersModule`/`AuthModule` на тот момент были пустыми заглушками (реальные контроллеры — Эпик 1).
- Файл [`.http`](../.http) уже содержал черновые запросы `GET /test-errors/unknown` и `GET /test-errors/type-error`, но контроллер `test-errors` не существовал в `src`, а порт был указан `3000` — тогда как реальный `PORT` из `.env` — `3007` (совпадал только у `/health`). То есть заявленную проверку невозможно было выполнить, даже если бы контроллер существовал.

Решение — заведён временный [`TestErrorsController`](../src/core/error-handling/test-errors.controller.ts) с двумя ручками, которые намеренно бросают `Error` и `TypeError`, зарегистрирован в `AppModule.controllers`; порт в `.http` поправлен на `3007`.

### Как проверить руками

```bash
docker compose up -d   # для /health, но не обязателен для проверки самого фильтра
npm run start:dev

curl -s http://localhost:3007/test-errors/unknown
# → {"statusCode":500,"message":"Internal server error","path":"/test-errors/unknown","timestamp":"..."}

curl -s http://localhost:3007/test-errors/type-error
# → {"statusCode":500,"message":"Internal server error","path":"/test-errors/type-error","timestamp":"..."}
```

Оба ответа — без исходного текста ошибки/stack trace, но полный stack есть в консоли сервера (`this.logger.error(...)`) для отладки.

`ClassSerializerInterceptor` и `forbidNonWhitelisted`/`transform` живым запросом ещё не проверялись — в проекте пока нет ни одного реального DTO/сущности с `@Exclude()` (появятся в T-010/T-011). Стоит перепроверить вручную, как только они появятся.

### Затронутые файлы

- [`src/main.ts`](../src/main.ts)
- [`src/core/app/app.module.ts`](../src/core/app/app.module.ts)
- [`src/core/error-handling/all-exceptions.filter.ts`](../src/core/error-handling/all-exceptions.filter.ts) — новый
- [`src/core/error-handling/test-errors.controller.ts`](../src/core/error-handling/test-errors.controller.ts) — новый, временный (можно удалить, когда появятся реальные эндпоинты для ручной проверки фильтра)
- [`.http`](../.http)

---

## T-004. Health checks

### Проблема

`HealthModule`/`HealthController`/`HealthService` уже существовали, но `HealthService.checkHealth()` вызывал `healthCheckService.check([])` — с пустым списком индикаторов. Формально эндпоинт `GET /health` всегда отвечал `{ status: 'ok', details: {} }`, независимо от реального состояния БД/памяти/диска. Плюс оба спека (`health.service.spec.ts`, `health.controller.spec.ts`) были красными — `TestingModule` поднимался без нужных провайдеров.

### Что сделано

**1. Реальные индикаторы в [`health.service.ts`](../src/core/health/health.service.ts).**

Взяты три индикатора из `@nestjs/terminus` — ровно те, что подходят под стек проекта (TypeORM + Postgres, обычный Node-процесс, без внешних HTTP-зависимостей пока что):

```typescript
checkHealth() {
  const diskPath =
    this.configService.get('HEALTH_DISK_PATH') ||
    (process.platform === 'win32' ? 'C:\\' : '/');
  const diskThreshold = Number(this.configService.get('HEALTH_DISK_THRESHOLD'));

  return this.healthCheckService.check([
    () => this.db.pingCheck('database'),
    () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
    () => this.memory.checkRSS('memory_rss', 150 * 1024 * 1024),
    () => this.disk.checkStorage('storage', { path: diskPath, thresholdPercent: diskThreshold }),
  ]);
}
```

**2. `HealthModule` теперь импортирует `DatabaseModule`.**

`TypeOrmHealthIndicator` резолвит TypeORM-соединение через DI, а `DatabaseModule` не глобальный (`@Global()` не стоит) — значит, соединение видно только тем модулям, которые явно его импортировали. Без этого шага guard просто не находил бы зависимость.

**3. Конфиг для диска — `HEALTH_DISK_PATH` / `HEALTH_DISK_THRESHOLD`.**

Добавлены в [`config.types.ts`](../src/core/config/config.types.ts) и [`config.validation.ts`](../src/core/config/config.validation.ts), по тому же принципу, что и остальные переменные проекта (плоский список с Joi-схемой, дефолты через `.default()`).

### Баг, который нашёлся только при ручном прогоне

Изначально `HEALTH_DISK_PATH` имел статичный дефолт `'/'` прямо в Joi-схеме. Юнит-тесты (с замоканными индикаторами) это не ловили — они не исполняют реальный `check-disk-space`. Но при реальном запуске приложения на Windows (`HEALTH_CHECK_ENABLED=true`, `GET /health`) сервер падал:

```
InvalidPathError: The following path is invalid (should be X:\...): /
    at checkWin32 (...node_modules/check-disk-space/dist/check-disk-space.cjs:155:35)
```

`check-disk-space` (используется внутри `DiskHealthIndicator`) на Windows требует нативный путь (`C:\`), а не POSIX (`/`). **Вывод: захардкоженный дефолт в конфиг-схеме — плохая идея, если значение зависит от окружения (ОС, инфраструктура).** Правильное решение:
- убрать статичный `.default('/')` из Joi-схемы (`HEALTH_DISK_PATH` остаётся просто `optional()`, без дефолта);
- вычислять дефолт в коде, где он реально нужен: `this.configService.get('HEALTH_DISK_PATH') || (process.platform === 'win32' ? 'C:\\' : '/')`.

Этот же принцип пригодится в будущих тикетах: если дефолтное значение переменной окружения зависит от рантайма (ОС, окружение, доступность сервиса) — не зашивать его в схему валидации, а вычислять в коде рядом с использованием.

### Тесты

Оба спека переписаны с корректным `TestingModule`, где каждая зависимость подменена через `useValue`:

```typescript
const module: TestingModule = await Test.createTestingModule({
  providers: [
    HealthService,
    { provide: HealthCheckService, useValue: healthCheckService },
    { provide: ConfigService, useValue: configService },
    { provide: TypeOrmHealthIndicator, useValue: db },
    { provide: MemoryHealthIndicator, useValue: memory },
    { provide: DiskHealthIndicator, useValue: disk },
  ],
}).compile();
```

Важный момент: в проекте тесты гоняются через **Vitest**, а не Jest (`"test": "vitest run"` в `package.json`) — значит, моки нужно создавать через `vi.fn()` из пакета `vitest`, а не `jest.fn()` (в `vitest.config.ts` стоит `globals: true`, но глобальный `jest`-объект это не даёт — это разные раннеры).

Отдельно добавлен тест именно на платформенный фолбэк (`HEALTH_DISK_PATH` не задан → используется `C:\`/`/` в зависимости от `process.platform`) — раз баг нашёлся только руками, важно закрепить его тестом, чтобы не вернулся незаметно.

### Как проверить руками

```bash
# Postgres должен быть поднят (docker-compose up -d postgres)
HEALTH_CHECK_ENABLED=true npm run start
curl http://localhost:3007/health
# → {"status":"ok","details":{"database":{"status":"up"},"memory_heap":{"status":"up"},...}}

HEALTH_CHECK_ENABLED=false npm run start
curl http://localhost:3007/health
# → {"status":"ok","details":{}}
```

### Затронутые файлы

- [`src/core/health/health.module.ts`](../src/core/health/health.module.ts)
- [`src/core/health/health.service.ts`](../src/core/health/health.service.ts)
- [`src/core/health/health.service.spec.ts`](../src/core/health/health.service.spec.ts)
- [`src/core/health/health.controller.spec.ts`](../src/core/health/health.controller.spec.ts)
- [`src/core/health/README.MD`](../src/core/health/README.MD)
- [`src/core/config/config.types.ts`](../src/core/config/config.types.ts)
- [`src/core/config/config.validation.ts`](../src/core/config/config.validation.ts)
- [`.env.example`](../.env.example)

---

## T-005. Rate limiting

### Проблема

`ThrottlerModule` был настроен (хранилище + дефолтный лимит из `THROTTLE_GLOBAL_TTL`/`THROTTLE_GLOBAL_LIMIT`), но нигде не подключался guard, который реально проверяет лимиты на входящих запросах. Плюс требовались более строгие лимиты на `/auth/login`/`/auth/register` как защита от брутфорса.

### Куда добавлять глобальный guard — и почему не в `main.ts`

`APP_GUARD` — это DI-провайдер, который Nest резолвит на уровне модуля (как и `APP_FILTER`, `APP_INTERCEPTOR`, уже сделанные в T-003). Регистрировать его нужно **в модуле** — в данном случае в [`AppModule`](../src/core/app/app.module.ts), рядом с уже существующими `APP_FILTER`/`APP_INTERCEPTOR`:

```typescript
providers: [
  { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
  { provide: APP_FILTER, useClass: AllExceptionsFilter },
  { provide: APP_GUARD, useClass: ThrottlerGuard },
],
```

`main.ts` — это только bootstrap-уровень (адаптер Fastify, `useGlobalPipes`, `enableCors`, регистрация fastify-плагинов). Там нет DI-контейнера модуля, поэтому регистрировать через `app.useGlobalGuards(new ThrottlerGuard(...))` пришлось бы вручную тащить зависимости (`Reflector`, `ThrottlerStorage`, конфиг лимитов) — а через `APP_GUARD` в модуле Nest подставляет их сам, раз `ThrottlerModule` уже импортирован в `AppModule`.

**Общее правило для этого проекта**: guard/filter/interceptor, которые должны действовать глобально — всегда через `APP_GUARD`/`APP_FILTER`/`APP_INTERCEPTOR` в `AppModule`, а не императивно в `main.ts`. Это плюс к тому, что такие провайдеры тогда одинаково работают и в реальном приложении, и в `TestingModule`-тестах (то же соображение, что и в T-003 — см. `PLAN.md`).

### Исключение `/health` из лимитов

Как только guard стал глобальным, он начал бы применяться и к `GET /health` — а его обычно дёргает liveness/readiness-проба оркестратора очень часто, и она легко упёрлась бы в лимит. Решение — `@SkipThrottle()` на контроллере:

```typescript
@SkipThrottle()
@Controller('health')
export class HealthController { ... }
```

### Строгие лимиты на `/auth/login` и `/auth/register`

Технически — через именованный `@Throttle()` (конфиг `ThrottlerModule` не задаёт `name`, поэтому throttler по умолчанию называется `'default'` — под этим ключом и переопределяются лимиты):

```typescript
@Throttle({ default: { limit: 5, ttl: seconds(60) } })
@Post('login')
login() { ... }

@Throttle({ default: { limit: 3, ttl: seconds(60) } })
@Post('register')
register() { ... }
```

**Важная деталь, которая тут всплыла**: `AuthController`/`AuthModule`/`UsersModule` на момент T-005 были ещё пустыми заглушками (`@Module({})`) — реальный `/auth/login`/`/auth/register` появится только в T-011/T-012 (Эпик 1 «Работа с пользователями»), а `PLAN.md` явно требует соблюдать порядок эпиков (Эпик 0 → Эпик 1). Значит, вешать `@Throttle` было физически не на что.

Решение (согласовано отдельно): завести в `AuthController` **временные заглушки** `login`/`register` — не реализующие логику, а только чтобы у лимитов было к чему крепиться. Настоящая auth-логика (DTO, `AuthService`, guard-декораторы вроде `@Public()`/`@CurrentUser()`) — предмет T-011/T-012, при их реализации заглушки заменяются на настоящие хендлеры, а декораторы `@Throttle` просто переезжают вместе с методом — контракт лимитов не меняется.

```typescript
@Controller('auth')
export class AuthController {
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login() {
    return { message: 'Not implemented yet' };
  }

  @Throttle({ default: { limit: 3, ttl: seconds(60) } })
  @Post('register')
  register() {
    return { message: 'Not implemented yet' };
  }
}
```

> На момент начала T-005 в `auth.controller.ts` уже лежал набросок полного auth-флоу (login/refresh/me) со ссылками на несуществующие `AuthService`, DTO и декораторы (`@Public`, `@CurrentUser`) — файл не компилировался. Решили не достраивать всё это заранее (это увело бы далеко за рамки T-005, во внеочередную реализацию T-011–T-014), а урезать до минимальной компилируемой заглушки именно под лимиты.

### Как проверить руками

```bash
# Глобальный лимит на роуте без аннотаций (THROTTLE_GLOBAL_LIMIT=10 / THROTTLE_GLOBAL_TTL=10000ms)
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3007/test-errors/unknown; done
# → 10 раз 500, затем 429

# Строгий лимит на login (5 / 60с)
for i in $(seq 1 7); do curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3007/auth/login; done
# → 5 раз 200, затем 429

# Строгий лимит на register (3 / 60с)
for i in $(seq 1 5); do curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3007/auth/register; done
# → 3 раза 201, затем 429

# /health не должен блокироваться никогда
for i in $(seq 1 8); do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3007/health; done
# → всегда 200
```

Все четыре сценария проверены вручную на реально запущенном приложении и подтверждены именно с такими результатами.

### Затронутые файлы

- [`src/core/app/app.module.ts`](../src/core/app/app.module.ts)
- [`src/core/health/health.controller.ts`](../src/core/health/health.controller.ts)
- [`src/modules/auth/auth.controller.ts`](../src/modules/auth/auth.controller.ts)
- [`src/modules/auth/auth.module.ts`](../src/modules/auth/auth.module.ts)
- [`src/modules/auth/auth.controller.spec.ts`](../src/modules/auth/auth.controller.spec.ts)
- [`src/core/throttler/README.MD`](../src/core/throttler/README.MD)

---

## T-008. OpenAPI/Swagger

### Проблема

`@nestjs/swagger` уже был в зависимостях (`package.json`), но `main.ts` вообще не поднимал `SwaggerModule` — документировать API было нечем. Черновая версия правки, с которой стартовала эта сессия, компилировалась в голове, но не в TypeScript — реальная проверка (`tsc --noEmit` + запуск) нашла сразу несколько багов в самом коде инициализации, см. ниже.

### Что сделано

**1. Заголовок/версия/путь документации берутся из конфига, а не хардкодятся:**

```typescript
const configService = app.get(ConfigService);

const appName = configService.get('APP_NAME');
const apiVersion = configService.get('API_VERSION');
const swaggerPath = configService.get('SWAGGER_PATH');
...
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
```

Ключи `APP_NAME`/`API_VERSION`/`SWAGGER_PATH` уже существовали в `Config` (заведены в T-001 — плоский список без `registerAs`-неймспейсов) с дефолтами в Joi-схеме (`'Prism'`/`'1'`/`'api/docs'`). Поэтому даже без явных значений в `.env` заголовок/версия/путь документации всегда определены, а не `undefined`.

**2. Теги в `DocumentBuilder` заведены сразу под все модули из `PLAN.md`, а не только под уже существующие контроллеры.**

`Users` и `Transformations` в спеке пока не привязаны ни к одному роуту (`UsersModule` и модуль трансформации файлов — Эпик 1/2, ещё не реализованы), но тег уже зарезервирован в `.addTag(...)` — так пункт T-008 «теги под будущие модули» закрывается один раз сейчас, а не будет откладываться на каждый будущий модуль по отдельности. Существующие контроллеры размечены `@ApiTags(...)` с именем, точно совпадающим с тегом в `DocumentBuilder`:

```typescript
@ApiTags('Auth')
@Controller('auth')
export class AuthController { ... }
```

(аналогично — `@ApiTags('Health')` в [`health.controller.ts`](../src/core/health/health.controller.ts), `@ApiTags('Diagnostics')` в [`test-errors.controller.ts`](../src/core/error-handling/test-errors.controller.ts)). Совпадение имён важно: Swagger UI группирует эндпоинты по тегу как по строковому ключу — опечатка в `@ApiTags('auth')` (с маленькой буквы) создала бы в интерфейсе отдельную пустую группу вместо попадания в `Auth`.

**3. `.addBearerAuth()` — схема авторизации заведена в спеке заранее, до появления самих защищённых роутов.**

Реальный JWT-guard появится только в T-012, но добавить схему в `DocumentBuilder` дешевле сделать сразу: как только у эндпоинта появится `@UseGuards(JwtAuthGuard)` + `@ApiBearerAuth()`, в Swagger UI сразу появится кнопка «Authorize», без повторного возврата к настройке документа.

**4. `SwaggerModule.setup(...)` вызывается прямо в `main.ts`, а не регистрируется через DI-провайдер — и это осознанное отличие от паттерна T-003/T-005.**

`AllExceptionsFilter`/`ThrottlerGuard` регистрируются через `APP_FILTER`/`APP_GUARD` в `AppModule` именно для того, чтобы одинаково работать и в реальном приложении, и в `TestingModule`-тестах. Для Swagger это не имеет смысла: `SwaggerModule.setup()` мутирует роутинг напрямую через уже созданный HTTP-адаптер (`NestFastifyApplication`), не участвует в цепочке DI-провайдеров запроса и не тестируется юнит/e2e-тестами («Swagger UI отдаёт HTML» — не то, что в этом проекте покрывается тестами). Это тот же класс операций, что `enableCors`/`app.register(fastifyCookie)` — чистый bootstrap, поэтому его место в `main.ts`.

### Баг, который нашёлся только при ручной проверке

Черновая версия использовала несуществующий у этого проекта namespace-синтаксис ключей конфига и обращалась к `configService` до его объявления:

```typescript
// было — не проходит tsc и не может дойти до рантайма
const appName = configService.get<string>('app.name', 'Prism'); // configService используется до объявления (TDZ)
const port = configService.get<number>('app.port', 3007);       // 'app.port' — не ключ Config; второй аргумент сигнатурой не предусмотрен
...
const configService = app.get(ConfigService); // само объявление — ниже использования
...
const port = configService.get('PORT'); // повторный `const port` в той же функции
```

Сразу три независимые проблемы в одном месте:
- `ConfigService.get()` в этом проекте — не стандартный метод `@nestjs/config` с сигнатурой `(key, defaultValue)`, а собственная обёртка ([`config.service.ts`](../src/core/config/config.service.ts)) с `get<T extends keyof Config>(key: T): string` — один аргумент, ключ обязан быть из плоского `Config` (T-001 сознательно отказался от `registerAs`-неймспейсов вроде `app.*`).
- `configService` использовался до `const configService = app.get(ConfigService)` — TS помечает это как `used before its declaration`, в рантайме это `ReferenceError` через temporal dead zone.
- `port` был объявлен дважды в одной функции (`TS2451: Cannot redeclare block-scoped variable`).

Ни один из этих багов не был бы заметен при беглом чтении диффа — только `npx tsc --noEmit -p tsconfig.json` (упал бы с TS2554/TS2345/TS2451) и реальный `npm run start:dev` подтвердили, что итоговая версия (см. выше) действительно собирается и стартует. Тот же вывод, что и в T-004 с путём для диска: конфиг-код в `main.ts` нужно прогонять через компилятор и живой запуск, а не только вычитывать глазами.

### Как проверить руками

```bash
docker compose up -d                       # Postgres нужен для полного старта приложения
npx tsc --noEmit -p tsconfig.json          # → 0 ошибок
npm run start:dev

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3007/api/docs        # → 200 (Swagger UI)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3007/api/docs-json   # → 200

curl -s http://localhost:3007/api/docs-json | node -e "
let d=''; process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  const j = JSON.parse(d);
  console.log(j.info);                        // { title: 'Prism', version: '1', ... }
  console.log(j.tags.map(t => t.name));        // ['Auth','Users','Transformations','Health','Diagnostics']
  console.log(j.components.securitySchemes);   // { bearer: { scheme: 'bearer', bearerFormat: 'JWT', type: 'http' } }
});
"
```

Все три проверки выполнены на реально поднятом приложении (Postgres в Docker, `npm run start:dev`) и подтверждены именно с такими результатами; `vitest run` (12/12 тестов) остаётся зелёным после правки.

### Известный, пока не закрытый пробел

`SWAGGER_PATH` берётся из конфига и реально применяется (`SwaggerModule.setup(swaggerPath, ...)`), а вот `API_PREFIX` ([`config.types.ts`](../src/core/config/config.types.ts), дефолт `'api'` в Joi-схеме) заведён в конфиг ещё в T-001, но нигде не используется — `app.setGlobalPrefix(apiPrefix)` в `main.ts` не вызывается. Из-за этого все роуты сейчас висят на корне (`/auth/login`), а не под `/api/auth/login`, хотя переменная окружения для префикса уже существует. `PLAN.md` в T-008 явно требует только «базовую настройку `SwaggerModule`, теги под будущие модули, `DocumentBuilder` с bearer-auth» — все три пункта закрыты; подключать `setGlobalPrefix` в рамках этого тикета не стали, чтобы не расширять его скоуп — но при следующей ревизии `main.ts` этот неиспользуемый ключ конфига стоит либо применить, либо явно решить, что префикс проекту не нужен, и убрать его из схемы.

### Затронутые файлы

- [`src/main.ts`](../src/main.ts)
- [`src/modules/auth/auth.controller.ts`](../src/modules/auth/auth.controller.ts) — `@ApiTags('Auth')`
- [`src/core/health/health.controller.ts`](../src/core/health/health.controller.ts) — `@ApiTags('Health')`
- [`src/core/error-handling/test-errors.controller.ts`](../src/core/error-handling/test-errors.controller.ts) — `@ApiTags('Diagnostics')`
- [`src/core/config/config.types.ts`](../src/core/config/config.types.ts) / [`config.validation.ts`](../src/core/config/config.validation.ts) — проверены, не менялись (ключи были заведены ещё в T-001)

---

## Сквозная правка: lint/CI-гигиена

Не привязано к одному тикету — это находки при финальном ревью T-005 (полный `eslint`-прогон по всему `src`), которые чинились, чтобы `npm run lint` был зелёным в будущем CI (пока `.github/workflows` ещё нет — см. T-009).

| Файл | Проблема | Фикс |
|---|---|---|
| [`.prettierrc`](../.prettierrc) | `endOfLine` нигде не был закреплён явно, Prettier полагался на дефолт | добавлена строка `"endOfLine": "lf"` — теперь поведение не зависит от неявных дефолтов/настроек редактора |
| [`all-exceptions.filter.ts`](../src/core/error-handling/all-exceptions.filter.ts) | CRLF-окончания строк по всему файлу | `eslint --fix` нормализовал в LF |
| [`database.module.ts`](../src/core/database/database.module.ts) | `dataSourceFactory` помечен `async`, но внутри нет `await` (`require-await`) | убран `async`, возврат обёрнут в `Promise.resolve(...)` — тип `Promise<DataSource>` сохранён |
| [`main.ts`](../src/main.ts) | `bootstrap();` без обработки промиса (`no-floating-promises`) | `void bootstrap();` |
| [`config.service.ts`](../src/core/config/config.service.ts) | `super.get(key)` резолвился в `any` (`no-unsafe-assignment`) | явный дженерик: `super.get<string>(key)` |
| [`test/app.e2e-spec.ts`](../test/app.e2e-spec.ts) | `import * as request from 'supertest'` — при `esModuleInterop` даёт нецелевой объект вместо вызываемой функции (`supertest` использует `export =`) | заменено на `import request from 'supertest'` |

**Известная, сознательно не тронутая проблема**: `test/app.e2e-spec.ts` теперь корректно типизируется, но при реальном запуске (`npm run test:e2e`) падает — `NODE_ENV` не проходит Joi-валидацию в тестовом окружении, плюс тестируемый роут `/ (GET)` с `"Hello World!"` — это остаток дефолтного `nest new`-шаблона, которого в приложении никогда не было (это не про lint, а про сам тест — не входило в scope этой правки).

---

## Как пользоваться этим документом дальше

При закрытии следующего тикета — по тому же принципу:
1. Раздел `## T-0XX. <Название>` с проблемой, решением (с ключевыми фрагментами кода) и объяснением **почему** выбран именно такой подход, а не альтернативы.
2. Если что-то всплыло только при ручной проверке (как баг с диском на Windows) — отдельным подразделом, это самая ценная часть для будущего «я».
3. Раздел «Как проверить руками» с конкретными командами.
4. Список затронутых файлов.

Общий план по тикетам и текущий статус — в [`PLAN.md`](./PLAN.md); этот документ — приложение к нему с деталями реализации.
