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

## T-010. User entity + миграция

### Проблема

Первая реальная сущность и первая миграция в проекте — до этого `src/modules/users` состоял только из пустого `UsersModule`, а `src/database/migrations` был пустым каталогом (`.gitkeep`). Задача — не только завести таблицу `users`, но и обкатать сам процесс `entity → migration:generate → migration:run`, потому что по этому же процессу дальше пойдут все следующие тикеты (T-011 — `email_verifications`, и так далее).

### Что сделано

**1. Enum роли — [`user-role.enum.ts`](../src/modules/users/user-role.enum.ts):**

```typescript
export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
}
```

Вынесен отдельным файлом, а не внутри entity — переиспользуется в T-013 (RBAC, `@Roles()`/`RolesGuard`) без завязки на саму entity.

**2. Entity — [`user.entity.ts`](../src/modules/users/entities/user.entity.ts):**

```typescript
@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  email: string;

  @Exclude()
  @Column({ type: 'varchar' })
  passwordHash: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Column({ type: 'boolean', default: false })
  isEmailVerified: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
```

`@Exclude()` из `class-transformer` — критично для `passwordHash`: без него хэш пароля утёк бы в любой ответ API, где отдаётся `User` целиком. Работает благодаря `ClassSerializerInterceptor`, зарегистрированному глобально ещё в T-003 — T-010 просто первый раз реально этим пользуется.

**3. `UsersModule` — подключён `TypeOrmModule.forFeature([User])`:**

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  exports: [TypeOrmModule],
})
export class UsersModule {}
```

`autoLoadEntities: true` в [`database.module.ts`](../src/core/database/database.module.ts) подхватывает entity глобально для построения схемы, но `forFeature` нужен отдельно — без него `@InjectRepository(User)` в будущем `UsersService` (T-011) не заработает.

**4. Миграция сгенерирована и применена** — детали и три найденных по пути бага см. ниже.

### Баги, которые нашлись только при реальном прогоне (не при чтении кода)

**1. `migration:generate`/`migration:create` в `package.json` не давали задать своё имя файла.** Скрипты были захардкожены с именем `Migration`:
```json
"migration:generate": "npm run typeorm -- migration:generate src/database/migrations/Migration -d src/database/data-source.ts"
```
`npm run migration:generate -- src/database/migrations/CreateUsers` не заменяет этот путь, а **дописывает** его вторым позиционным аргументом — TypeORM CLI получает два пути вместо одного и падает с ошибкой "too many non-option arguments". Фикс — убрать хардкод имени из скрипта, оставить только обязательный флаг `-d`:
```json
"migration:create": "npm run typeorm -- migration:create",
"migration:generate": "npm run typeorm -- migration:generate -d src/database/data-source.ts",
```
Теперь путь передаётся снаружи как единственный позиционный аргумент, как и предполагает сама команда.

**2. `data-source.ts` экспортировал один и тот же `DataSource` дважды** — именованно и как `default`:
```typescript
export const dataSource = new DataSource({ ... });
...
export default dataSource;
```
TypeORM CLI при загрузке data-source-файла перебирает **все** его экспорты и собирает среди них инстансы `DataSource`. Он находит два разных ключа экспорта (`dataSource` и `default`), хотя физически это один и тот же объект — и падает с `Error: Given data source file must contain only one export of DataSource instance`. Фикс — оставить только `export default`, убрать дублирующий именованный экспорт (проверено грепом по `src/`/`test/` — нигде не импортировался по имени `dataSource`, только через `-d`-флаг CLI).

**3. CLI сгенерировал файл `...CreateUsers.ts`, при переименовании закралась опечатка — `...CreateUsers.migrations.ts` (множественное число).** [`database.module.ts`](../src/core/database/database.module.ts) и [`data-source.ts`](../src/database/data-source.ts) ищут миграции строго по глобу `*.migration{.ts,.js}` (единственное число) — с лишней `s` файл просто не подхватился бы при `migration:run`, без единой ошибки в консоли (миграция бы молча не применилась). Переименовано в `1788263476577-CreateUsers.migration.ts`.

**4. Сгенерированная миграция создаёт `id` через `uuid_generate_v4()`, но не создаёт расширение, от которого эта функция зависит.** `uuid_generate_v4()` — не встроенная функция Postgres, а часть расширения `uuid-ossp`. В контейнере разработки расширение оказалось уже включено (по всей видимости, TypeORM создал его сам при каком-то более раннем прогоне с `synchronize: true`), поэтому `migration:run` прошёл бы и без явного создания расширения — но только на этой, уже "тёплой" базе. На честно пустом Postgres (свежий `docker compose up` после `down -v`, CI, коллега с чистым volume) миграция упала бы с `function uuid_generate_v4() does not exist`. Добавлено первой строкой в `up()`:
```typescript
await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
```
В `down()` `DROP EXTENSION` сознательно не добавлялся — расширение общее на уровне БД, откат конкретно этой миграции не должен выдёргивать его из-под других объектов, если они появятся позже.

### Теория: что происходит на самом деле

**Реляционная база данных** — это способ хранить данные в виде таблиц со строго заданной структурой (у каждой таблицы — фиксированный набор колонок с типами), где строки в разных таблицах могут ссылаться друг на друга (например, будущая таблица `email_verifications` в T-011 будет ссылаться на `users.id`). Postgres — конкретная СУБД (система управления базами данных), которая эти таблицы физически хранит на диске и выполняет запросы к ним. Ключевое свойство реляционных БД, которое здесь важно, — **схема** (structure) заранее фиксирована: нельзя просто взять и вставить строку с произвольным набором полей, как в MongoDB, — таблица должна уже существовать с нужными колонками и типами.

**Миграция** — это файл с кодом (в TypeORM — TypeScript-класс с методами `up()`/`down()`), который описывает **одно конкретное изменение** схемы БД: создать таблицу, добавить колонку, создать индекс и т.д. Зачем это нужно вместо того, чтобы просто один раз создать таблицы руками через DBeaver:
- **Воспроизводимость.** Миграция — это код, который лежит в git рядом с приложением. Любой человек (или CI-система, или прод-сервер при деплое) может взять чистую БД и, прогнав все миграции по порядку, получить точно ту же структуру, что и у всех остальных. Ручные правки через DBeaver у каждого разработчика разъехались бы по-своему.
- **История изменений.** Каждая миграция — это маленький, именованный, датированный шаг ("добавили таблицу users", "добавили колонку X"). Видно, что и когда менялось, и это ревьюится в PR как обычный код.
- **Автоматизация.** `migrationsRun: true` (см. `POSTGRES_MIGRATIONS_RUN` в `database.module.ts`) позволяет прогонять миграции автоматически при старте приложения — не нужно никому вручную ничего создавать при деплое.

**`migration:generate`** — это не выполнение изменений в БД, а **сравнение** двух состояний: того, что описано в entity-классах (`@Entity`/`@Column` и т.д.), и того, что реально сейчас в подключённой БД. Разницу TypeORM переводит в SQL и записывает в новый файл. На этом этапе реальная БД не меняется вообще — файл просто лежит на диске.

**`migration:run`** — а вот это уже реальное выполнение: TypeORM подключается к БД, смотрит служебную таблицу `migrations` (какие миграции там уже отмечены как применённые), и для всех новых по порядку выполняет их метод `up()` — то есть реально шлёт `CREATE TABLE`/`CREATE TYPE`/и т.д. в Postgres. После успешного выполнения каждой миграции в таблицу `migrations` добавляется строка — это и есть "отметка о том, что применено", благодаря которой повторный `migration:run` не выполнит те же самые команды ещё раз.

**`migration:revert`** — обратная операция: берёт **последнюю** применённую миграцию (по таблице `migrations`) и выполняет её метод `down()` — то есть SQL, который отменяет ровно то, что сделал `up()` (в нашем случае `DROP TABLE users` + `DROP TYPE users_role_enum`). Строка из таблицы `migrations` удаляется. Важно: `down()` пишется руками (точнее, TypeORM сгенерировал его автоматически по инвертированному diff, но это не гарантия — сложные миграции иногда нужно поправить руками), и если он написан неправильно/неполно, откатить миграцию будет невозможно — поэтому `migration:revert` стоит проверять руками так же, как и `migration:run`, а не считать, что раз `up()` сработал, то и `down()` сработает автоматически.

**За что отвечают конкретные SQL-команды в нашей миграции:**
- `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` — включает в БД дополнительный модуль Postgres, добавляющий функции генерации UUID (`uuid_generate_v4()`), которых нет в "чистом" Postgres из коробки.
- `CREATE TYPE "public"."users_role_enum" AS ENUM('user', 'admin')` — создаёт в Postgres собственный перечислимый тип данных: колонка с этим типом может содержать только одно из перечисленных значений, БД сама отклонит попытку записать туда что-то ещё (это и есть источник истины для enum `role`, а не только проверка на уровне TypeScript).
- `CREATE TABLE "users" (...)` — создаёт саму таблицу с колонками, типами, значениями по умолчанию (`DEFAULT 'user'`, `DEFAULT false`, `DEFAULT now()`) и двумя constraint'ами: `UNIQUE ("email")` (Postgres физически не даст вставить вторую строку с таким же `email`) и `PRIMARY KEY ("id")` (гарантирует уникальность и служит для быстрого поиска по `id`, под капотом это тоже уникальный индекс).
- `DROP TABLE "users"` / `DROP TYPE "public"."users_role_enum"` (в `down()`) — обратные операции, физически удаляют таблицу и тип из БД со всеми данными, которые в ней были.

### Как проверить руками

Проверено на реально поднятом через `docker compose up -d` Postgres (контейнер `mnt-postgres`, healthy).

**Через терминал:**
```bash
npm run migration:generate -- src/database/migrations/CreateUsers   # создаёт файл миграции, БД не трогает
# переименовать *.ts → *.migration.ts, если нужно
npm run migration:run                                                # реально создаёт таблицу/тип в БД
npm run migration:revert                                             # откатывает — таблица/тип удаляются
npm run migration:run                                                # возвращаем таблицу для дальнейшей работы
```

**Через DBeaver** (New Connection → PostgreSQL → `localhost:5432`, база `app`, юзер/пароль из `.env`):
1. `Schemas → public → Tables` — таблица `users` появляется после `migration:run`, пропадает после `migration:revert`.
2. Таблица `migrations` — после `migration:run` там одна строка с именем `CreateUsers...`.
3. SQL Editor:
   ```sql
   INSERT INTO users (email, "passwordHash") VALUES ('test@test.com', 'x');
   INSERT INTO users (email, "passwordHash") VALUES ('test@test.com', 'y'); -- падает: duplicate key value violates unique constraint
   ```
   Подтверждено — второй `INSERT` падает на unique constraint, как и требует acceptance-критерий тикета.
4. Дефолты подтверждены визуально в Data-вкладке: у вставленной строки `role = 'user'`, `isEmailVerified = false`, `createdAt`/`updatedAt` заполнены автоматически.

### Затронутые файлы

- [`src/modules/users/user-role.enum.ts`](../src/modules/users/user-role.enum.ts) — новый
- [`src/modules/users/entities/user.entity.ts`](../src/modules/users/entities/user.entity.ts) — новый
- [`src/modules/users/users.module.ts`](../src/modules/users/users.module.ts)
- [`src/database/migrations/1788263476577-CreateUsers.migration.ts`](../src/database/migrations/1788263476577-CreateUsers.migration.ts) — новый
- [`src/database/data-source.ts`](../src/database/data-source.ts) — убран дублирующий именованный экспорт
- [`package.json`](../package.json) — убран хардкод имени файла в `migration:create`/`migration:generate`

---

## T-011. Регистрация — Фазы 1–3: конфиг, `EmailVerification`, сервисы

T-011 — большой тикет (полный контракт в [T-010-011-registration.md](tickets/T-010-011-registration.md)), реализуется по фазам, отдельным от разделов самого тикета. Этот раздел закрывает первые три: конфиг/библиотеки, сущность `EmailVerification`, и слой сервисов (`MailerService`, `PasswordService`, `UsersService`, `EmailVerificationService`, `AuthService.register()`). DTO, эндпоинты и тесты — предмет следующих фаз, здесь не описаны.

### Фаза 1 — конфиг и библиотеки

**Проблема.** До этой фазы в проекте не было ни `argon2` (хэширование паролей), ни почтовой инфраструктуры вообще, ни ключей конфига под подтверждение email/пароли/SMTP.

**Что сделано:**
- `npm install argon2` (свои типы внутри пакета, `@types/argon2` не нужен) и `npm install --save-dev @types/nodemailer` (у `nodemailer` собственных типов нет — без этого пакета `import nodemailer from 'nodemailer'` не компилируется).
- В [config.types.ts](../src/core/config/config.types.ts) и [config.validation.ts](../src/core/config/config.validation.ts) добавлены блоки `AUTH_REGISTER_*`, `EMAIL_VERIFICATION_*`, `OTP_LENGTH`, `AUTH_PASSWORD_*`, `MAIL_*` — тот же плоский стиль с Joi-дефолтами, что и остальной `Config` (T-001).
- Сервис `mailpit` добавлен в [docker-compose.yml](../docker-compose.yml) (образ `axllent/mailpit`, порт `1025` — SMTP, `8025` — веб-UI для просмотра писем).

**Теория: зачем два слоя валидации конфига (Joi + TypeScript), а не один.** `Config` в [config.types.ts](../src/core/config/config.types.ts) — это контракт **времени компиляции**: TypeScript проверяет его только пока файлы превращаются в JS, в рантайме этого типа физически не существует (стирается при компиляции). Joi-схема в [config.validation.ts](../src/core/config/config.validation.ts) — это контракт **времени выполнения**: она реально исполняется один раз при старте Node-процесса (внутри `NestConfigModule.forRoot({ validationSchema })`) и проверяет `process.env`. Нужны оба: без Joi опечатка в значении `.env` (например, `MAIL_PORT=abc`) обнаружится только в момент, когда код реально попробует использовать это значение — то есть где-то в середине обработки запроса, а не при старте приложения. Без TypeScript-интерфейса опечатка в **имени** ключа (`configService.get('MAIL_HOSTT')`) прошла бы и компиляцию, и Joi (Joi же не знает про несуществующий ключ, если он просто нигде не запрашивается) — обнаружилась бы только когда `undefined` дошёл бы до `nodemailer` и тот упал бы с непонятной ошибкой подключения.

**Найденная в Фазе 3 ошибка, которая обесценивала именно эту часть Фазы 1** — см. ниже, пункт про `ConfigService`.

### Фаза 2 — `EmailVerification` entity + миграция

**Что сделано** (аналогично T-010 — `email-verification-method.enum.ts`, `entities/email-verification.entity.ts`, `TypeOrmModule.forFeature([EmailVerification])` в `AuthModule`, миграция `CreateEmailVerifications`): таблица с `userId` (FK → `users.id`, `ON DELETE CASCADE`, отдельный индекс), `method`/`codeHash`/`expiresAt`/`attemptsUsed`/`consumedAt`/`lastSentAt`/`createdAt`. Проверено в DBeaver: FK физически работает (вставка с несуществующим `userId` падает), `ON DELETE CASCADE` реально удаляет связанные строки при удалении пользователя, отдельный `NOT NULL`-constraint отсутствует именно у `consumedAt`/`lastSentAt` (как и требовалось — они nullable).

**Баг, который нашёлся только при попытке сгенерировать миграцию (не при чтении кода):**

```
Error: Cannot find module '@/modules/users/entities/user.entity'
```

`email-verification.entity.ts` — первый файл в проекте, где вообще понадобилась связь **между модулями** (`auth` → `users`), поэтому первый раз всплыла разница в том, как алиас `@/*` резолвится в разных инструментах проекта:
- `npm run start:dev` — резолвит `@nestjs/cli`, у него свой встроенный компилятор, который умеет `paths` из `tsconfig.json`;
- тесты — резолвит `vite-tsconfig-paths`, явно подключённый плагин в [vitest.config.ts](../vitest.config.ts);
- а `typeorm-ts-node-commonjs` (то, что реально стоит за `migration:generate`/`migration:run`) — это голый `ts-node` (`require("ts-node").register()`), без вообще какой-либо обработки алиасов.

**Теория: почему это вообще так работает.** `paths` в `tsconfig.json` — это конструкция **только для TypeScript-компилятора и его пользователей** (проверка типов, автокомплит в IDE). Сам Node.js ничего не знает про `tsconfig.json` — его алгоритм разрешения модулей (`require()`/`import` в CommonJS) умеет резолвить только относительные пути (`./`, `../`) и имена пакетов из `node_modules`. Когда TypeScript компилируется в обычный JS, строка `import { User } from '@/modules/users/entities/user.entity'` остаётся в выходном коде буквально как есть (алиас не переписывается автоматически) — и когда Node пытается выполнить `require('@/modules/users/entities/user.entity')`, он честно не находит такого пакета. Каждый инструмент, который "умеет" `@/*`, на самом деле подключает отдельный плагин, который перехватывает `require`/`import` и вручную подменяет алиас на реальный путь — `ts-node` из коробки этого не делает.

**Фикс** — зарегистрирован `tsconfig-paths/register` для `ts-node` через секцию `ts-node` в [tsconfig.json](../tsconfig.json):
```json
"ts-node": {
  "require": ["tsconfig-paths/register"]
}
```
`tsconfig-paths` — отдельный пакет, который как раз и делает то самое перехватывание `require()` и подстановку алиасов по `paths` из `tsconfig.json`; добавлен в `devDependencies` явно (был доступен только транзитивно через `vite-tsconfig-paths`, а полагаться на транзитивную зависимость для прямого `require()` в другом месте — хрупко: она может пропасть, если у `vite-tsconfig-paths` сменится дерево зависимостей).

Заодно — раз уж каждый раз руками переименовывать сгенерированный файл под `*.migration.ts` стало неудобно — [scripts/migration-generate.js](../scripts/migration-generate.js) оборачивает вызов TypeORM CLI и сам переименовывает новый файл, `package.json`-скрипт `migration:generate` указывает на этот скрипт вместо прямого вызова CLI.

### Фаза 3 — сервисы

**Что должно было получиться:** пять сервисов, которые вместе выполняют `AuthService.register()` — проверить уникальность email → захэшировать пароль → создать пользователя → (если включено подтверждение) сгенерировать код и отправить письмо.

**Реальность после первого прохода — 5 конкретных проблем, ни одна не была видна без реальной проверки:**

**1. `MailerService` существовал, а `MailerModule` — нет.** Файл [mailer.service.ts](../src/core/mailer/mailer.service.ts) был написан, но никакой модуль его не регистрировал как provider.

**2. `AuthModule`/`UsersModule` не знали о новых сервисах.** `AuthService`, `PasswordService`, `EmailVerificationService` не значились в `providers` `AuthModule`; `UsersService` не значился в `providers` `UsersModule`; `AuthModule` не импортировал ни `UsersModule`, ни (несуществующий) `MailerModule`.

**Теория: почему это вообще ломает всё, а не работает "почти".** DI (Dependency Injection) в Nest — это не магия, а конкретный механизм: при старте приложения Nest проходит по каждому модулю, смотрит его `providers`, и для каждого класса там регистрирует в внутреннем контейнере пару "токен (обычно сам класс) → как создать инстанс". Когда где-то в конструкторе стоит `private readonly mailerService: MailerService`, Nest должен найти токен `MailerService` в контейнере **того модуля, где объявлен потребитель, или в одном из модулей, что он явно `imports`** (и то только если исходный модуль этот provider `exports`). Ключевое слово — **явно**: Nest не сканирует файловую систему в поисках классов с `@Injectable()`, ему обязательно нужна декларация в `providers`/`imports`/`exports`. Класс без единого упоминания в `@Module(...)` для Nest как будто не существует — отсюда фикс: дописать `providers: [AuthService, PasswordService, EmailVerificationService]`, `imports: [..., UsersModule, MailerModule]` в `AuthModule`, `providers: [UsersService]`/`exports: [..., UsersService]` в `UsersModule`. Без этого при старте приложения Nest выбросил бы `Nest can't resolve dependencies of the AuthService (?, ...)`.

**3. `ConfigService` импортировался из `@nestjs/config`, а не из `@/core/config/config.service`.** Все три новых сервиса (`mailer.service.ts`, `email-verification.service.ts`, `auth.service.ts`) сначала брали "сырой" `ConfigService` из библиотеки. Технически это не падает — `NestConfigModule.forRoot()` регистрирует свой `ConfigService` глобально, и приложение находит хоть какой-то `ConfigService`. Но это именно тот `ConfigService`, у которого `get<T = any>(key: string, defaultValue？: T)` — без ограничения на конкретные ключи. Использование библиотечного класса вместо собственной обёртки [config.service.ts](../src/core/config/config.service.ts) (`get<T extends keyof Config>(key: T)`) обнуляло весь смысл Фазы 1: `configService.get('MAIL_HOSTT')` с опечаткой в имени ключа компилировался бы без единой ошибки. Исправлено импортом из `@/core/config/config.service` во всех трёх файлах.

**4. `crypto` использовался без импорта, и часть методов `EmailVerificationService` были не реализованы.** `email-verification.service.ts` использовал `crypto.randomBytes(...)`/`crypto.createHash(...)`, но нигде не было `import * as crypto from 'node:crypto'`. `npx tsc --noEmit` на это ругался неочевидно — не "crypto is not defined", а `Property 'randomBytes' does not exist on type 'Crypto'`, потому что TypeScript находил **другой** глобальный `crypto` — Web Crypto API (`globalThis.crypto`), который Node предоставляет из коробки начиная с 19-й версии для совместимости с браузерным API, и у него совсем другой набор методов (`crypto.subtle.digest(...)`, а не `crypto.createHash(...)`). Это конкретный пример того, что в современном Node существуют два разных `crypto` с похожими именами и разными API — модуль `node:crypto` (классический, `randomBytes`/`createHash`/`randomInt`) и глобальный объект Web Crypto (`crypto.subtle`, `crypto.randomUUID()`). Нужен именно первый, явным импортом. Заодно `confirm()`/`canResend()`/`generateOtp()` в этом файле оказались вообще без реализации (только комментарий вместо тела метода) — дописаны полностью, с распределением по кодам ошибок из таблицы тикета (`NotFoundException`/`BadRequestException`/`HttpException(429)`).

**5. `EmailVerificationService.issue()` использовал `repo.upsert(data, ['userId'])`, а в БД на `userId` нет unique-constraint.** `upsert` в TypeORM компилируется в SQL `INSERT ... ON CONFLICT ("userId") DO UPDATE ...` — а `ON CONFLICT` в Postgres физически требует unique- или exclusion-constraint именно на указанных колонках; в Фазе 2 на `userId` создан только обычный (не уникальный) индекс, для ускорения поиска, не для `ON CONFLICT`. Первый же вызов `issue()` упал бы в рантайме с `there is no unique or exclusion constraint matching the ON CONFLICT specification` — эта ошибка не ловится ни компилятором, ни линтером, только реальным запросом к БД. Заменено на explicit `findOneBy({ userId })` + `save({ ...existing, ...newData })`: если строка есть, у неё уже есть `id`, и `save()` с уже существующим `id` в TypeORM выполняет `UPDATE`, а не `INSERT` — то есть "один активный ряд на пользователя" (требование тикета) обеспечивается на уровне приложения, без необходимости менять схему БД ещё одной миграцией.

**Теория: `@Transactional()` и как он вообще узнаёт, в какой транзакции он находится.** `AuthService.register()` размечен `@Transactional()` из `typeorm-transactional` (настроено ещё в T-002). Внутри метода — до двух записей в разные таблицы (`users`, при включённом подтверждении — ещё и `email_verifications`), и они должны либо обе применяться, либо ни одна (иначе можно получить пользователя с `isEmailVerified: false`, для которого никогда не создастся код подтверждения — тупиковое состояние). Механизм внутри: декоратор оборачивает метод так, что перед вызовом он открывает транзакцию через `QueryRunner`, и **сохраняет ссылку на неё не как параметр функции**, а в `AsyncLocalStorage` — встроенном механизме Node.js для хранения контекста, который автоматически "путешествует" вместе с цепочкой `await`/асинхронных вызовов внутри одного логического потока выполнения, даже через несколько уровней вложенных `async`-функций, без необходимости явно прокидывать `QueryRunner` в каждый метод каждого сервиса. Именно поэтому `UsersService.create()`/`EmailVerificationService.issue()` ничего не знают о транзакции явно — TypeORM сам подставляет активный `QueryRunner` при выполнении любого запроса репозитория, если он запущен "внутри" вызова, помеченного `@Transactional()`.

**Теория: почему `PasswordService.hash()`/`argon2.hash()` — `async`, а не обычная синхронная функция.** Node.js исполняет JS-код в одном потоке (event loop) — пока выполняется синхронный код, вообще ничего другое не может произойти, включая обработку других HTTP-запросов к этому же серверу. Хэширование пароля через `argon2` специально требует заметного количества CPU-времени (это не баг, а фича — так задумано, чтобы подбор пароля перебором был медленным и дорогим). Если бы `argon2` был синхронным, каждый вызов `register()` замораживал бы **весь** сервер на время хэширования — ни один другой пользователь не смог бы даже получить ответ от `/health` в этот момент. Асинхронный API `argon2.hash()` выполняет тяжёлые вычисления в пуле потоков `libuv` (внутренний механизм Node для CPU-тяжёлых и I/O-операций), а основной поток остаётся свободным обрабатывать другие запросы, пока ждёт результат — отсюда `Promise<string>`, `await`, и `async` вверх по всей цепочке вызовов (`PasswordService.hash` → `AuthService.register` → будущий контроллер).

### Как проверить

```bash
npx tsc --noEmit -p tsconfig.json   # 0 ошибок
npx eslint src/core/mailer src/modules/auth/services src/modules/auth/auth.module.ts src/modules/users/users.module.ts src/modules/users/users.service.ts
# чисто
```

Полный живой прогон (`npm run start:dev` + реальный `AuthService.register()` через Postgres/Mailpit) **не выполнен в рамках этой сессии** — Docker Desktop был не запущен (`failed to connect to the docker API`). Компиляция и запуск watch-режима подтверждены (`Found 0 errors`), но фактическое разрешение DI-графа и запись в БД — нет. Это стоит перепроверить вручную при следующей сессии, до перехода к Фазе 4, тем же способом, что и в T-010: поднять `docker compose up -d`, `npm run start:dev`, и явно попытаться создать `AuthService` через временный вызов (либо сразу перейти к Фазе 4 и проверить через реальный `POST /auth/register`, раз эндпоинт всё равно будет переписываться).

### Затронутые файлы

- [`src/core/mailer/mailer.module.ts`](../src/core/mailer/mailer.module.ts), [`mailer.service.ts`](../src/core/mailer/mailer.service.ts) — новые
- [`src/modules/auth/services/auth.service.ts`](../src/modules/auth/services/auth.service.ts), [`email-verification.service.ts`](../src/modules/auth/services/email-verification.service.ts), [`password.service.ts`](../src/modules/auth/services/password.service.ts) — новые
- [`src/modules/auth/auth.module.ts`](../src/modules/auth/auth.module.ts), [`src/modules/users/users.module.ts`](../src/modules/users/users.module.ts)
- [`src/modules/users/users.service.ts`](../src/modules/users/users.service.ts) — новый
- [`src/modules/auth/entities/email-verification.entity.ts`](../src/modules/auth/entities/email-verification.entity.ts), [`email-verification-method.enum.ts`](../src/modules/auth/email-verification-method.enum.ts)
- [`src/database/migrations/1788626242510-CreateEmailVerifications.migration.ts`](../src/database/migrations/1788626242510-CreateEmailVerifications.migration.ts)
- [`scripts/migration-generate.js`](../scripts/migration-generate.js) — новый
- [`tsconfig.json`](../tsconfig.json) — добавлена секция `ts-node.require`
- [`package.json`](../package.json) — `argon2`, `nodemailer`, `@types/nodemailer`, `tsconfig-paths`; `migration:generate` указывает на `scripts/migration-generate.js`
- [`docker-compose.yml`](../docker-compose.yml) — добавлен сервис `mailpit`
- [`src/core/config/config.types.ts`](../src/core/config/config.types.ts), [`config.validation.ts`](../src/core/config/config.validation.ts), [`.env.example`](../.env.example) — ключи `AUTH_REGISTER_*`/`EMAIL_VERIFICATION_*`/`OTP_LENGTH`/`AUTH_PASSWORD_*`/`MAIL_*`

---

## T-011. Регистрация — Фаза 4: DTO и эндпоинты подтверждения

Продолжение [Фаз 1–3](#t-011-регистрация--фазы-13-конфиг-emailverification-сервисы). Здесь — DTO для всех четырёх операций регистрации и подключение `AuthController` к `AuthService` (`register`, `confirm-otp`, `confirm-link`, `resend`). Аудит-логи и e2e-проверка с живым Mailpit — ещё не эта фаза.

### Что сделано

**1. DTO — `src/modules/auth/dto/`:** `RegisterDto`, `ConfirmOtpDto`, `ResendConfirmationDto`, `ConfirmMagicLinkQueryDto` (последний — для `GET /auth/register/confirm-link`, валидируется через `@Query()`, а не `@Body()`, как и требует тикет). Общая нормализация email (`trim().toLowerCase()`) вынесена в один переиспользуемый декоратор [`NormalizeEmail()`](../src/modules/auth/dto/normalize-email.decorator.ts) — иначе одна и та же строчка `@Transform(...)` дублировалась бы в четырёх файлах.

**Открытый вопрос, решённый в пользу простоты:** `RegisterDto.password` использует статический `@MinLength(8)`, а не читает `AUTH_PASSWORD_MIN_LENGTH` из конфига динамически. class-validator декораторы выполняются без доступа к Nest DI-контейнеру по умолчанию — чтобы декоратор мог дёрнуть `ConfigService`, потребовался бы `useContainer(app.select(AppModule))` в `main.ts` плюс кастомный `ValidatorConstraint`. Ради одной настройки, которую по факту почти никто не меняет после старта проекта, решили не усложнять — граница захардкожена и явно прокомментирована в файле.

**2. `AuthController` — реальные хендлеры вместо заглушек:**
```typescript
@Throttle({ default: { limit: 3, ttl: seconds(60) } })
@Post('register')
async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) response: FastifyReply) {
  const result = await this.authService.register(dto.email, dto.password);
  response.status('requiresConfirmation' in result ? HttpStatus.OK : HttpStatus.CREATED);
  return result;
}

@Throttle({ default: { limit: 10, ttl: seconds(60) } })
@Post('register/confirm-otp')
@HttpCode(HttpStatus.OK)
async confirmOtp(@Body() dto: ConfirmOtpDto) {
  return this.authService.confirmOtp(dto.email, dto.code);
}
```

**Теория: почему у `register` — `@Res({ passthrough: true })`, а у остальных трёх — просто `@HttpCode()`.** В Nest статус ответа по умолчанию зависит от HTTP-метода: `POST` → `201 Created`, `GET`/остальные → `200 OK`. `@HttpCode(status)` — декларативный способ переопределить этот дефолт **одним фиксированным** значением на весь метод, известным заранее (`confirm-otp`/`resend` всегда отвечают `200`, независимо от исхода — при ошибке всё равно сработает `AllExceptionsFilter`, не эта ветка кода). У `register` статус **зависит от результата бизнес-логики** (`200`, если включено подтверждение, `201` — если нет) — статический декоратор этого не умеет, он не может заглянуть внутрь возвращаемого значения. Единственный способ — получить прямой доступ к объекту ответа через `@Res({ passthrough: true })` (`passthrough: true` — принципиально: без него Nest посчитал бы, что метод сам полностью управляет ответом, и не станет автоматически сериализовать `return`-значение в JSON) и выставить статус вручную через `response.status(...)`.

### Баги, найденные при ревью (до того, как они попали в прод)

**1. `resend()` вызывал `canResend()`, но никак не использовал результат.**
```typescript
// было
await this.emailVerificationService.canResend(user.id);   // Promise<boolean> просто отбрасывается
const { plaintext } = await this.emailVerificationService.issue(user.id);
```
Бизнес-лимит на повторную отправку (`EMAIL_VERIFICATION_RESEND_INTERVAL_SECONDS`, `429` по тикету) был полностью не рабочим — новый код выдавался при любом количестве повторных запросов. Поймано не компилятором и не линтером (`await` без использования результата — валидный код), а ручным построчным разбором логики. Фикс:
```typescript
const canResend = await this.emailVerificationService.canResend(user.id);
if (!canResend) {
  throw new HttpException('Please wait before requesting a new code', HttpStatus.TOO_MANY_REQUESTS);
}
```

**2. `confirmOtp`/`resend` инжектировали `@Res({ passthrough: true })`, но не вызывали `response.status(...)`.** ESLint честно подсветил оба параметра как `'response' is defined but never used` — не заметить глазами это несложно (параметр выглядит "использованным" самим фактом присутствия в сигнатуре), а последствие — оба роута отвечали `201` вместо требуемого тикетом `200`. Раз статус здесь не зависит от ветвления (в отличие от `register`), решение проще, чем можно было подумать: убрать `@Res` вообще, заменить на статический `@HttpCode(HttpStatus.OK)`.

**3. Дохлый импорт `import { verify } from 'crypto'` в `auth.service.ts`.** Остаток от черновика — нигде не вызывался, тоже поймано ESLint (`no-unused-vars`), не компилятором (неиспользуемый импорт — не ошибка типов).

**4. `confirmLink` — единственный из четырёх методов без `await` перед вызовом сервиса.** Не ломает поведение (возврат промиса из `async`-функции автоматически разворачивается вызывающей стороной), но inconsistent stylistically — поправлено для единообразия.

**5. Throttle-лимиты на трёх новых роутах были одинаковыми (`3/60с`, скопировано с `register`)**, вместо разных чисел из тикета — `confirm-otp`/`confirm-link` `10/60с`, `resend` `5/60с`.

### Тесты

**`auth.controller.spec.ts`** — добавлены `describe`-блоки на `confirmOtp`/`confirmLink`/`resend`, каждый проверяет прокидывание полей DTO в `AuthService` и возврат его результата без изменений.

**`auth.service.spec.ts`** (новый файл) — 12 тестов на всю бизнес-логику: `register()` в обеих ветках (с подтверждением/без), `409` на дубликат email, `confirmOtp`/`confirmMagicLink` (включая `404`, простановку `isEmailVerified: true`), `resend()` — включая **регресс-тест на баг №1** (`canResend` возвращает `false` → должен полететь `HttpException`, `issue`/`sendMail` не вызываются).

**Теория: почему тестирование `@Transactional()`-метода потребовало отдельного трюка.** Все методы `AuthService` размечены `@Transactional()` (`typeorm-transactional`, настроено в T-002). Разобрав библиотеку (`node_modules/typeorm-transactional/dist/transactions/wrap-in-transaction.js`), выяснилось: декоратор при **каждом** вызове сперва проверяет наличие CLS-контекста (`getTransactionalContext()`) — Node-механизма `AsyncLocalStorage`, который должен быть создан заранее вызовом `initializeTransactionalContext()`. В реальном приложении это происходит один раз в `bootstrap()` ([`main.ts`](../src/main.ts)) при старте процесса. Юнит-тест никогда не выполняет `main.ts` — импортируется только сам класс сервиса — значит, вызов любого `@Transactional()`-метода в тесте гарантированно упал бы с `Error: No CLS namespace defined in your app...`, даже если все внедрённые зависимости замоканы правильно: декоратор перехватывает выполнение до того, как управление вообще доходит до тела метода. Решение — подменить саму библиотеку в тестовом файле:
```typescript
vi.mock('typeorm-transactional', () => ({
  Transactional: () => (_target, _key, descriptor) => descriptor, // no-op
}));
```
`vi.mock(...)` поднимается Vitest выше всех `import` в файле (hoisting), поэтому к моменту, когда `auth.service.ts` реально импортируется и его класс объявляется (а декораторы применяются именно в момент объявления класса, не при каждом вызове), `Transactional` из `typeorm-transactional` уже заменён на функцию, которая просто возвращает метод как есть, без обёртки. **Это стоит запомнить как общий паттерн** для любого будущего юнит-теста сервиса с `@Transactional()` в этом проекте — без него тест такого сервиса гарантированно упадёт именно с этой ошибкой, а не с чем-то более очевидным.

### Как проверить

```bash
npx tsc --noEmit -p tsconfig.json     # 0 ошибок
npx eslint src/modules/auth src/modules/users src/core/config   # чисто
npx prettier --check src/modules/auth src/modules/users src/core/config
npx vitest run                         # 25/25 (было 13 до этой фазы)
```

Живая проверка через реальный `POST /auth/register*` с поднятым Postgres/Mailpit — по-прежнему не выполнена в этой сессии (см. пробел в конце раздела Фаз 1–3); закрыть перед переходом к Фазе 5.

### Затронутые файлы

- [`src/modules/auth/dto/`](../src/modules/auth/dto/) — новая папка: `register.dto.ts`, `confirm-otp.dto.ts`, `resend-confirmation.dto.ts`, `confirm-magic-link.query.dto.ts`, `normalize-email.decorator.ts`
- [`src/modules/auth/auth.controller.ts`](../src/modules/auth/auth.controller.ts), [`auth.controller.spec.ts`](../src/modules/auth/auth.controller.spec.ts)
- [`src/modules/auth/services/auth.service.ts`](../src/modules/auth/services/auth.service.ts), [`auth.service.spec.ts`](../src/modules/auth/services/auth.service.spec.ts) — новый
- [`src/modules/auth/services/email-verification.service.ts`](../src/modules/auth/services/email-verification.service.ts) — `canResend()` теперь бросает `NotFoundException` вместо `false` для случая "нет активной верификации"
- [`src/modules/users/users.service.ts`](../src/modules/users/users.service.ts) — добавлен `save()`
- [`src/core/config/config.types.ts`](../src/core/config/config.types.ts) — убран неиспользуемый импорт `StringLiteral` (не связано с этой фазой, попутная чистка)

---

## T-011. Регистрация — Фаза 5: аудит-логи, тесты `EmailVerificationService`, ручная acceptance-проверка

Завершающая фаза T-011. Здесь — то, что закрывает оставшиеся пункты тикета: `Logger`-события, недостающий юнит-тест-файл, и наконец полный живой прогон через реально поднятые Postgres + Mailpit (раньше в сессии Docker был выключен).

### Аудит-логи

Добавлен `Logger` в оба сервиса, единый формат `{ event, ... }` (тот же принцип, что зафиксирован в T-011 как временное решение до T-007/`nestjs-pino` — переезд на другой транспорт логов не потребует переписывать вызовы):

- `AuthService`: `auth.register.attempt` / `.success` (с `requiresConfirmation`/`method`) / `.conflict`, `auth.email_verification.sent` (флаг `sent: boolean`, без кода), `auth.email_verification.resend`.
- `EmailVerificationService`: `auth.email_verification.confirmed`, `.failed` — с полем `reason: 'invalid' | 'expired' | 'attempts_exceeded'`, по одному вызову на каждую ветку `confirm()`.

Нигде не логируется сам код/токен — только email/userId и метаданные.

### `email-verification.service.spec.ts`

Новый файл, 14 тестов на `EmailVerificationService` напрямую (без прохода через `AuthService`): `issue()` — создание новой строки vs обновление существующей (resend не плодит новые записи), OTP ровно нужной длины, hex-токен для magic-link, код нигде не хранится в открытом виде (`codeHash !== plaintext`); `confirm()` — 404 без активной верификации и на уже consumed, 429 без сравнения кода при превышении лимита попыток, 400 на просрочку, инкремент `attemptsUsed` на неверный код, простановка `consumedAt` на верный; `canResend()` — 404, `true`/`false` до и после интервала.

### Баг, который нашёлся только при ручной проверке (не при чтении кода, не в тестах)

При первой попытке реально переключить `AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION=true` в `.env` и зарегистрировать пользователя — `AuthService.register()` каждый раз вёл себя так, будто флаг выключен (`requiresConfirmation: false`), несмотря на корректное значение в `.env` и полный рестарт процесса.

**Причина** — в самом коде сравнения:
```typescript
// было
this.configService.get('AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION') === 'true'
```
Наша обёртка [`config.service.ts`](../src/core/config/config.service.ts) типизирует `.get()` как возвращающий `string` — но это только для TypeScript. По факту `@nestjs/config`'s `ConfigService.get()` (см. `node_modules/@nestjs/config/dist/config.service.js`) сначала проверяет **провалидированный Joi-объект** (`internalConfig[VALIDATED_ENV_PROPNAME]`), и только если там ничего нет — падает обратно на сырой `process.env`. А `Joi.boolean()` в схеме [config.validation.ts](../src/core/config/config.validation.ts) по умолчанию **конвертирует** строку `"true"` из `.env` в настоящий JS `boolean` уже на этапе валидации при старте приложения — именно это сконвертированное значение и возвращает `.get()`, минуя `process.env` (который, в отличие от обычных JS-объектов, всегда хранит строки — но здесь до него дело не доходит вообще). В итоге `true === 'true'` — сравнение булева со строкой, в JS оно **всегда** `false`, вне зависимости от реального значения флага.

Показательно, что этот же самый подводный камень уже был решён раньше в этом же проекте — в [database.module.ts](../src/core/database/database.module.ts) для точно таких же Joi-boolean-ключей используется `String(config.get(...)) === 'true'`, а не голое сравнение. Эта защита не была перенесена в код `AuthService`/`MailerService` при написании Фазы 3 — отсюда и баг, всплывший только когда кто-то реально попробовал переключить флаг в рантайме (юнит-тесты его не ловили, потому что моки `ConfigService` в тестах и так возвращали строки `'true'`/`'false'` напрямую, а не через реальную Joi-валидацию).

**Фикс** — привести к единому стилю с `database.module.ts`:
```typescript
String(this.configService.get('AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION')) === 'true'
```
Тот же фикс применён к `MAIL_SECURE` в `mailer.service.ts`. Проверены остальные boolean-ключи проекта — `HEALTH_CHECK_ENABLED` используется через `if (!x)` (truthy-проверка, а не сравнение со строкой), там бага физически быть не может; `AUTH_PASSWORD_REQUIRE_COMPLEXITY` пока нигде не читается в коде.

**Вывод на будущее**: любой Joi.boolean()-ключ конфига, если он будет сравниваться со строкой `'true'`/`'false'` где-либо ещё в проекте, нужно оборачивать в `String(...)` — тип `string` у `ConfigService.get()` в этом проекте формально верен не для всех ключей, только для тех, чья Joi-схема — `Joi.string()`.

### Ручная acceptance-проверка (наконец выполнена целиком)

Docker (`mnt-postgres`, `mnt-mailpit`) поднят, сервер запущен, проверено вручную через `Invoke-RestMethod` (PowerShell) — все пять сценариев из тикета:

1. `AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION=false` → `POST /auth/register` → `201`, пользователь в БД с `isEmailVerified=true`. ✅
2. Повторная регистрация того же email → `409`. ✅
3. `AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION=true`, метод `otp` → `200 { requiresConfirmation: true }`, письмо с кодом видно в Mailpit, `POST /auth/register/confirm-otp` с верным кодом → `200 { verified: true }`. ✅
4. Метод `magic_link` → письмо с токеном, `GET /auth/register/confirm-link?email=&token=` → `200 { verified: true }`. ✅
5. Повторный `resend` раньше `EMAIL_VERIFICATION_RESEND_INTERVAL_SECONDS` → `429`. ✅

**Бонус, не описанный явно в acceptance-критериях, но найденный по пути**: `resend` для уже подтверждённого email корректно возвращает `404 "No pending confirmation for this email"` — тот самый путь в `EmailVerificationService.canResend()`, где строка есть, но `consumedAt` уже заполнен. Подтверждает, что дизайн-решение "искать активную (не consumed) верификацию" работает не только в тестах, но и на реальных данных.

Отдельно поймали и решили практическую проблему тестирования curl/PowerShell на Windows — `curl.exe`, вызванный из PowerShell 5.1, ломает кавычки внутри JSON-тела при передаче аргументов нативному процессу. Рабочий вариант — нативный командлет `Invoke-RestMethod` с телом как обычной PowerShell-строкой (не проходит через пересборку argv для внешнего процесса, поэтому кавычки не бьются); для сценариев с ошибочными статусами — обёртка `try { } catch { $_.Exception.Response.StatusCode.value__ }`, так как `Invoke-RestMethod` в PS 5.1 бросает исключение на любой не-2xx статус, а не возвращает тело как есть.

### Затронутые файлы

- [`src/modules/auth/services/auth.service.ts`](../src/modules/auth/services/auth.service.ts) — `Logger`, `String(...)`-фикс
- [`src/modules/auth/services/email-verification.service.ts`](../src/modules/auth/services/email-verification.service.ts) — `Logger`
- [`src/core/mailer/mailer.service.ts`](../src/core/mailer/mailer.service.ts) — `String(...)`-фикс
- [`src/modules/auth/services/email-verification.service.spec.ts`](../src/modules/auth/services/email-verification.service.spec.ts) — новый

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

## T-012 (в процессе). JWT-инфраструктура: guard, strategy, `@Public()`

Первая часть T-012 (полный контракт — [docs/tickets/T-012-login.md](tickets/T-012-login.md)) — сама логика `AuthService.login()` ещё не написана, но инфраструктура, на которой она будет стоять, уже есть и уже включена глобально. Раздел объясняет, как она устроена и почему именно так — это тот код, который дальше будет незаметно работать «под капотом» у каждого защищённого роута, и без объяснения не очевидно, что где на самом деле происходит.

### Проблема

Нужно было решить не «как проверить один токен», а как встроить проверку JWT в конвейер запроса так, чтобы:
1. По умолчанию **все** роуты были защищены — а не только те, где кто-то не забыл навесить guard руками.
2. При этом заведомо публичные роуты (`register`, `login`, `health`, диагностика) не сломались.
3. Отозвать токен раньше срока его истечения было возможно хоть каким-то способом — обычный JWT сам по себе отозвать нельзя, он валиден до истечения `exp`, что бы ни случилось с пользователем на сервере.

### Как это устроено: путь одного запроса

1. Запрос приходит с заголовком `Authorization: Bearer <token>` (или без него).
2. [`JwtAuthGuard`](../src/core/auth/jwt-auth.guard.ts) зарегистрирован в [`AppModule`](../src/core/app/app.module.ts) через `APP_GUARD` — то есть выполняется **на каждом роуте приложения**, без исключений, если явно не сказано иначе.
3. `canActivate()` сначала проверяет метадату `@Public()` через `Reflector.getAllAndOverride(...)` — читает её и с метода-хендлера, и с класса контроллера. Если метка есть — сразу `return true`, дальше вообще ничего не проверяется.
4. Если метки нет — вызывается `super.canActivate(context)`, то есть встроенный механизм `AuthGuard('jwt')` из `@nestjs/passport`. Он запускает Passport-стратегию с именем `'jwt'` — это и есть [`JwtStrategy`](../src/core/auth/jwt.strategy.ts).
5. Внутри `JwtStrategy` вся криптографическая часть настроена не в `validate()`, а в вызове `super({...})` в конструкторе — именно туда передаются `jwtFromRequest` (как достать сырой токен: `ExtractJwt.fromAuthHeaderAsBearerToken()`, т.е. из заголовка) и `secretOrKey` (`JWT_SECRET`, чем проверять подпись). Passport сам достаёт токен, проверяет подпись и срок действия (`ignoreExpiration: false`) — и только если это всё прошло, вызывает наш `validate(payload)` с уже расшифрованным и проверенным содержимым. Если подпись неверна или токен просрочен, `validate()` вообще не вызывается — Passport сам отдаёт `401` раньше.
6. `validate(payload)` делает то, что чистая проверка подписи не может: проверяет `payload.type === 'access'` (чтобы refresh-токен нельзя было подсунуть как access — у него `type: 'refresh'`), находит пользователя по `payload.sub` и сверяет `payload.tokenVersion` с текущим значением в БД.
7. Это сравнение `tokenVersion` — единственный способ отозвать токен раньше истечения `JWT_ACCESS_TTL`: подпись у него остаётся математически верной до конца жизни, отозвать её нельзя, но можно сделать так, что сервер перестанет её принимать, увеличив `user.tokenVersion` (логаут, смена пароля — сам инкремент пока нигде не вызывается, задел на будущее). Токен, подписанный со старым значением, перестаёт совпадать — `401 "Token has been revoked"`, хотя криптографически он ещё валиден.
8. То, что вернул `validate()`, становится `request.user` (тип `RequestUser` из [`auth.types.ts`](../src/core/auth/auth.types.ts)) — доступно дальше в контроллерах и в будущих guard'ах (например, `PermissionsGuard` из T-013 будет читать оттуда роль).

### Зачем нужен `@Public()`

Раз guard глобальный и по умолчанию запрещает всё, часть роутов обязана остаться доступной без токена — сама регистрация/логин, health-check, диагностика. [`Public()`](../src/core/auth/public.decorator.ts) — это `SetMetadata(IS_PUBLIC_KEY, true)`, декоратор-метка без собственной логики, которую потом читает `JwtAuthGuard` через `Reflector`. Механизм один в один повторяет уже существующий в проекте `@SkipThrottle()` из T-005 (тоже метадата + `Reflector`-проверка в guard'е) — не новый паттерн, а переиспользование того же приёма.

Помечены классом целиком (не по одному методу): `AuthController` (весь модуль логина/регистрации), `HealthController` (рядом с уже стоящим `@SkipThrottle()`), `TestErrorsController` (диагностика). Swagger отдельно помечать не нужно — его роуты регистрируются `SwaggerModule.setup()` напрямую через Fastify-плагин в `main.ts`, а не через Nest-контроллеры, поэтому Nest-guard'ы их вообще не видят.

### Почему именно так, а не `@UseGuards()` на каждом контроллере

Глобальный guard + `@Public()`-исключения выбраны сознательно, а не просто «так получилось»: дальше по плану (T-013 — admin-роуты RBAC, T-015–018 — `/users/*`) защищённых роутов становится много, а забыть навесить guard на новый контроллер — это дыра в безопасности, которая может неделями оставаться незамеченной. Забыть навесить `@Public()` на новый действительно публичный роут — это тоже баг, но он сразу бросается в глаза на первом же ручном тесте (роут ошибочно вернёт `401` вместо своего обычного ответа). Асимметрия рисков в пользу «запрещено по умолчанию» и определила выбор.

### Затронутые файлы

- [`src/core/auth/jwt.strategy.ts`](../src/core/auth/jwt.strategy.ts), [`jwt-auth.guard.ts`](../src/core/auth/jwt-auth.guard.ts), [`public.decorator.ts`](../src/core/auth/public.decorator.ts), [`auth.types.ts`](../src/core/auth/auth.types.ts) — новые
- [`src/core/auth/auth-core.module.ts`](../src/core/auth/auth-core.module.ts) — новый, регистрирует `JwtModule.registerAsync`/`PassportModule`/`JwtStrategy`/`TokenService`
- [`src/core/app/app.module.ts`](../src/core/app/app.module.ts) — второй `APP_GUARD` (`JwtAuthGuard`, после уже существующего `ThrottlerGuard`)
- [`src/modules/auth/auth.controller.ts`](../src/modules/auth/auth.controller.ts), [`src/core/health/health.controller.ts`](../src/core/health/health.controller.ts), [`src/core/error-handling/test-errors.controller.ts`](../src/core/error-handling/test-errors.controller.ts) — размечены `@Public()`

---

## Как пользоваться этим документом дальше

При закрытии следующего тикета — по тому же принципу:
1. Раздел `## T-0XX. <Название>` с проблемой, решением (с ключевыми фрагментами кода) и объяснением **почему** выбран именно такой подход, а не альтернативы.
2. Если что-то всплыло только при ручной проверке (как баг с диском на Windows) — отдельным подразделом, это самая ценная часть для будущего «я».
3. Раздел «Как проверить руками» с конкретными командами.
4. Список затронутых файлов.

Общий план по тикетам и текущий статус — в [`PLAN.md`](./PLAN.md); этот документ — приложение к нему с деталями реализации.
