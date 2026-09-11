# T-012 — Аутентификация (вход по email+паролю, JWT, опциональное подтверждение через email)

Детализация тикета T-012 из [PLAN.md](../PLAN.md) на основе функциональных требований к разделу «Аутентификация» (Notion). Ссылка из PLAN.md — краткая версия, здесь — полный контракт для реализации. Написан по аналогии с [T-010-011-registration.md](T-010-011-registration.md) — многое в нём переиспользуется буквально.

Текущее состояние кода (проверено перед написанием тикета):

- `AuthController.login()` — заглушка (`{ message: 'Not implemented yet' }`), уже размечена `@Throttle` (T-005, 5/60с) — **не трогать лимит**.
- `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt` — не установлены. `JWT_SECRET`/`JWT_ACCESS_TTL`/`JWT_REFRESH_TTL` уже есть в конфиге (T-001), но нигде не используются.
- `EmailVerification`/`EmailVerificationService` (T-011) — рассчитаны только на подтверждение email при регистрации: `issue(userId)`/`confirm(userId, code)`/`canResend(userId)` ищут ряд по одному `userId` без учёта того, *зачем* верификация была создана.
- `User.isEmailVerified` — есть (T-010), проверяется при регистрации. **При логине пока нигде не проверяется** — а по решению, зафиксированному в T-011 (`docs/tickets/T-010-011-registration.md`, п. 1 «Архитектурные решения»), логин с `isEmailVerified = false` должен быть заблокирован. Эта задолженность закрывается в этом тикете.
- Полей для лимита неудачных попыток входа / временной блокировки аккаунта на `User` нет — есть только IP-based throttle на `/auth/login` (T-005, 5 запросов/60с), а требования (п. 1.6) просят отдельно ещё и **защиту от перебора на уровне аккаунта** (rate limit / временная блокировка), это разные вещи.
- RBAC (T-013) в кодовой базе ещё не существует — `User.role` пока `enum`, не FK. T-012 реализуется первым, T-013 меняет `role` на ссылку на таблицу `roles` уже поверх готового JWT (см. ниже «Стыковка с T-013»).

---

## Архитектурные решения (зафиксировать в PR/коммите)

1. **Обобщить `EmailVerification`/`EmailVerificationService`, а не заводить отдельную сущность `PendingLoginAttempt`.** Подтверждение входа (OTP/magic link, TTL, лимит попыток, resend — п. 1.3 требований) один-в-один повторяет уже реализованное подтверждение регистрации (T-011). Дублировать сущность и сервис — плодить два места, где чинить одни и те же баги. Вместо этого:
   - В `EmailVerification` добавляется колонка `purpose: enum('register', 'login')`.
   - Методы `EmailVerificationService.issue/confirm/canResend` принимают `purpose` вторым параметром и ищут/создают ряд по `(userId, purpose)`, а не по одному `userId` — иначе незавершённая верификация регистрации и незавершённая верификация входа для одного и того же пользователя будут затирать друг друга.
   - Конфиг (`EMAIL_VERIFICATION_TTL_MINUTES`, `_MAX_ATTEMPTS`, `_RESEND_INTERVAL_SECONDS`, `OTP_LENGTH`) уже не привязан к регистрации в названиях — переиспользуется для обоих `purpose` без изменений. Метод подтверждения выбирается новым ключом `AUTH_LOGIN_CONFIRMATION_METHOD`, по аналогии с `AUTH_REGISTER_CONFIRMATION_METHOD`, а не общим.
   - Таблица/entity **не переименовывается** (`email_verifications`/`EmailVerification`) — переименование существующей смёрженной сущности ради чистоты названия того не стоит, «email verification» достаточно общо описывает и логин-код, присланный на email. Если ревью/ментор сочтёт иначе — переименование мелкое, не блокирует остальной контракт.
   - Миграция: `ALTER TABLE email_verifications ADD COLUMN purpose email_verification_purpose_enum NOT NULL DEFAULT 'register'` (дефолт нужен только для обратной совместимости существующих рядов, новые вызовы всегда передают `purpose` явно).
2. **Не раскрывать, существует ли email — обязательно, не опционально, в отличие от регистрации.** В T-011 для `/auth/register` был осознанно выбран не-нейтральный `409 "Email already registered"` (UX регистрации: пользователь должен понимать, логиниться ему или восстанавливать пароль). Для логина логика другая: пользователь и так уверен, что аккаунт есть, а различение «неверный пароль» / «аккаунт не найден» — прямой вектор перебора email вместе с п. 1.6 требований («защита от перебора паролей»). Оба случая (`Аккаунт не найден`, `Неверный email или пароль` из п. 1.4) возвращают **один и тот же** ответ: `401 "Invalid email or password"`, различие остаётся только в audit-логе (`reason: user_not_found` / `invalid_password`).
3. **`isEmailVerified = false` блокирует логин ещё до проверки пароля или после?** После проверки пароля, не до — иначе сам факт разного порядка проверок утекает через тайминг/через различающийся ответ и превращается в способ узнать, существует ли email с ещё не подтверждённой регистрацией. Порядок: email найден → пароль верный → **затем** проверка `isEmailVerified` → `403 "Email not verified"`. Это отдельная проверка от блокировки по лимиту попыток (п. 4) и от опционального подтверждения входа (п. 1.3 требований, `AUTH_LOGIN_REQUIRE_EMAIL_CONFIRMATION`) — три разных механизма, не путать в реализации.
4. **Лимит неудачных попыток входа / временная блокировка аккаунта — новые поля на `User`.** IP-throttle T-005 (5/60с на `/auth/login`) не покрывает распределённый перебор (много IP, один аккаунт) — а именно это просит п. 1.6. Добавляются `failedLoginAttempts: int default 0`, `lockedUntil: timestamptz nullable` (миграция на `users`). Инкремент при неверном пароле, сброс в 0 при успешном логине, при достижении `AUTH_LOGIN_MAX_FAILED_ATTEMPTS` — `lockedUntil = now + AUTH_LOGIN_LOCKOUT_MINUTES`. Пока `lockedUntil` в будущем — логин отклоняется `429` без сравнения пароля вообще (не тратим время на argon2.verify зря и не даём отличить «блокировка» от «перебор ещё не исчерпан» через тайминг).
5. **Refresh-токен — JWT, но с отзывом через `tokenVersion`, а не полностью stateless.** Требования не упоминают logout/отзыв сессий — только «выдать токены», и полная ротация refresh-токенов с таблицей `refresh_tokens` (одноразовые токены, обнаружение повторного использования) была бы избыточна без востребованного сценария (YAGNI). Но совсем без возможности отзыва — тоже неверный выбор для проекта, который уже нигде не хранит секреты в открытом виде (argon2, хэшированные OTP/токены T-011) и явно заботится о защите от перебора (п. 4 ниже, НФТ 1.6): дешёвый компромисс — счётчик `User.tokenVersion: int default 0`. Оба токена (access и refresh) несут в payload `tokenVersion` на момент выдачи; `JwtStrategy.validate()` и `refresh()` сверяют его с текущим значением в БД (тот же запрос пользователя, который и так нужен) — несовпадение → `401`, токен считается отозванным. Инкремент `tokenVersion` — точка расширения для будущих тикетов (logout, смена пароля, «отозвать все сессии»), в этом тикете сам инкремент нигде ещё не вызывается за пределами теста, но поле и проверка уже на месте. Refresh-токен — JWT с тем же `JWT_SECRET`, отдельным `expiresIn: JWT_REFRESH_TTL` и claim `type: 'refresh'` (access-токен — `type: 'access'`), `JwtStrategy` отклоняет токен с `type !== 'access'` при обращении к защищённым роутам, `POST /auth/refresh` — наоборот, требует `type === 'refresh'`. **Явное ограничение, зафиксировать в ревью:** без отдельной таблицы токенов нет ни ротации (каждый refresh-токен живёт до истечения `JWT_REFRESH_TTL`, не одноразовый), ни отзыва одной конкретной сессии — `tokenVersion` отзывает разом все сессии пользователя. Если понадобится точечный отзыв — отдельный тикет (таблица `refresh_tokens` + ротация). **Цена решения:** `JwtStrategy.validate()` перестаёт быть чисто криптографической проверкой подписи и делает один SELECT пользователя на каждый защищённый запрос — по объёму трафика этого проекта не проблема (тот же порядок цены, что уже принят для health-checks/throttler), но если появится нагрузка, ради которой этот запрос захочется убрать, единственный вариант — вернуться к полностью stateless-подходу и потерять отзыв вовсе, либо кешировать `tokenVersion` (тем же способом, что и RBAC-конфигурацию в T-013).
6. **Guard — глобальный (`APP_GUARD`) + декоратор `@Public()`, а не точечный `@UseGuards()` на каждом контроллере.** Дальше по плану (T-013 RBAC-admin роуты, T-015/016/017/018 `/users/*`) защищённых роутов становится много — забыть навесить guard на новый контроллер значительно опаснее, чем забыть `@Public()` на нём же. Регистрируется `JwtAuthGuard` глобально в `AppModule` (`APP_GUARD`, по аналогии с уже глобальным `ThrottlerGuard` из T-005), существующие public-роуты (`register*`, `login`, `login/confirm-*`, `login/resend`, `refresh`, `health`, diagnostics, Swagger) размечаются `@Public()` (`SetMetadata` + `Reflector` в `JwtAuthGuard`, тот же паттерн, что `@SkipThrottle()` в T-005).
7. **Стыковка с T-013 (RBAC).** JWT payload на этом этапе — `{ sub: user.id, email: user.email, role: user.role, tokenVersion, type }`, где `role` — текущий Postgres-enum-значение (`user`/`admin`, единственное на пользователя). T-013 меняет модель на многие-ко-многим (`User.roles: Role[]` через join-таблицу `user_roles`, см. `docs/tickets/T-013-rbac.md`) — payload и `JwtStrategy.validate()` придётся поправить вместе с этой миграцией: `role: string` → `roles: string[]` — **фиксируется здесь как известная будущая правка T-013, не блокирует T-012**. Компромисс, который стоит держать в голове уже сейчас: раз роли лежат в payload, изменение назначений ролей пользователя после RBAC применится только после следующего логина или обновления access-токена через refresh, не мгновенно — это ожидаемо при коротком `JWT_ACCESS_TTL` (дефолт 15м), отдельно уточнять не требуется.

---

## Конфиг (новые ключи, тот же плоский стиль с префиксами)

```ts
/**
 * Login email confirmation (2FA-like, separate flag from registration confirmation)
 */
AUTH_LOGIN_REQUIRE_EMAIL_CONFIRMATION?: boolean; // default false
AUTH_LOGIN_CONFIRMATION_METHOD?: 'otp' | 'magic_link'; // default 'otp'

/**
 * Account-level brute-force protection (in addition to IP-based ThrottlerGuard on /auth/login)
 */
AUTH_LOGIN_MAX_FAILED_ATTEMPTS?: number; // default 5
AUTH_LOGIN_LOCKOUT_MINUTES?: number; // default 15
```

`EMAIL_VERIFICATION_*`/`OTP_LENGTH` — переиспользуются без изменений (см. решение №1). Добавить Joi-правила в `config.validation.ts` (`.default(...)`) и записи в `.env.example`.

---

## Новые/изменённые сущности

### `EmailVerification` — изменение (миграция, не новая сущность)

Добавить колонку `purpose` (`enum('register', 'login')`, `NOT NULL DEFAULT 'register'`), составной индекс `(userId, purpose)` вместо/в дополнение к текущему индексу на `userId`.

### `User` — изменение (миграция, не новая сущность)

| Поле | Тип | Примечание |
|---|---|---|
| `failedLoginAttempts` | `int`, default `0` | сбрасывается в `0` при успешном логине |
| `lockedUntil` | `timestamptz`, nullable | пока в будущем — логин отклоняется `429` без проверки пароля |
| `tokenVersion` | `int`, default `0` | кладётся в payload access/refresh JWT; несовпадение с текущим значением в БД при валидации токена = токен отозван (решение №5) |

---

## JWT-инфраструктура

- `JwtModule.registerAsync` (`src/core/auth/jwt/` или `src/modules/auth/` — решить на месте по аналогии с существующей структурой `core/`; поскольку это сквозная инфраструктура для будущих модулей (`users`, `rbac`), а не только `auth`-фичи, разумно завести `src/core/auth/` по образцу `core/mailer`) — секрет и TTL из `ConfigService`.
- `JwtStrategy extends PassportStrategy(Strategy)` (`passport-jwt`) — `jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken()`, `secretOrKey: JWT_SECRET`, `validate(payload)`: проверяет `payload.type === 'access'` (иначе `UnauthorizedException` — рефреш-токен не должен работать как access), подгружает пользователя по `payload.sub` и сверяет `payload.tokenVersion === user.tokenVersion` (несовпадение → `UnauthorizedException`, токен отозван — решение №5), возвращает `{ userId: payload.sub, email: payload.email, role: payload.role }` → `request.user`.
- `JwtAuthGuard extends AuthGuard('jwt')` — переопределяет `canActivate`, пропускает роуты с `@Public()` (метадата через `Reflector`, аналог `@SkipThrottle()`).
- `@Public()` — декоратор-метка (`SetMetadata('isPublic', true)`).
- `TokenService` (`src/modules/auth/services/token.service.ts`) — `issueTokens(user): { accessToken, refreshToken }`, `verifyRefreshToken(token): payload`. Инкапсулирует оба `JwtService.signAsync` вызова (access/refresh с разным `expiresIn`/`type`), чтобы `AuthService` не работал с сырым `JwtService` напрямую.

---

## Эндпоинты

| Метод/путь | Throttle | Тело/query | Ответ |
|---|---|---|---|
| `POST /auth/login` | уже есть (T-005, 5/60с) — не менять | `LoginDto { email, password }` | подтверждение выкл: `200 { accessToken, refreshToken }`. подтверждение вкл: `200 { requiresConfirmation: true, method, email }` |
| `POST /auth/login/confirm-otp` | новый, напр. `10/60с` | переиспользовать `ConfirmOtpDto { email, code }` | `200 { accessToken, refreshToken }` |
| `GET /auth/login/confirm-link` | новый, напр. `10/60с` | переиспользовать `ConfirmMagicLinkQueryDto` (`?email=&token=`) | `200 { accessToken, refreshToken }` |
| `POST /auth/login/resend` | новый, напр. `5/60с` (плюс бизнес-лимит 60с/email, как в T-011) | переиспользовать `ResendConfirmationDto { email }` | `200 { sent: true }` |
| `POST /auth/refresh` | новый, напр. `20/60с` | `RefreshDto { refreshToken }` | `200 { accessToken, refreshToken }` |

DTO переиспользуются буквально из T-011 (`ConfirmOtpDto`, `ConfirmMagicLinkQueryDto`, `ResendConfirmationDto`) — их форма (`email`+`code`, `email`+`token`, `email`) идентична, заводить дубликаты только ради другого имени класса не нужно. Новые: `LoginDto`, `RefreshDto`.

**Важное отличие от регистрации:** при регистрации подтверждение email **не** выдаёт токены (T-011: «Токены/сессия при регистрации не выдаются»). При логине — наоборот, подтверждение (`confirm-otp`/`confirm-link`) обязано закончиться выдачей токенов, это и есть цель второго фактора для входа.

---

## Логика `AuthService.login()`

1. `auth.login.attempt` (email, без пароля).
2. Найти пользователя по email. Не найден → лог `reason: user_not_found`, throw `401 "Invalid email or password"` (см. решение №2).
3. `user.lockedUntil` в будущем → лог `auth.login.locked`, throw `429 "Account temporarily locked, try again later"` — **не** вызывать `passwordService.verify` вообще (решение №4).
4. `passwordService.verify(user.passwordHash, password)` — неверный → инкремент `failedLoginAttempts`; если достиг `AUTH_LOGIN_MAX_FAILED_ATTEMPTS` → выставить `lockedUntil`, лог `auth.login.locked`; в любом случае лог `reason: invalid_password`, throw `401 "Invalid email or password"` (тот же текст, что и «не найден» — решение №2).
5. Успех пароля → сбросить `failedLoginAttempts = 0`, `lockedUntil = null`.
6. `user.isEmailVerified === false` → `403 "Email not verified"` (решение №3; актуально только когда `AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION=true` — иначе поле всегда `true` с момента регистрации).
7. `AUTH_LOGIN_REQUIRE_EMAIL_CONFIRMATION === false` → `TokenService.issueTokens(user)`, лог `auth.login.success`, вернуть `{ accessToken, refreshToken }`.
8. Иначе → `emailVerificationService.issue(user.id, 'login')`, отправить письмо (переиспользуя `MailerService`/`sendConfirmationEmail`, обобщённый под оба `purpose`), лог `auth.login.success` (`requiresConfirmation: true`), вернуть `{ requiresConfirmation: true, method, email }` — токены не выдаются, пока не пройдено подтверждение (п. 1.2.2 требований, вариант B).

`confirmLoginOtp`/`confirmLoginMagicLink` — как `confirmOtp`/`confirmMagicLink` в T-011, но с `purpose: 'login'` и в конце **выдают токены** вместо `{ verified: true }` (см. «важное отличие» выше).

`refresh(refreshToken)` — `TokenService.verifyRefreshToken` (проверяет подпись, `type === 'refresh'`, срок действия) → находит пользователя по `payload.sub` (на случай, если пользователь удалён/роль сменилась — берём актуальные данные, не то, что было в самом refresh-токене) → сверяет `payload.tokenVersion === user.tokenVersion` (несовпадение — токен отозван, решение №5) → `TokenService.issueTokens(user)` → возвращает новую пару. Невалидный/просроченный/отозванный → `401 "Invalid refresh token"`.

---

## Таблица ошибок

| Ситуация | Код | Тело |
|---|---|---|
| Невалидный DTO (`email`/`password` формат) | `400` | стандартный ответ `ValidationPipe` |
| Аккаунт не найден **или** неверный пароль | `401` | `"Invalid email or password"` (единый текст — решение №2) |
| Email не подтверждён (регистрация) | `403` | `"Email not verified"` |
| Аккаунт временно заблокирован (лимит попыток) | `429` | `"Account temporarily locked, try again later"` |
| OTP/токен подтверждения входа неверный | `400` | `"Invalid confirmation code"` (как в T-011) |
| OTP/токен подтверждения входа просрочен | `400` | `"Confirmation code expired"` |
| Превышен лимит попыток ввода кода | `429` | `"Too many attempts, request a new code"` |
| Resend раньше интервала | `429` | `"Please wait before requesting a new code"` |
| Невалидный/просроченный refresh-токен | `401` | `"Invalid refresh token"` |
| Rate limit на сам `/login` (уже есть, T-005) | `429` | из `ThrottlerGuard`, без изменений |

---

## Аудит-логи (через `Logger`, тот же формат событий, что в T-011)

- `auth.login.attempt` / `.success` / `.failed` (`reason: user_not_found | invalid_password | email_not_verified`)
- `auth.login.locked` (аккаунт заблокирован после превышения лимита)
- `auth.login.confirmation_sent` (переиспользует `auth.email_verification.sent` с полем `purpose: 'login'`, либо отдельное имя события — решить при реализации, не принципиально)
- `auth.login.confirmation_confirmed` / `.failed`
- `auth.refresh.success` / `.failed`

---

## Тесты (Vitest, паттерн из T-011)

Unit (`auth.service.spec.ts`, дополнить существующий; `token.service.spec.ts`):
- неверный пароль → `401`, счётчик `failedLoginAttempts` растёт.
- превышение `AUTH_LOGIN_MAX_FAILED_ATTEMPTS` → `lockedUntil` выставлен, следующий логин с **верным** паролем всё равно `429` (проверяет, что пароль не сравнивается вообще, пока заблокировано).
- успешный логин сбрасывает `failedLoginAttempts`/`lockedUntil`.
- `isEmailVerified: false` → `403`, даже с верным паролем.
- аккаунт не найден и неверный пароль дают **одинаковый** текст ошибки (проверка решения №2 — регрессия на раскрытие email).
- `AUTH_LOGIN_REQUIRE_EMAIL_CONFIRMATION=false` → сразу токены, `EmailVerificationService.issue` не вызывается.
- `=true` → токены не выданы на первом шаге, `EmailVerificationService.issue(userId, 'login')` вызван с правильным `purpose`.
- `confirmLoginOtp`/`confirmLoginMagicLink` с верным кодом → токены выданы (в отличие от `confirmOtp` для регистрации — не путать в тесте).
- `refresh` с access-токеном вместо refresh (`type: 'access'`) → `401` (проверка защиты от подмены типа токена).
- `refresh` с просроченным refresh-токеном → `401`.
- токен, выпущенный со старым `tokenVersion` (после ручного инкремента в моке/фикстуре, имитирующего будущий logout/смену пароля) → `401` и на `refresh`, и через `JwtStrategy.validate()` на защищённом роуте.

Controller/e2e:
- `GET` на роут без `@Public()` без заголовка `Authorization` → `401` (проверка глобального `JwtAuthGuard`).
- Тот же роут с валидным access-токеном → пропускает.
- Роут с `@Public()` (например `login`) без заголовка → не блокируется guard'ом.

**Проверено (acceptance, ручная проверка на живом сервере, Postgres + Mailpit):**
- `AUTH_LOGIN_REQUIRE_EMAIL_CONFIRMATION=false`: верные email+пароль → `200` с токенами; неверный пароль → `401 "Invalid email or password"`; несуществующий email → тот же `401` с тем же текстом.
- 5 неверных паролей подряд (при дефолтном `AUTH_LOGIN_MAX_FAILED_ATTEMPTS=5`) → 6-я попытка (даже с верным паролем) → `429`, до истечения `AUTH_LOGIN_LOCKOUT_MINUTES`.
- Регистрация с `AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION=true`, без подтверждения → попытка логина → `403 "Email not verified"`.
- `AUTH_LOGIN_REQUIRE_EMAIL_CONFIRMATION=true`, метод `otp`: логин → `200 { requiresConfirmation: true }`, письмо в Mailpit, `POST /auth/login/confirm-otp` с верным кодом → `200` с токенами.
- `POST /auth/refresh` с полученным `refreshToken` → новая пара токенов; с `accessToken` вместо `refreshToken` → `401`.
- Любой защищённый диагностический роут (после того как на него навешан guard, например будущий `GET /users/me` из T-015, или временный тестовый защищённый роут) без заголовка `Authorization` → `401`; `GET /health`, `POST /auth/register`, `POST /auth/login` — по-прежнему доступны без токена.
