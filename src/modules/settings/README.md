# Auth settings

`GET /admin/settings/auth` requires `settings:read` and returns all four effective settings.
`PATCH /admin/settings/auth` requires `settings:update`, accepts a nonempty partial
object, and returns the effective settings after saving:

```json
{
  "registrationConfirmationRequired": true,
  "registrationConfirmationMethod": "otp",
  "loginConfirmationRequired": false,
  "loginConfirmationMethod": "magic_link"
}
```

Boolean fields accept only JSON booleans, methods accept `otp` or `magic_link`.
`null` resets a field: its database row is deleted and the env value (or default)
applies again. Unknown keys, string booleans and empty patches return 400. Omitted
fields are unchanged. All fields in a patch are saved in one transaction. Changes are
logged with the actor's user ID and the requested patch.

The registry in `auth-settings.registry.ts` defines allowed keys and their env
fallbacks. A database row overrides env, including when its value is `false`;
while a row exists, changing the env variable has no effect until it is reset.
Without a row or env value, confirmation defaults to disabled and the method to
`otp`, matching the existing application defaults. No initial settings rows are
needed. Database errors or invalid stored values are not treated as missing rows.

Registration and login each use one settings snapshot. Newly issued/resend
confirmations use the selected method; outstanding codes remain valid until
consumed or expired. Email-change and account-deletion methods continue using
their existing env settings.

`isEmailVerified` becomes `true` only when a registration code/link is consumed;
users registered while confirmation was off stay `false`. Login checks the
current setting: while `registrationConfirmationRequired` is off, unverified
users log in normally; once it is on, logging in with a correct password issues
a registration code and returns
`{ requiresConfirmation: true, purpose: "register", method, email }` instead of
tokens. After confirming via `/auth/register/confirm-*` the user logs in again.
Verified users are never asked again. Login confirmation codes (per-login 2FA)
return `purpose: "login"` and are independent of this.

Before starting the updated application, apply the pending migrations:

```sh
npm run migration:run
```

They create the settings table and grant the admin role `settings:read` and
`settings:update`. Start/restart the application afterwards so its RBAC cache
loads the new grant. HTTP tests use a mocked repository; they do not apply these
migrations to a database.
