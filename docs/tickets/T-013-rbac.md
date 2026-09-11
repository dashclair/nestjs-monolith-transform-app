# T-013 — RBAC (динамический, на основе ролей/разрешений/назначений в БД)

Детализация тикета T-013 из [PLAN.md](../PLAN.md) на основе функциональных требований к разделу «RBAC» (Notion). Ссылка из PLAN.md — краткая версия, здесь — полный контракт для реализации.

**Важно:** это расширяет исходную строчку T-013 в PLAN.md ("enum ролей, `@Roles()` декоратор, `RolesGuard`") — та описывала статический enum-based вариант из раздела «Рекомендации по инструментам». Требования из Notion просят материально более крупную вещь: роли/разрешения/назначения хранятся в БД, управляются через admin API и применяются без передеплоя. Этот документ — контракт под динамический вариант, старую строчку в PLAN.md он заменяет, а не дополняет.

**Жёсткая зависимость: T-012 (аутентификация) должна быть сделана раньше.** Проверка доступа по спеке берёт `userId`/роли пользователя из JWT (п. 1.1 требований: "Авторизация запросов выполняется после аутентификации (JWT)"), а admin-эндпоинты самого RBAC защищены "только Admin" — то есть нужен уже работающий guard, различающий аутентифицированного пользователя и его роль. Без T-012 RBAC реализовать осмысленно нельзя.

Текущее состояние кода (проверено перед написанием тикета):

- `User.role` — нативный Postgres `enum` (`UserRole.USER | UserRole.ADMIN`, `src/modules/users/user-role.enum.ts`), не таблица, и не поддерживает больше одной роли на пользователя. Динамическое создание ролей через API и множественность ролей с таким полем невозможны — потребуется миграция (см. «Архитектурные решения» ниже).
- Таблиц/сущностей `Role`, `Permission`, `Grant` нет.
- T-012 (JWT, `passport-jwt`, guard) ещё не реализован — `AuthController` содержит только регистрацию.
- `@nestjs/passport`, `passport-jwt`, `@casl/ability` — не установлены. Кеш (`@nestjs/cache-manager` или самописный) — не установлен.

---

## Архитектурные решения (зафиксировать в PR/коммите)

1. **`users.role`: enum → многие-ко-многим с таблицей `roles`.** Раз роли создаются динамически через `POST /admin/rbac/roles`, они не могут оставаться Postgres-enum'ом с фиксированным набором значений. Требования прямо говорят о множественности («носитель одной или **нескольких** ролей», `roles: string[]` в п. 1.3.1) — реализуем это буквально с самого начала, а не колонкой `roleId` на одну роль: join-таблица `user_roles` (`userId` FK → `users.id`, `roleId` FK → `roles.id`, составной PK/уникальный индекс на паре), `User.roles: Role[]` через `@ManyToMany`. Стоимость этого варианта по сравнению с одной FK-колонкой почти нулевая на этом этапе (разница — join-таблица вместо колонки, `roles: string[]` вместо `role: string` в JWT-payload и guard, который итерирует по массиву), а откладывать означало бы вторую миграцию позже, когда реальная multi-role-потребность появится. Миграция сидит таблицу `roles` строками `admin`/`user`, переносит данные `users.role` в `user_roles` (по одной строке на пользователя, сохраняя текущую семантику «один пользователь — одна роль» как частный случай), затем дропает колонку `role` и Postgres enum-тип `users_role_enum`.
2. **Бутстрап первого админа — идемпотентный сид-скрипт, не ручной SQL.** После этой миграции доступ к `POST /admin/rbac/*` есть только у Admin, а создать первую Admin-роль пользователю через API некому. Решение — `scripts/seed-admin.js` (по образцу уже существующего `scripts/migration-generate.js` — тонкая обёртка, а не отдельная инфраструктура): читает `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD` из `.env`, хэширует пароль через `argon2` (переиспользуя `PasswordService`), создаёт пользователя (или назначает роль `admin` существующему по этому email), если такого назначения ещё нет — идемпотентно, безопасно гонять повторно. Добавить `npm run seed:admin` в `package.json` и шаг в README («после первого `migration:run` — выполнить один раз»). Ручной SQL как альтернатива отклонён — не воспроизводим, не документируется сам собой и легко забывается при разворачивании на новом окружении.
3. **Формат разрешения.** Требования используют нотацию `ресурс@действие` (`permission1`, действия `create/update/delete`). Реализация — не строковый парсинг на каждом месте использования, а типизированный декоратор с двумя аргументами: `@RequirePermission('users', 'update')`. Так же легче искать по кодовой базе все места, где используется конкретный ресурс.
4. **Кеш — in-memory, без Redis.** Весь набор ролей/разрешений/назначений для этого проекта — маленький датасет (десятки строк). Простой сервис (`RbacConfigService`) держит его в памяти (`Map<roleId, Grant[]>`), загружает при старте (`onModuleInit`) и **полностью перечитывает** одним запросом при любой мутации через admin-эндпоинты — точечная инвалидация по одной роли не даёт выигрыша при таком объёме данных и добавляет риск рассинхронизации. Одноинстансность приложения (нет упоминания горизонтального масштабирования в НФТ) снимает вопрос кросс-инстансной инвалидации.
5. **`@casl/ability` не используем** — уже решено в PLAN.md («Рекомендации по инструментам»): для правил вида «роль → разрешение → действие» своего guard'а с картой в памяти достаточно, casl был бы избыточен на этот объём.

---

## Новые сущности

### `Role` — `src/modules/rbac/entities/role.entity.ts`, таблица `roles`

| Поле | Тип | Примечание |
|---|---|---|
| `id` | `uuid`, PK | |
| `name` | `varchar`, unique | напр. `admin`, `user` |
| `description` | `varchar`, nullable | |
| `createdAt`/`updatedAt` | `timestamptz` | |

### `Permission` — `src/modules/rbac/entities/permission.entity.ts`, таблица `permissions`

| Поле | Тип | Примечание |
|---|---|---|
| `id` | `uuid`, PK | |
| `name` | `varchar`, unique | идентификатор ресурса, напр. `users`, `transformations` |
| `actions` | `varchar[]` (Postgres array) или `jsonb` | допустимые действия для ресурса, напр. `['create','update','delete']` |
| `createdAt`/`updatedAt` | `timestamptz` | |

### `Grant` — `src/modules/rbac/entities/grant.entity.ts`, таблица `grants`

| Поле | Тип | Примечание |
|---|---|---|
| `id` | `uuid`, PK | |
| `roleId` | `uuid`, FK → `roles.id`, `onDelete: 'CASCADE'` | индекс |
| `permissionId` | `uuid`, FK → `permissions.id`, `onDelete: 'CASCADE'` | индекс |
| `actions` | `varchar[]`, nullable | подмножество `permission.actions`; `null`/пусто = доступны все действия разрешения (п. 1.3.4 требований) |
| `createdAt`/`updatedAt` | `timestamptz` | |

Уникальный составной индекс `(roleId, permissionId)` — дубликат назначения (та же роль + разрешение) запрещён требованиями (п. 1.3.4).

### `user_roles` — join-таблица многие-ко-многим, `src/modules/users/entities/user.entity.ts` (`@ManyToMany` на `User`) + `src/modules/rbac/entities/role.entity.ts` (`@ManyToMany` на `Role`), TypeORM сам создаёт join-таблицу через `@JoinTable()` на стороне `User`

| Поле | Тип | Примечание |
|---|---|---|
| `userId` | `uuid`, FK → `users.id`, `onDelete: 'CASCADE'` | часть составного PK |
| `roleId` | `uuid`, FK → `roles.id`, `onDelete: 'CASCADE'` | часть составного PK |

### Миграция `users.role`

Отдельная миграция (после сидирующей `roles`): создать `user_roles`, скриптом перенести данные (по одной строке в `user_roles` на каждого пользователя: `role = 'admin' → (userId, <id роли admin>)` и т.п.), затем дропнуть колонку `role` на `users` и Postgres enum-тип `users_role_enum`.

---

## Guard / декоратор

- `@RequirePermission(resource: string, action: string)` — декоратор метаданных (`Reflector`, `SetMetadata`), по аналогии с тем, как задумывался `@Roles()` в исходном плане.
- `PermissionsGuard` (`src/modules/rbac/guards/permissions.guard.ts`) — читает метаданные `RequirePermission` с хендлера, достаёт `request.user` (заполняется JWT-guard'ом из T-012 — **`PermissionsGuard` должен идти вторым в цепочке**, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, либо `JwtAuthGuard` глобален через `APP_GUARD`, а `PermissionsGuard` — только там, где явно навешан декоратор), обращается к `RbacConfigService` за закешированной конфигурацией и выполняет шаги 1–7 из п. 1.3.1 требований:
  1. Роли пользователя из `request.user.roles: string[]` (несколько — п. 1 «Архитектурных решений»).
  2. Для каждой роли из списка найти все `Grant` в закешированной конфигурации (объединение, а не пересечение — если хотя бы одна роль даёт доступ, доступ разрешён).
  3. Среди них найти `Grant` с нужным `permission.name === resource`.
  4. Если `grant.actions` пусто/`null` — разрешено любое действие разрешения.
  5. Если `grant.actions` заполнено — разрешено только если `action` входит в список.
  6. Совпадение найдено хотя бы по одной роли → пропустить запрос дальше.
  7. Не найдено ни по одной роли → `ForbiddenException` (`403`).

`RbacConfigService` (`src/modules/rbac/services/rbac-config.service.ts`) — `onModuleInit()` грузит все `Grant` с join на `Role`/`Permission` в `Map<roleId, Array<{ permissionName, actions }>>`; публичный `reload()` вызывается из admin CRUD-сервисов после любой мутации Role/Permission/Grant.

---

## Admin CRUD-эндпоинты

Общее для всех трёх групп: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermission('rbac', <action>)` (или отдельные ресурсы `rbac.roles`/`rbac.permissions`/`rbac.grants`, если нужна более тонкая грануляция — решить на месте реализации), Swagger-теги `RBAC`.

### Роли (`/admin/rbac/roles`)

| Метод/путь | Тело | Проверки | Ответы |
|---|---|---|---|
| `GET /admin/rbac/roles` | — | только Admin | `200` |
| `POST /admin/rbac/roles` | `{ name, description? }` | только Admin, `name` уникален | `201` / `400` / `409` |
| `PUT /admin/rbac/roles/:roleId` | `{ name?, description? }` | только Admin, роль существует, `name` уникален | `200` / `400` / `404` / `409` |
| `DELETE /admin/rbac/roles/:roleId` | — | только Admin, запрет удаления при активных `Grant` (`409`, не каскад — см. п. 1.4 требований) | `200` / `403` / `404` / `409` |

### Разрешения (`/admin/rbac/permissions`)

| Метод/путь | Тело | Проверки | Ответы |
|---|---|---|---|
| `GET /admin/rbac/permissions` | — | только Admin | `200` |
| `POST /admin/rbac/permissions` | `{ name, actions: string[] }` | только Admin, `name` уникален, `actions` непустой массив строк | `201` / `400` / `409` |
| `PUT /admin/rbac/permissions/:permissionId` | `{ name?, actions?: string[] }` | только Admin, существует, `name` уникален | `200` / `400` / `404` / `409` |
| `DELETE /admin/rbac/permissions/:permissionId` | — | только Admin, запрет при активных `Grant` | `200` / `403` / `404` / `409` |

### Назначения (`/admin/rbac/grants`)

| Метод/путь | Тело | Проверки | Ответы |
|---|---|---|---|
| `GET /admin/rbac/grants` | — | только Admin | `200` |
| `POST /admin/rbac/grants` | `{ roleId, permissionId, actions?: string[] }` | только Admin, роль и разрешение существуют, `actions ⊆ permission.actions`, дубликат `(roleId, permissionId)` запрещён | `201` / `400` / `404` / `409` |
| `PUT /admin/rbac/grants/:grantId` | `{ actions?: string[] }` | только Admin, существует, `actions ⊆ permission.actions` | `200` / `400` / `404` |
| `DELETE /admin/rbac/grants/:grantId` | — | только Admin | `200` / `404` |

Любая мутация (create/update/delete в любой из трёх групп) в конце вызывает `RbacConfigService.reload()` — п. 1.5 требований: "сброс кеша и перезагрузку конфигурации" логируется отдельно.

---

## Таблица ошибок

| Ситуация | Код | Тело |
|---|---|---|
| Не аутентифицирован | `401` | из JWT-guard'а (T-012) |
| Нет разрешения на ресурс/действие | `403` | `"Forbidden"` (без деталей о том, какое разрешение проверялось — не палим модель прав) |
| Роль/разрешение/назначение не найдено | `404` | `"Role not found"` / `"Permission not found"` / `"Grant not found"` |
| Дубликат имени роли/разрешения | `409` | `"Role/Permission with this name already exists"` |
| Дубликат назначения (та же роль+разрешение) | `409` | `"Grant already exists for this role and permission"` |
| Удаление роли/разрешения с активными назначениями | `409` | `"Cannot delete: active grants exist"` |
| `actions` в Grant не является подмножеством `permission.actions` | `400` | `"Invalid actions for this permission"` |

---

## Аудит-логи (через `Logger`, тот же формат событий, что в T-011)

- `rbac.role.created` / `.updated` / `.deleted` (с `actorUserId`)
- `rbac.permission.created` / `.updated` / `.deleted`
- `rbac.grant.created` / `.updated` / `.deleted`
- `rbac.access.denied` (403 — `actorUserId`, `resource`, `action`)
- `rbac.config.reloaded` (сброс кеша)

---

## Тесты (Vitest)

Unit:
- `RbacConfigService` — загрузка при старте, `reload()` пересобирает карту из мокнутого репозитория.
- `PermissionsGuard` — разрешение есть без указания `actions` в Grant → любое действие пропускается; `actions` указаны → только перечисленные; роль без нужного Grant → `403`; несуществующая роль в конфигурации → `403` (не 500).
- CRUD-сервисы (roles/permissions/grants) — валидации из таблиц выше (дубликаты, несуществующие ссылки, запрет удаления при активных назначениях, `actions ⊆ permission.actions`).

Controller/e2e:
- Пользователь без роли Admin → `403` на всех `/admin/rbac/*`.
- Полный цикл: создать роль → создать разрешение → создать назначение → пользователь с этой ролью получает доступ к защищённому декоратором `@RequirePermission` роуту → удалить назначение → доступ пропадает без рестарта приложения (проверяет реальную инвалидацию кеша, не только логику в изоляции).

**Проверено (acceptance, ручная проверка на живом сервере, после реализации T-012):**
- Свежий инстанс: до запуска `npm run seed:admin` — `POST /admin/rbac/roles` от только что зарегистрированного и залогиненного пользователя → `403`.
- После `npm run seed:admin` — полный CRUD-цикл roles/permissions/grants отрабатывает согласно таблицам выше; повторный запуск `seed:admin` идемпотентен (не падает, не плодит дублирующих назначений).
- Изменение/удаление grant применяется к уже работающему приложению без рестарта (следующий запрос от пользователя с этой ролью сразу видит новый результат).
