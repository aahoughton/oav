# oav (CLI)

The `oav` binary — a thin wrapper around `@aahoughton/oav` for shell
scripts, Makefiles, and CI.

## Install

```bash
# global install
npm install -g @aahoughton/oav
oav --help

# one-off via npx
npx @aahoughton/oav validate openapi.yaml --request req.http
```

## Commands

```bash
oav resolve <spec>                                           # stitch a multi-file spec
oav resolve <spec> --overlay overlay1.json --overlay overlay2.json

oav validate <spec> --request req.http                       # full HTTP request from a .http file
oav validate <spec> --path "POST /pets" --body body.json     # request body for a known route
oav validate <spec> --path "GET /pets" --response --status 200 --body resp.json
```

Pass `-` as the file path to read from stdin (e.g. `--body -`).

## Flags

| Flag                              | Meaning                                          |
| --------------------------------- | ------------------------------------------------ |
| `--format text\|json\|flat\|github` | Error rendering. Default `text`.                 |
| `--depth <n>`                     | Truncate error tree depth (text format).         |
| `--overlay <file>`                | Repeatable; applies overlays in order.           |
| `-o <file>`                       | Write output to a file instead of stdout.        |
| `--quiet`                         | Exit code only, no stdout.                       |

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

A blank line separates headers from body. CRLF and LF both work.
