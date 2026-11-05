# Contributing to Oficio

Thanks for helping. Issues, docs, translations and code are all welcome.

## Development setup

```sh
git clone https://github.com/thiagomorello/oficio.git
cd oficio
npm install
npm run dev            # http://127.0.0.1:4747 — in-memory data, login dev@oficio.local / dev12345
```

Optional services for a more realistic environment (MySQL + LiveKit on localhost):

```sh
docker compose -f docker-compose.dev.yml up -d
export DATABASE_URL=mysql://oficio:oficio@127.0.0.1:3306/oficio
export LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_INTERNAL_URL=http://127.0.0.1:7880
export LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=devsecretdevsecretdevsecret12345
npm run cli -- migrate
npm run dev
```

Before opening a pull request:

```sh
npm run typecheck && npm test
```

## Project layout

| Folder | What lives there |
|---|---|
| `client/` | Browser app (Vite, plain TypeScript, canvas pixel art). Pages: `index.html`, `login.html`, `admin.html`. |
| `server/` | Node HTTP + WebSocket server, MySQL repositories and migrations, CLI. |
| `shared/` | Code used by both sides: protocol, map model, validation, i18n, branding. |
| `deploy/` | Stack files for Portainer, Caddy, nginx, LiveKit. |
| `docs/` | Documentation in English; `docs/pt-BR/` mirrors it in Portuguese. |
| `scripts/` | Secrets generator, backup/restore, brand asset generator, QA scripts. |

Read `docs/architecture.md` for the big picture.

## Conventions

- **TypeScript strict, ESM, no framework.** DOM is built with the `h()` helper (`client/src/ui/dom.ts`).
- **User-visible text goes through i18n.** Add the key to the right file in `shared/i18n/messages/` in every
  supported locale (`en`, `pt-BR`, `es`; the type checker enforces parity) and call `t('area.key')`. Never hardcode a sentence in the UI or in
  server responses. Logs and CLI output are plain English.
- **Comments** may be in Portuguese or English; keep them useful.
- **Tests** live next to the code (`*.test.ts`, Vitest). Pure logic should be testable in Node without a DOM.
- **Commits** follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`...), in English.
- **Database changes** are additive migrations in `server/db/migrations/` (never edit a migration that has shipped).
- **No private infrastructure details** in the repo: no hostnames, IPs, bucket names or keys of a real deployment.

## Adding a language

1. Add the locale to `SUPPORTED_LOCALES` and `LOCALE_NAMES` (`shared/branding.ts`, `shared/i18n/index.ts`).
2. Extend every `defineMessages(...)` call in `shared/i18n/messages/` with the new dictionary. The type checker and
   `shared/i18n/i18n.test.ts` tell you what is missing.
3. Translate `docs/` into `docs/<locale>/` if you can (optional).

## Pull requests

Keep them focused. Describe what changes and how to test it. CI runs typecheck, tests, the build and a Docker smoke
test; everything must be green.

By contributing you agree that your contributions are licensed under the MIT license.
