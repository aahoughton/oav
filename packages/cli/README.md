# @oav/cli

The `oav` command-line tool.

## Install

```bash
pnpm install --filter @oav/cli
pnpm --filter @oav/cli build
```

## Commands

```bash
oav resolve <spec>                                           # stitch a multi-file spec
oav resolve <spec> --overlay overlay1.json --overlay overlay2.json
oav validate <spec> --request req.http                       # full HTTP request
oav validate <spec> --path "POST /pets" --body body.json     # request body
oav validate <spec> --path "GET /pets" --response --status 200 --body resp.json
```

Stdin: pass `-` as the file path (e.g. `--body -`).

## Flags

- `--format text|json|flat|github` — default `text`.
- `--depth <n>` — truncate error tree depth (text format).
- `--overlay <file>` — repeatable; applies overlays in order.
- `-o <file>` — write output to a file instead of stdout.
- `--quiet` — exit code only, no stdout.

## Exit codes

| Code | Meaning               |
| ---- | --------------------- |
| 0    | valid                 |
| 1    | validation errors     |
| 2    | spec resolution error |
| 3    | input / usage error   |

## `.http` file format

```
POST /pets?limit=10 HTTP/1.1
Content-Type: application/json
X-Tenant-Id: abc-123

{"name": "Fido", "species": "dog"}
```

Blank line separates headers from body. CRLF and LF both work.
