# T-010 / T-011 — Пользователь + регистрация (с опциональным подтверждением email)

Детализация тикетов эпика 1 из [PLAN.md](../PLAN.md) на основе функциональных требований к разделу «1) Регистрация». Ссылка из PLAN.md — краткая версия, здесь — полный контракт для реализации.

Текущее состояние кода (проверено перед написанием тикета):
- `User`-сущности нет нигде в проекте, `src/modules/users/users.module.ts` — пустой модуль.
- `src/modules/auth/auth.controller.ts` — заглушки `POST /auth/login` и `POST /auth/register`, оба уже размечены `@Throttle` (T-005: login 5/60с, register 3/60с) — **не трогать лимиты**, они уже сделаны.
- `AuthService` не существует.
- В `Config`/`config.validation.ts` уже есть `JWT_*` (не используется до T-012), но нет `MAIL_*`/`OTP_*`/`AUTH_REGISTER_*`.
- Почтовой инфраструктуры (mailer) в проекте нет вообще.
- Установлены: `class-validator`, `class-transformer`, `typeorm`, `typeorm-transactional`. НЕ установлены: `argon2`/`bcrypt`, `nodemailer`, `passport-jwt`/`@nestjs/jwt`/`@nestjs/passport` (последние три — за пределами этого тикета, они для T-012).

---

## T-010. User entity + миграция

**Файлы:** `src/modules/users/entities/user.entity.ts`, `src/modules/users/user-role.enum.ts`, миграция в `src/database/migrations/`.

Поля:

| Поле | Тип | Примечание |
|---|---|---|
| `id` | `uuid`, PK | `@PrimaryGeneratedColumn('uuid')` |
| `email` | `varchar`, unique | хранить в lowercase (нормализация на уровне DTO, см. ниже) — обычного btree-индекса `unique: true` достаточно, `citext`/expression-индекс избыточны, раз нормализация гарантирована на входе |
| `passwordHash` | `varchar` | никогда не отдавать в ответах API (см. `ClassSerializerInterceptor` + `@Exclude()`, он уже подключён в T-003) |
| `role` | `enum` (`UserRole.USER \| UserRole.ADMIN`), default `USER` | переиспользуется в T-013 (RBAC) |
| `isEmailVerified` | `boolean`, default `false` | `true` сразу при создании, если подтверждение для регистрации выключено (см. T-011) |
| `createdAt`/`updatedAt` | `timestamptz` | `@CreateDateColumn()`/`@UpdateDateColumn()` |

Регистрация модуля: `autoLoadEntities: true` уже включён в `DatabaseModule`, достаточно `TypeOrmModule.forFeature([User])` в `UsersModule`.

**Миграция:** сгенерировать через `npm run migration:generate -- src/database/migrations/CreateUsers` (или `migration:create` + ручное описание) и **переименовать результат под паттерн `*.migration.ts`** — датасорс глобит именно так (`src/database/data-source.ts`), стандартный вывод TypeORM CLI под этот паттерн не попадает. Индекс на `email` создаётся автоматически как часть `unique: true`, отдельно дублировать не нужно.

**Проверено (acceptance):**
- `npm run migration:run` применяется чисто на поднятом через `docker-compose` Postgres.
- Повторная вставка пользователя с тем же `email` (в любом регистре после нормализации) падает на уровне БД unique constraint.
- `npm run migration:revert` откатывает миграцию без ошибок.

---

## T-011. Регистрация (с опциональным подтверждением email)

### Архитектурные решения (зафиксировать в PR/коммите)

1. **«Pending registration» vs «неактивный пользователь»** (спека прямо просит выбрать один подход) — **выбран второй**: пользователь создаётся сразу в таблице `users` с `isEmailVerified = false`, когда подтверждение включено. Причина: не плодить отдельную таблицу и не дублировать проверку уникальности email между двумя местами. Логин с `isEmailVerified = false` должен быть заблокирован — это ложится на T-012 как явная зависимость (учесть при его реализации).
2. **Раскрытие существования email** — регистрация возвращает явную ошибку `409 Conflict "Email already registered"` (не нейтральный ответ). Нейтральный вариант из НФТ помечен как опциональный «по требованиям безопасности» — в рамках MVP не делаем, чтобы не усложнять UX (пользователь должен понимать, что делать — логиниться или восстанавливать пароль). Если продукт потребует иначе — отдельная правка, не блокирует эту задачу.
3. **OTP vs magic link** — поддерживаются оба способа как реализация одного контракта (`EmailVerificationService`), метод выбирается конфигом `AUTH_REGISTER_CONFIRMATION_METHOD`. Не делаем одновременную выдачу обоих на одну регистрацию — усложнение, которого требования не просят.
4. **Magic-link токен — не JWT.** T-012 (JWT-инфраструктура) ещё не реализован, и toкен подтверждения одноразовый/serverside-инвалидируемый, что JWT не даёт бесплатно. Токен — `crypto.randomBytes(32).toString('hex')`, хранится в БД только как `sha256`-хэш (как и OTP-код).
5. **Флаг «включить/выключить подтверждение» для login/восстановления пароля** (упомянут в требованиях как общий переключатель на 3 сценария) — **вне скоупа этого тикета**: этих сценариев ещё нет в кодовой базе (T-012 и восстановление пароля не запланированы отдельным тикетом в PLAN.md). Добавляем сейчас только `AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION`. Аналогичные флаги для login/reset — заводить вместе с соответствующими тикетами, не заранее.
6. **Аудит-логи** — T-007 (структурированное логирование) ещё не сделан. Используем встроенный `Logger` Nest с единообразной структурой полей (`event`, `email`, ...), чтобы переезд на `nestjs-pino` в T-007 был заменой транспорта, а не переписыванием вызовов.

### Новые сущности

**`EmailVerification`** — `src/modules/auth/entities/email-verification.entity.ts`, таблица `email_verifications`, своя миграция.

| Поле | Тип | Примечание |
|---|---|---|
| `id` | `uuid`, PK | |
| `userId` | `uuid`, FK → `users.id`, `onDelete: 'CASCADE'` | индекс на `userId` |
| `method` | `enum` (`otp \| magic_link`) | |
| `codeHash` | `varchar` | sha256 от OTP-кода или magic-link токена, plaintext никогда не хранится |
| `expiresAt` | `timestamptz` | |
| `attemptsUsed` | `int`, default `0` | |
| `consumedAt` | `timestamptz`, nullable | |
| `lastSentAt` | `timestamptz`, nullable | для лимита повторной отправки (60с) |
| `createdAt` | `timestamptz` | |

Один активный (не consumed, не expired) ряд на пользователя: при resend — обновляем существующий ряд (новый код/токен, `lastSentAt = now`), а не плодим новые.

### Конфиг (новые ключи, тот же плоский стиль с префиксами, что и остальной `Config`)

```ts
/**
 * Registration email confirmation
 */
AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION?: boolean; // default false
AUTH_REGISTER_CONFIRMATION_METHOD?: 'otp' | 'magic_link'; // default 'otp', только если confirmation включено

/**
 * Email verification (OTP / magic link) parameters
 */
EMAIL_VERIFICATION_TTL_MINUTES?: number; // default 10
EMAIL_VERIFICATION_MAX_ATTEMPTS?: number; // default 5
EMAIL_VERIFICATION_RESEND_INTERVAL_SECONDS?: number; // default 60
OTP_LENGTH?: number; // default 6

/**
 * Password policy
 */
AUTH_PASSWORD_MIN_LENGTH?: number; // default 8
AUTH_PASSWORD_REQUIRE_COMPLEXITY?: boolean; // default false — вкл./выкл. проверку буквы+цифра+спецсимвол

/**
 * Mailer (SMTP)
 */
MAIL_HOST?: string;
MAIL_PORT?: number;
MAIL_USER?: string;
MAIL_PASSWORD?: string;
MAIL_SECURE?: boolean;
MAIL_FROM?: string;
```

Добавить соответствующие Joi-правила в `config.validation.ts` (значения по умолчанию через `.default(...)`, как уже сделано для `JWT_ACCESS_TTL`/`JWT_REFRESH_TTL`) и записи в `.env.example`.

**Локальная почта для разработки:** добавить сервис `mailpit` в `docker-compose.yml` (лёгкий SMTP-сервер с веб-UI для просмотра писем, аналог MailHog) — по аналогии с тем, как в докере уже поднят Postgres для дев-окружения. `MAIL_HOST=mailpit`, `MAIL_PORT=1025` в `.env.example`.

### Модули/сервисы

- `MailerModule`/`MailerService` (`src/core/mailer/` — по аналогии с `core/config`, `core/database`) — тонкая обёртка над `nodemailer`, метод `sendMail({ to, subject, html/text })`. Ошибка отправки не должна ронять запрос регистрации 500-кой без объяснения — обрабатывается и логируется, пользователю — понятная ошибка (см. таблицу ошибок).
- `EmailVerificationService` (`src/modules/auth/`) — генерация OTP/токена, хэширование, проверка (код/токен, TTL, лимит попыток), consume, resend-логика с проверкой `lastSentAt`.
- `AuthService` (создать, сейчас отсутствует) — `register()`, вызывает `UsersService`/репозиторий + `EmailVerificationService` + `MailerService`.
- `PasswordService` или просто утильная функция на `argon2` — хэширование/проверка пароля (`argon2.hash`/`argon2.verify`). Добавить зависимость `argon2` в `package.json` (выбор из PLAN.md — устойчивее к GPU-брутфорсу, чем bcrypt).

### DTO и валидация

`RegisterDto`:
```ts
class RegisterDto {
  @IsEmail()
  @Transform(({ value }) => value?.trim().toLowerCase())
  email: string;

  @IsString()
  @MinLength(...) // из AUTH_PASSWORD_MIN_LENGTH — либо кастомный class-validator декоратор, читающий ConfigService, либо фиксированная граница с TODO на конфигурируемость, если декоратор без DI неудобен в этой версии class-validator
  @Matches(...) // опционально, только если AUTH_PASSWORD_REQUIRE_COMPLEXITY — буква+цифра+спецсимвол
  password: string;
}
```
`ConfirmOtpDto { email, code }`, `ResendConfirmationDto { email }`. Magic-link confirm — через query-параметры, не body (см. эндпоинты).

### Эндпоинты

| Метод/путь | Throttle | Тело/query | Ответ |
|---|---|---|---|
| `POST /auth/register` | уже есть (T-005, 3/60с) — не менять | `RegisterDto` | подтверждение выкл: `201 { id, email, createdAt }`. подтверждение вкл: `200 { requiresConfirmation: true, method, email }` |
| `POST /auth/register/confirm-otp` | новый, напр. `10/60с` | `{ email, code }` | `200 { verified: true }` |
| `GET /auth/register/confirm-link` | новый, напр. `10/60с` | `?email=&token=` | `200 { verified: true }` |
| `POST /auth/register/resend` | новый, напр. `5/60с` (плюс бизнес-лимит 60с/email через `lastSentAt`) | `{ email }` | `200 { sent: true }` |

Токены/сессия при успешной регистрации **не выдаются** — JWT-инфраструктуры ещё нет (T-012), логин выполняется отдельным запросом `POST /auth/login` после (T-012).

### Таблица ошибок

| Ситуация | Код | Тело |
|---|---|---|
| Невалидный email/пароль (DTO) | `400` | стандартный ответ `ValidationPipe` |
| Email уже зарегистрирован | `409` | `"Email already registered"` |
| OTP/токен неверный | `400` | `"Invalid confirmation code"` |
| OTP/токен просрочен | `400` | `"Confirmation code expired"` |
| Превышен лимит попыток (`attemptsUsed >= EMAIL_VERIFICATION_MAX_ATTEMPTS`) | `429` | `"Too many attempts, request a new code"` — дальнейшие попытки для этого ряда отклоняются без сравнения кода |
| Resend раньше `EMAIL_VERIFICATION_RESEND_INTERVAL_SECONDS` | `429` | `"Please wait before requesting a new code"` |
| Resend/confirm для email без активной верификации | `404` | `"No pending confirmation for this email"` |
| Rate limit на сам `/register` (уже есть) | `429` | из `ThrottlerGuard`, без изменений |

### Аудит-логи (через `Logger`, единый формат событий)

- `auth.register.attempt` / `auth.register.success` / `auth.register.conflict`
- `auth.email_verification.sent` (без кода/токена в логе)
- `auth.email_verification.confirmed` / `.failed` (с причиной: invalid/expired/attempts_exceeded)
- `auth.email_verification.resend`

### Тесты (Vitest, паттерн `Test.createTestingModule` + `useValue`-моки — как в `health.controller.spec.ts`)

Unit (`auth.service.spec.ts`, `email-verification.service.spec.ts`):
- дубликат email → `ConflictException`
- подтверждение выключено → пользователь создаётся с `isEmailVerified: true`, письмо не отправляется
- подтверждение включено → пользователь создаётся с `isEmailVerified: false`, вызывается `MailerService.sendMail`, создаётся `EmailVerification`
- валидный OTP/токен → `isEmailVerified` становится `true`, ряд помечается consumed
- невалидный код → счётчик попыток растёт, ошибка
- превышение лимита попыток → блокировка без сравнения кода
- resend раньше интервала → ошибка; после интервала → новый код, обновлённый `lastSentAt`
- пароль хэшируется (`argon2.hash` вызван, plaintext нигде не встречается в моках/снапшотах)

Controller (переписать `auth.controller.spec.ts` — сейчас это тривиальная заглушка на `{ message: 'Not implemented yet' }`):
- каждый эндпоинт мокает `AuthService`, проверяет маппинг в HTTP-статусы/DTO

**Проверено (acceptance, ручная проверка на живом сервере с поднятым Postgres + Mailpit):**
- `AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION=false`: `POST /auth/register` → `201`, пользователь в БД с `isEmailVerified=true`.
- `AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION=true`, метод `otp`: `POST /auth/register` → `200 { requiresConfirmation: true }`, письмо с кодом видно в Mailpit UI, `POST /auth/register/confirm-otp` с верным кодом → `200`, пользователь верифицирован.
- Повторная регистрация на тот же email → `409`.
- 6-я попытка неверного кода → `429`, дальше код уже не проверяется даже если он верный.
- Повторный resend раньше 60с → `429`.
