# Single sign-on (OpenID Connect)

Oficio can sign people in through an OpenID Connect identity provider (Google Workspace, Microsoft Entra ID, Keycloak, Authentik, or any other compliant provider) next to the existing e-mail/password accounts. This page covers how the flow works, every `OIDC_*` variable, how to register the application at the most common providers, how accounts are linked and created, how administrators are mapped from a group claim, how to turn password login off, and what each error on the login page means.

Single sign-on is optional. Without the three required variables nothing changes: the login page shows the password form only.

## How it works

1. The login page reads `GET /api/config`. When `oidc.enabled` is true it shows a **Continue with &lt;label&gt;** button pointing at `GET /api/auth/oidc/start`.
2. `start` creates a random `state`, a `nonce` and a PKCE code verifier (S256), stores them in a short-lived cookie (`office_oidc`, 10 minutes, `HttpOnly`, `SameSite=Lax`, `Secure` unless `OFFICE_COOKIE_SECURE=0`, signed with `OFFICE_JWT_SECRET`) and redirects the browser to the provider's authorization endpoint. An optional `?next=/path` (internal paths only) is carried along.
3. The provider authenticates the person and redirects back to `GET /api/auth/oidc/callback?code=…&state=…`.
4. The callback checks the `state` against the cookie, exchanges the code (with the PKCE verifier and the client secret), validates the ID token (signature, issuer, audience, expiry, `nonce`), reads the claims (`sub`, `email`, `email_verified`, `name`, and the admin claim if configured; the userinfo endpoint is consulted when the ID token lacks the e-mail or the admin claim), applies the [account rules](#account-linking-and-creation-rules), issues the normal session cookie (`office_session`, 30 days) and redirects to `/` or to the `next` path.
5. Any failure redirects to `/login?error=<code>`; the login page translates the code (see [Troubleshooting](#troubleshooting)). Tokens and authorization codes are never written to the log.

Provider metadata is fetched lazily from `OIDC_ISSUER/.well-known/openid-configuration` on the first sign-in and cached in memory; a failed discovery is not cached, so a provider outage only lasts as long as the outage. The server never crashes because of the provider: discovery errors surface as `error=oidc_unavailable`.

Rate limits: 30 sign-in starts per IP per 10 minutes, and failed callbacks count against the same window (`error=oidc_rate_limited`). Behind a proxy set `TRUST_PROXY=1` so the real client IP is used.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `OIDC_ISSUER` | unset | Issuer URL of the provider, the base of `/.well-known/openid-configuration`. Must be `https://` (plain `http://` is only accepted in `--dev`). |
| `OIDC_CLIENT_ID` | unset | Client ID of the application you registered at the provider. |
| `OIDC_CLIENT_SECRET` | unset | Client secret. Keep it in `.env`, never in the repository. |
| `OIDC_SCOPES` | `openid email profile` | Space-separated scopes. `openid` is added if missing. Add a groups scope when your provider needs it (Keycloak and Authentik examples below). |
| `OIDC_BUTTON_LABEL` | provider name derived from the issuer host (`Google`, `Microsoft`, `Keycloak`, `Authentik`, or the domain name capitalised), else `Single sign-on` | Text shown as "Continue with …" on the login page. Max 40 characters. |
| `OIDC_AUTO_CREATE` | `1` | Create an account on the first sign-in. With `0`, only people who already have an account (local, imported or previously linked) can sign in; others see `error=oidc_no_account`. |
| `OIDC_ALLOWED_DOMAINS` | empty (any) | Comma-separated e-mail domains accepted, for example `acme.com,acme.com.br`. Checked against the `email` claim, case-insensitive. Others see `error=oidc_domain`. |
| `OIDC_ADMIN_CLAIM` | unset | Name of the claim whose value (string or array) marks administrators, for example `groups` or `roles`. Must be set together with `OIDC_ADMIN_VALUES`. |
| `OIDC_ADMIN_VALUES` | unset | Comma-separated values of that claim that grant administrator access, for example `oficio-admins`. |
| `OIDC_PASSWORD_LOGIN` | `1` | With `0`, and single sign-on enabled, the login page hides the e-mail/password form and `POST /api/auth/login` answers `403`. Ignored (with a warning) when single sign-on is not enabled. |

Single sign-on is enabled only when `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` are all set. If only some of them are set the server logs a warning at boot and keeps single sign-on off. `GET /api/config` exposes `oidc: { enabled, label, passwordLogin }` and nothing else about the provider.

The **redirect URI** to register at the provider is always:

```
https://<OFFICE_DOMAIN>/api/auth/oidc/callback
```

It is built from `OFFICE_PUBLIC_URL` when set (recommended; `docker-compose.yml` derives it from `OFFICE_DOMAIN`), otherwise from the request's `Host` header and `X-Forwarded-Proto` (`TRUST_PROXY=1`).

Example `.env` fragment:

```ini
OIDC_ISSUER=https://accounts.google.com
OIDC_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
OIDC_CLIENT_SECRET=<secret from the provider>
OIDC_SCOPES=openid email profile
OIDC_BUTTON_LABEL=Google
OIDC_AUTO_CREATE=1
OIDC_ALLOWED_DOMAINS=acme.com
OIDC_ADMIN_CLAIM=
OIDC_ADMIN_VALUES=
OIDC_PASSWORD_LOGIN=1
```

Restart the app after changing these (`docker compose up -d`). Confirm with `curl -s https://office.example.com/api/config | grep oidc`.

## Registering the application at your provider

### Google Workspace

1. In the Google Cloud console, create or pick a project, open **APIs & Services → OAuth consent screen**, choose **Internal** (only accounts of your Workspace) and fill in the app name.
2. **Credentials → Create credentials → OAuth client ID**, type **Web application**. Authorised redirect URI: `https://<OFFICE_DOMAIN>/api/auth/oidc/callback`.
3. Copy the client ID and secret.

```ini
OIDC_ISSUER=https://accounts.google.com
OIDC_SCOPES=openid email profile
OIDC_ALLOWED_DOMAINS=acme.com
```

Google always sends `email` and `email_verified`. It does not send group membership in the ID token or userinfo, so `OIDC_ADMIN_CLAIM` is not available with Google: promote administrators in the admin panel (they keep the flag; see the rules below). `OIDC_ALLOWED_DOMAINS` is the way to restrict access to your Workspace domain(s) when the consent screen is not *Internal*.

### Microsoft Entra ID

1. **Entra ID → App registrations → New registration**. Supported account types: *Accounts in this organizational directory only*. Redirect URI (type **Web**): `https://<OFFICE_DOMAIN>/api/auth/oidc/callback`.
2. **Certificates & secrets → New client secret**; copy the *value* (not the ID).
3. The issuer is `https://login.microsoftonline.com/<tenant-id>/v2.0` (the Directory (tenant) ID is on the app's Overview page). Do not use `common` or `organizations` as the tenant: the issuer in the tokens would not match.
4. Optional groups: **Token configuration → Add groups claim**, choose *Security groups* (or *Groups assigned to the application*) and tick *Group ID* for the **ID** token. The claim is named `groups` and contains the groups' object IDs (GUIDs), so `OIDC_ADMIN_VALUES` is the GUID of your admin group. If you prefer names, use **App roles** instead: define an app role (for example `Oficio.Admin`), assign it to users or groups under *Enterprise applications*, and map `OIDC_ADMIN_CLAIM=roles` / `OIDC_ADMIN_VALUES=Oficio.Admin`.

```ini
OIDC_ISSUER=https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0
OIDC_SCOPES=openid email profile
OIDC_ADMIN_CLAIM=groups
OIDC_ADMIN_VALUES=11111111-2222-3333-4444-555555555555
```

Entra sends `email` for work accounts with a mailbox; accounts without an e-mail (`email` missing) are refused with `error=oidc_no_email`. Entra does not send `email_verified`, which is accepted (the check only rejects an explicit `false`).

### Keycloak

1. In your realm: **Clients → Create client**. Client type *OpenID Connect*, client ID for example `oficio`. Enable **Client authentication** (confidential client) and keep **Standard flow** on.
2. Valid redirect URIs: `https://<OFFICE_DOMAIN>/api/auth/oidc/callback`. Web origins: `https://<OFFICE_DOMAIN>`.
3. **Credentials** tab: copy the client secret.
4. Groups: in the client's **Client scopes → `oficio-dedicated` → Add mapper → By configuration → Group Membership**. Token claim name `groups`, *Full group path* off, *Add to ID token* and *Add to userinfo* on. Then `OIDC_ADMIN_CLAIM=groups` and `OIDC_ADMIN_VALUES=<group name>`.

```ini
OIDC_ISSUER=https://keycloak.acme.com/realms/office
OIDC_SCOPES=openid email profile
OIDC_ADMIN_CLAIM=groups
OIDC_ADMIN_VALUES=oficio-admins
```

Keycloak sends `email_verified`; people whose e-mail is not verified in Keycloak are refused (`error=oidc_email_unverified`). Mark the e-mail as verified in the user's details or enable *Verify email* in the realm's login settings.

### Authentik

1. **Applications → Providers → Create → OAuth2/OpenID Provider**. Client type *Confidential*, authorization flow *implicit consent* (or explicit), redirect URI `https://<OFFICE_DOMAIN>/api/auth/oidc/callback`. Under *Advanced protocol settings* keep the scopes `openid`, `email`, `profile` and add **`authentik default OAuth Mapping: OpenID 'groups'`** if you want group mapping. Subject mode: *Based on the User's hashed ID* (default) is fine; do not switch it later, the account link is by `sub`.
2. **Applications → Create** and attach the provider. The issuer is shown on the provider page as *OpenID Configuration Issuer*, usually `https://authentik.acme.com/application/o/<application-slug>/`.
3. Copy the client ID and secret from the provider page.

```ini
OIDC_ISSUER=https://authentik.acme.com/application/o/oficio/
OIDC_SCOPES=openid email profile groups
OIDC_ADMIN_CLAIM=groups
OIDC_ADMIN_VALUES=oficio-admins
```

Authentik puts the `groups` claim (group names) in the ID token when the `groups` scope is requested.

### Any other provider

You need a confidential client (client ID + secret) using the authorization code flow with PKCE (S256), the redirect URI above, scopes `openid email profile`, and the issuer URL that serves `/.well-known/openid-configuration`. Providers that support client authentication only via `client_secret_basic` are also supported (`openid-client` negotiates it from the metadata).

## Account linking and creation rules

On every successful sign-in, in this order:

1. The ID token must contain `sub` and `email`. If the provider sends `email_verified: false`, the sign-in is refused (`oidc_email_unverified`). A missing `email_verified` is accepted.
2. If `OIDC_ALLOWED_DOMAINS` is set, the e-mail domain must be in the list (`oidc_domain`).
3. The account is looked up by identity: `external_id = "oidc:<issuer>|<sub>"` (the issuer as published in the provider's metadata). Found → that account is used, even if the e-mail at the provider changed since.
4. Otherwise it is looked up by e-mail (case-insensitive). Found → the account is **linked** by setting `external_id`; name, password and admin flag are left untouched, so a person invited with a temporary password who then uses single sign-on keeps the account. Accounts that came from `import-json` keep their import `external_id` and are accepted by e-mail on every sign-in (they show as `imported`, not `sso`).
5. Otherwise, with `OIDC_AUTO_CREATE=1` (default), a new account is **created**: name from `name` (or `given_name` + `family_name`, `preferred_username`, or the e-mail's local part), a random unusable password, `must_change_password = false`. With `OIDC_AUTO_CREATE=0` the sign-in ends in `oidc_no_account`.
6. Disabled accounts cannot sign in (`oidc_disabled`), exactly like the password form.
7. **Administrator mapping**: when `OIDC_ADMIN_CLAIM`/`OIDC_ADMIN_VALUES` are set and the claim contains one of the values, the account becomes administrator (new or existing). When the claim does not contain the values, nothing is changed: an account that was promoted in the admin panel **keeps** its administrator access. Demote people in the admin panel; Oficio never removes the flag through single sign-on. Group membership is read from the ID token first and from the userinfo endpoint when the claim is missing there.

In the admin panel, linked accounts show the source badge **SSO**. Everything else works as for any account: disable, promote, reset the password. Resetting the password of an SSO account gives it a temporary password (e-mailed or shown once) and asks for a new one on the next sign-in, which lets that person use the password form again when it is enabled.

## Disabling password login

Set `OIDC_PASSWORD_LOGIN=0` (with single sign-on enabled). The login page then shows only the single sign-on button, and `POST /api/auth/login` answers `403 {code: "password_login_disabled"}`. What keeps working:

- the CLI (`create-admin`, `reset-password`, `import-json`), because it talks to the database directly;
- `LOGIN_MASTER_PASSWORD` in `--dev`, for local development;
- password reset links and the forced password change page (an administrator can still reset someone's password; it is only the sign-in with a password that is blocked);
- existing sessions.

Before switching it on, sign in once through the provider with an account that is (or will become) administrator, so you are not locked out of the admin panel if the group mapping is not right. To recover access with the password form, set `OIDC_PASSWORD_LOGIN=1` and restart.

## Troubleshooting

Codes that can appear in `/login?error=…`:

| Code | Meaning | What to check |
|---|---|---|
| `oidc_unavailable` | Discovery or the token endpoint could not be reached, or the metadata is invalid. | `OIDC_ISSUER` is exactly the issuer the provider publishes (open `<issuer>/.well-known/openid-configuration` in a browser); the container can reach the provider (DNS, egress firewall, TLS). The app log has the underlying error. |
| `oidc_state` | The transient cookie is missing, expired (10 min) or does not match the `state` that came back. | The callback must land on the same host that started the flow (`OFFICE_PUBLIC_URL`/`OFFICE_DOMAIN`); cookies must be allowed; over plain HTTP set `OFFICE_COOKIE_SECURE=0` (development only). Reusing a callback URL from the browser history gives this too. |
| `oidc_failed` | The code exchange or the ID token validation failed, or the provider returned an error other than `access_denied`. | Client secret wrong or rotated; redirect URI registered differently (trailing slash, http vs https); clock skew on the server; wrong tenant in the Entra issuer. The log has the provider's message. |
| `oidc_denied` | The person cancelled at the provider or is not assigned to the application. | Assign the user/group to the application (Entra *Enterprise applications*, Authentik bindings). |
| `oidc_no_email` | No `email` claim in the ID token nor in userinfo. | Request the `email` scope; for Entra make sure the account has a mail attribute; for Keycloak check the user has an e-mail. |
| `oidc_email_unverified` | The provider sent `email_verified: false`. | Verify the e-mail at the provider. |
| `oidc_domain` | E-mail domain not in `OIDC_ALLOWED_DOMAINS`. | Add the domain or use another account. |
| `oidc_no_account` | `OIDC_AUTO_CREATE=0` and no account with that e-mail. | Invite the person in the admin panel first. |
| `oidc_disabled` | The account is disabled. | Re-enable it in the admin panel. |
| `oidc_rate_limited` | More than 30 starts (or repeated failures) from one IP in 10 minutes. | Wait; behind a proxy set `TRUST_PROXY=1` so one office IP is not shared by everyone. |
| `oidc_not_configured` | The `/api/auth/oidc/*` routes were called while single sign-on is off. | Set the three required variables and restart. |

Other things to know:

- **Button missing on the login page**: `curl -s https://office.example.com/api/config` must show `"oidc":{"enabled":true,…}`. If `enabled` is false, read the boot warnings (`docker compose logs app | grep -i oidc`).
- **Redirect loop after signing in**: the session cookie is `Secure`; you are probably reaching the app over plain HTTP. Fix the proxy/TLS rather than disabling `OFFICE_COOKIE_SECURE`.
- **Nobody became administrator**: check the claim name and values with the provider's token inspector (Keycloak *Evaluate*, Entra *Token configuration*, Authentik *Preview*); values are compared exactly (Entra group IDs are GUIDs). Remember the mapping only grants; the first admin can also be created with `create-admin`.
- **Someone changed their e-mail at the provider**: the account is still found by `sub`; update the e-mail in the admin panel if you want them to match.
- **Switching providers** (for example from one Keycloak realm to another): the stored `external_id` includes the issuer, so people will be re-linked by e-mail on their first sign-in with the new provider, as long as the e-mail is the same.

## Security notes

- Authorization code flow with PKCE (S256) and a `nonce`; the ID token's signature, issuer, audience, expiry and nonce are validated by `openid-client`.
- `state`, `nonce` and the PKCE verifier live only in a signed, `HttpOnly`, 10-minute cookie scoped to `/api/auth/oidc`; the cookie is cleared on every callback.
- The client secret and access tokens are never logged and never leave the server; `GET /api/config` exposes only `enabled`, `label` and `passwordLogin`.
- The `next` parameter accepts internal paths only (no `//host`, no `/api/…`).
- Single sign-on does not weaken anything else: disabled accounts stay out, the session cookie and its 30-day lifetime are the same, and admin actions (disable, reset) apply equally.
