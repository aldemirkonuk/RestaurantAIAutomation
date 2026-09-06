# @wineops/api-gateway

NestJS API gateway. Routes are served under the `api/v1` global prefix; Swagger
UI is served by the running app at `/api/docs`.

## The OpenAPI spec

`openapi.json` is **generated, gitignored, and never committed** — ADR 0123
(`.planning/decisions/0123-the-openapi-export-is-a-command-not-a-commit.md`),
closing OD-89. Nothing in this repository reads it: it is a convenience for
client generation and for diffing two revisions of the API by hand.

Booting the gateway does **not** write it. Export it deliberately:

```bash
pnpm --filter @wineops/api-gateway openapi:export   # writes apps/api-gateway/openapi.json
```

The script sets `EXPORT_OPENAPI=1`. That flag is the only thing that authorises
a write, on both the boot path (`src/main.ts`) and the export script
(`src/openapi.ts`); running either without it writes nothing and says so. The
gate itself lives in `src/openapi-export.ts` and is covered by
`src/openapi-export.spec.ts`.

To read the spec without writing a file, start the gateway and open
`/api/docs`.
