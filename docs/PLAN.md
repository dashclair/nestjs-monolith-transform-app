# План реализации: сервис трансформации файлов (NestJS)

Документ — последовательный список тикетов для реализации проекта. Тикеты внутри эпика можно делать в указанном порядке, между эпиками порядок обязателен (эпик 0 → эпик 1 → эпик 2), т.к. каждый следующий блок опирается на инфраструктуру предыдущего.

> Проект стартовал как чистый `nest new` (`nestjs-monolith`), но после аудита существующего boilerplate (`core/config`, `core/database`, `core/health`, `core/throttler`, миграции, `docker-compose.yml`) было решено продолжать здесь — инфраструктура во многом уже была готова, реализовывать её заново с нуля смысла не было.

Стек: NestJS + Fastify, TypeORM + PostgreSQL, class-validator/class-transformer, Joi (конфиг через `ConfigService`), `@nestjs/throttler`, `@nestjs/terminus`, `typeorm-transactional`. Тесты — Vitest (переведено с исходного Jest в boilerplate). Линт/форматирование — ESLint + Prettier (оставлено как было в boilerplate, не менялось на oxlint).

---

## Эпик 0. Инфраструктура (сделать до пользователей — на скрине не указан явно, но без него нельзя реализовать НФТ)

- [x] **T-001. Конфигурация окружения** — `ConfigModule` + Joi-схема (`config.validation.ts`), типизированный `ConfigService` (`config.types.ts` + `config.service.ts`), `.env`/`.env.example`. Все переменные — плоским списком с префиксами (`POSTGRES_*`, `JWT_*`, `STORAGE_*`), а не через `registerAs`-namespace (решили не плодить лишние файлы под масштаб проекта). Проверено: приложение падает при невалидном `.env` с понятной ошибкой и успешно стартует при валидном.
- [x] **T-002. Подключение БД** — уже было в boilerplate: `TypeOrmModule.forRootAsync` в `DatabaseModule`, `docker-compose.yml` с Postgres, `typeorm-transactional` (`initializeTransactionalContext` в `main.ts` + `addTransactionalDataSource`), CLI-скрипты миграций (`migration:generate/run/revert`) через `src/database/data-source.ts`. Проверено: приложение доходит до попытки подключения к БД (падает только из-за того, что Postgres локально не поднят — это ожидаемо, `docker-compose up` ещё не запускали).
- [x] **T-003. Глобальная валидация и обработка ошибок** — `ValidationPipe` в `main.ts` дополнен `forbidNonWhitelisted`/`transform`/`transformOptions.enableImplicitConversion`. Добавлены `AllExceptionsFilter` и `ClassSerializerInterceptor`, оба зарегистрированы через DI (`APP_FILTER`/`APP_INTERCEPTOR` в `AppModule`), а не императивно в `main.ts`, — чтобы применялись и в `TestingModule`-based тестах. Проверено: временный `TestErrorsController` (`GET /test-errors/unknown`, `GET /test-errors/type-error`) подтверждает, что необработанные исключения возвращаются в едином формате `{statusCode, message, path, timestamp}` с `500` и без утечки исходного текста ошибки/stack trace.
- [x] **T-004. Health checks** — `checkHealth()` теперь реально проверяет БД (`TypeOrmHealthIndicator.pingCheck`), память (`MemoryHealthIndicator` — heap/RSS) и диск (`DiskHealthIndicator.checkStorage`, путь/порог из `HEALTH_DISK_PATH`/`HEALTH_DISK_THRESHOLD`, платформенный фолбэк `C:\`/`/` — на Windows `check-disk-space` не принимает POSIX-путь `/`, это выяснилось только при ручном прогоне). `health.service.spec.ts`/`health.controller.spec.ts` починены (корректный `TestingModule` с замоканными провайдерами). Проверено: `vitest run` — зелёный, и вручную через поднятый локально сервис (Postgres в Docker) — `GET /health` при `HEALTH_CHECK_ENABLED=true` отдаёт `200` с `database`/`memory_heap`/`memory_rss`/`storage: up`, при `=false` (дефолт) — пустой `{status:'ok', details:{}}`.
- [x] **T-005. Rate limiting** — `ThrottlerGuard` зарегистрирован глобально через `APP_GUARD` в `AppModule`, теперь лимиты из `ThrottlerModule` (`THROTTLE_GLOBAL_TTL`/`THROTTLE_GLOBAL_LIMIT`) реально применяются ко всем роутам. `HealthController` исключён через `@SkipThrottle()` (иначе liveness/readiness-проба от оркестратора рано или поздно словит `429`). Для `/auth/login`/`/auth/register` заведены строгие лимиты через `@Throttle({ default: { limit, ttl } })` (5/60с и 3/60с соответственно) — сами хендлеры пока placeholder-заглушки (`AuthController`/`AuthModule` были пустыми, реальная auth-логика — предмет T-011/T-012, вне очереди эпиков её делать не стали). Подробности — `src/core/throttler/README.MD`. Проверено: `vitest run` — зелёный; вручную через живой сервер — `GET /test-errors/unknown` (без аннотаций) отдаёт `429` после 10 запросов/10с, `POST /auth/login` — после 5/60с, `POST /auth/register` — после 3/60с, `GET /health` не блокируется вообще.
- [x] **T-006. CORS** — уже реализовано в `main.ts`: whitelist через `enableCors({ origin: [...] })`, а не `origin: true`. Список доменов — пока плейсхолдеры localhost, поправить под реальный фронтенд, когда он появится.
- [ ] **T-007. Логирование** — структурированный логгер (см. рекомендации ниже), middleware/interceptor для correlation id, логирование входа, ошибок, изменений данных.
- [x] **T-008. OpenAPI/Swagger** — `SwaggerModule` поднят в `main.ts`, заголовок/версия/путь документации берутся из конфига (`APP_NAME`/`API_VERSION`/`SWAGGER_PATH`, дефолты из T-001). `DocumentBuilder` с `.addBearerAuth()` (защищённых роутов ещё нет — появится в T-012, но схема авторизации в Swagger UI уже готова) и тегами под все модули из плана (`Auth`/`Users`/`Transformations`/`Health`/`Diagnostics`), существующие контроллеры размечены `@ApiTags(...)`. Подробности и найденный по пути баг с конфигом — `docs/IMPLEMENTATION-LOG.md`. Проверено: `tsc --noEmit` — чисто, `vitest run` — 12/12, вручную через живой сервер — `GET /api/docs` и `/api/docs-json` отдают `200` с корректными `info`/`tags`/`securitySchemes`. Известный пробел: `API_PREFIX` заведён в конфиге, но `app.setGlobalPrefix` не вызывается — не входило в скоуп тикета.
- [x]/[ ] **T-009. Тестовая инфраструктура** — Vitest настроен (`vitest.config.ts`/`vitest.config.e2e.ts`, `@vitest/coverage-v8`), Jest полностью убран. Health-тесты починены в рамках T-004, добавлен `auth.controller.spec.ts` в рамках T-005 — все юнит-тесты зелёные (`vitest run`). Но: порог ≥80% и CI-гейт — ещё не настроены; `test/app.e2e-spec.ts` унаследован от `nest new` и битый (Express-эндпоинт `/` с `Hello World!`, которого нет в приложении на Fastify) — почистить отдельно.

## Эпик 1. Работа с пользователями

- [ ] **T-010. User entity + миграция** — `email` (unique), `passwordHash`, `role`, `isEmailVerified`, `createdAt`/`updatedAt`, индекс на `email`. Детальный контракт — [docs/tickets/T-010-011-registration.md](tickets/T-010-011-registration.md).
- [ ] **T-011. Регистрация** — `POST /auth/register` (DTO с class-validator, хэширование пароля через `argon2`, проверка уникальности email — `409`), опциональное подтверждение email (OTP/magic link) по флагу `AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION` — новые сущность `EmailVerification`, `MailerModule` (nodemailer + Mailpit в docker-compose для дев-окружения), эндпоинты `confirm-otp`/`confirm-link`/`resend`, аудит-логи через `Logger`, тесты. Токены/сессия при регистрации не выдаются (JWT — T-012). Полный контракт, таблица ошибок и зафиксированные архитектурные решения — [docs/tickets/T-010-011-registration.md](tickets/T-010-011-registration.md).
- [ ] **T-012. Аутентификация** — `POST /auth/login`, JWT access + refresh токены, `passport-jwt` стратегия, guard.
- [ ] **T-013. RBAC** — enum ролей, `@Roles()` декоратор, `RolesGuard`.
- [ ] **T-014. Авторизация** — применение guard'ов на маршруты; правило «свои данные или admin» как переиспользуемая проверка (guard/policy), а не дублирование в каждом контроллере.
- [ ] **T-015. Просмотр данных пользователя** — `GET /users/:id`, доступ self/admin, DTO ответа без `passwordHash`.
- [ ] **T-016. Изменение данных пользователя** — `PATCH /users/:id`, валидация, доступ self/admin.
- [ ] **T-017. Удаление пользователя** — `DELETE /users/:id`, admin only, обсудить soft-delete vs hard-delete.
- [ ] **T-018. Список пользователей** — `GET /users`, admin only, пагинация, `select` только нужных полей (НФТ про оптимизацию запросов).
- [ ] **Чекпоинт: ревью ментором по разделу «Пользователи»**

## Эпик 2. Трансформация файлов

- [ ] **T-019. Общие требования к трансформации** — модуль `FileTransformation`, единый интерфейс/стратегия `Transformer` (чтобы текстовые и image-трансформации подключались как реализации одного контракта), приём файла через `@fastify/multipart`, лимиты размера и допустимые mime-типы, транзакция при записи метаданных + результата.
  - ⚠️ Нужно уточнить до старта: какие именно текстовые форматы (CSV/JSON/XML/что-то ещё) и какие операции над изображениями (resize/convert/compress) должны поддерживаться — от этого зависят конкретные библиотеки в T-020/T-021.
- [ ] **T-020. Трансформация текстовых форматов** — конкретные трансформеры под выбранные форматы + unit-тесты на граничные случаи (битые файлы, пустой файл, превышение размера).
- [ ] **T-021. Трансформация изображений** — через `sharp`, конфигурация допустимых операций, тесты.
- [ ] **T-022. История трансформаций пользователя** — entity `TransformationHistory` (userId, тип операции, статус, ссылка на результат), `GET /transformations` с пагинацией, индекс по `userId`.
- [ ] **T-023. Сохранение результатов в хранилище** — `StorageService` как абстракция (реализация: локальная ФС для разработки; S3-совместимое хранилище для прода), запись метаданных о файле в БД в одной транзакции с записью в хранилище.
- [ ] **Чекпоинт: ревью ментором по разделу «Трансформация файлов»**

## Финал

- [ ] **T-024. Прогон полного набора тестов**, добор покрытия до ≥80% (unit + integration).
- [ ] **T-025. Актуализация Swagger и README** — примеры запросов, описание архитектуры.
- [ ] **Чекпоинт: полное ревью проекта ментором**

---

## Нефункциональные требования → чем закрываются

| Требование | Чем закрывается |
|---|---|
| Оптимизация БД (индексы, select нужных полей), транзакции | T-002 (частично готово), T-010, T-018, T-022, T-023; индексы — в миграциях по мере создания сущностей |
| Health checks `/health` | T-004 (эндпоинт есть, реальных проверок ещё нет) |
| Rate limiting | T-005 (сконфигурировано, но guard не подключён) |
| Валидация входных данных | T-003 (`ValidationPipe` есть, нужно доусилить), DTO в каждом тикете |
| CORS — доверенные домены | T-006 (готово) |
| Логирование критических событий | T-007 |
| Покрытие тестами ≥80% | T-009, T-024 |
| OpenAPI (Swagger) | T-008, T-025 |

---

## Рекомендации по инструментам

Уже выбрано и подключено в `package.json`:
- **Валидация DTO** — `class-validator` + `class-transformer`.
- **Валидация env** — `joi` (через `ConfigService`, плоский `Config` без namespace-разбивки).
- **Rate limiting** — `@nestjs/throttler` (guard ещё не включён — T-005).
- **Health checks** — `@nestjs/terminus` (индикаторы ещё не настроены — T-004).
- **БД/ORM** — `typeorm` + `pg`, транзакции через `typeorm-transactional`.
- **Тесты** — `vitest` + `@vitest/coverage-v8` + `vite-tsconfig-paths` (для резолва алиаса `@/*`).

Стоит добавить:
- **Документация API** — `@nestjs/swagger`. Стандартный выбор для Nest, генерирует спеку из тех же DTO, что уже валидируются class-validator.
- **Аутентификация** — `@nestjs/passport` + `passport-jwt` + `@nestjs/jwt`. Хэширование пароля — `argon2` (современный дефолт, устойчивее к GPU-брутфорсу, чем bcrypt); `bcrypt` — приемлемая альтернатива, если хочется более привычную/распространённую библиотеку.
- **RBAC/авторизация** — для ролей уровня «admin/user» достаточно своего `@Roles()` декоратора + `RolesGuard`, без сторонних библиотек. Если позже понадобятся более сложные правила (например, «можно менять только свои файлы, но не чужие даже с ролью user»), можно рассмотреть `@casl/ability` — но для объёма этого проекта это, скорее всего, избыточно на старте.
- **Логирование** — `nestjs-pino` (обёртка над `pino`). Логичный выбор именно потому, что вы на `@nestjs/platform-fastify` — Fastify использует Pino под капотом, так что это самый "родной" вариант, дающий структурированные JSON-логи и request id из коробки.
- **Загрузка файлов** — `@fastify/multipart` (а не `multer`, который заточен под Express) — streaming-загрузка, не буферизует весь файл в память, что важно для картинок/больших файлов.
- **Трансформация изображений** — `sharp`. Де-факто стандарт в Node-экосистеме, быстрый (нативные биндинги), поддерживает resize/convert/compress/format.
- **Трансформация текстовых форматов** — зависит от списка форматов (см. пометку в T-019). Ориентиры: `csv-parse`/`papaparse` для CSV, `fast-xml-parser` для XML. Уточните набор форматов, прежде чем фиксировать зависимости.
- **Хранилище результатов** — на время разработки можно обойтись локальной ФС; если нужен вариант, близкий к прод-окружению, — `@aws-sdk/client-s3` поверх MinIO (S3-совместимое хранилище, поднимается локально в Docker).
- **e2e тесты БД** — либо тестовый контейнер Postgres в `docker-compose`, либо `testcontainers` для изоляции каждого прогона.
