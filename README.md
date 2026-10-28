# Nginx Config Generator

A static web app for building Nginx reverse-proxy configuration: `conf.d` server configurations and `upstreams` groups. It checks them as you type and downloads them as a ZIP package that is ready for `nginx -t`.

Everything runs in the browser. There is no backend, no database, no build step and no network traffic. Projects are kept in the browser's local storage, and can be exported and imported as YAML.

- [What it generates](#what-it-generates)
- [Run it locally](#run-it-locally)
- [Using the app](#using-the-app)
- [Endpoint routing table (image and CSV)](#endpoint-routing-table-image-and-csv)
- [Validation](#validation)
- [Deploying a package to a server](#deploying-a-package-to-a-server)
- [YAML project files](#yaml-project-files)
- [Deploy the app to GitHub Pages](#deploy-the-app-to-github-pages)
- [Development and tests](#development-and-tests)
- [Security](#security)
- [Limitations](#limitations)

## What it generates

The output follows the layout of the reference Nginx configuration this tool was built from, with one upstream group per file and shared include files:

```text
nginx-config/                     (folder inside the ZIP, configurable)
├── conf.d/
│   ├── 00-shared.conf            rate limit zones + WebSocket map (only when used)
│   ├── external.conf             server configuration: one or more server blocks
│   ├── internal.conf
│   ├── visitor.conf
│   └── disabled/
│       └── legacy.conf           turned off: not matched by conf.d/*.conf
├── upstreams/
│   ├── external/
│   │   ├── portal.conf           upstream ext_portal { … }
│   │   └── v1/
│   │       └── visitor.conf      nested folders are kept
│   └── internal/
│       └── reports.conf
├── upstreams.conf                index: include /etc/nginx/upstreams/external/*.conf; …
├── proxy_params.conf             shared proxy headers, HTTP/1.1 keepalive, proxy_redirect off
├── ssl_params.conf               shared TLS protocols, ciphers, session cache
├── security_headers.conf         shared add_header … always (+ proxy_hide_header)
├── manifest.yml                  every file with size, SHA-256, what loads it
├── README.md                     installation, nginx -t and rollback steps for this package
├── routing-table.csv             every endpoint with upstream, backend hosts and ports, file, status
└── <project>.yml                 the project, importable again
```

The conventions taken from the reference configuration:

| Convention | Generated as |
|------------|--------------|
| Config root `/etc/nginx`; `nginx.conf` includes `upstreams.conf` and `conf.d/*.conf` in the http block | Settings: *Nginx configuration directory* and *Loaded by nginx.conf*; every file is checked to be loaded exactly once |
| One upstream group per file, grouped by category: `upstreams/external/<app>.conf` with `upstream ext_<app>` | New upstream groups default to `upstreams/<category>/`, and `ext_billing` suggests `billing.conf` |
| `upstreams.conf` includes each folder (`upstreams/external/*.conf`) | Generated index file; per-file includes optional |
| Backend nodes taken out of rotation are kept as `# server …;` | The *On* switch per backend server |
| `ip_hash`, `max_fails=2 fail_timeout=30s`, `keepalive 32;` after the servers | Load balancing, passive health checks and keepalive per group (keepalive 32 for new groups) |
| `disabled/` folders next to `conf.d/*.conf` and `upstreams/<category>/*.conf` | *Turned on* off writes the file to `<folder>/disabled/`, which the globs do not load |
| Catch-all blocks: `listen 8444 default_server; server_name _;` | Listeners with *default*, server name `_` |
| `# ── Pair A (11/12) ───` comments between location groups | *Group comment* per location |
| Per-location logs: `/var/log/nginx/<category>/<app>.access.log main;` and `_default.*.log` for the block | *Separate access and error log for each location* |
| `include /etc/nginx/proxy_params.conf;` in each location, `proxy_pass` last, `proxy_read_timeout 600s` where needed | *Include the shared proxy parameters* + per-location timeouts |
| `proxy_params.conf`: Host, X-Real-IP, X-Forwarded-For, X-Forwarded-Proto, `proxy_http_version 1.1`, `Connection ""`, timeouts left to locations, `proxy_redirect off` | Default content of the shared proxy parameters |
| HTTPS block with certificate paths, `include ssl_params.conf; include security_headers.conf;`, proxy headers, timeouts and buffers at server level | TLS section, shared TLS and security header files, *Proxy defaults for every location* |

The generated text uses the same formatting: 4-space indentation, aligned values (`access_log` / `error_log  ` / `include    `), and quoted `add_header` values.

## Run it locally

The app is plain HTML, CSS and ES modules. It needs to be served over HTTP, because browsers do not load modules from `file://`.

```bash
npm start
```

This runs `scripts/serve.mjs`, a dependency-free static server. Open <http://127.0.0.1:4320/>. The same server also answers under <http://127.0.0.1:4320/nginx-config-generator/>, the way GitHub Pages serves a project site, so subpath hosting can be checked locally. Any other static server works too, for example `python -m http.server`.

Node.js 22 or newer is needed for the dev server and the tests. The app itself runs in any current Chrome, Edge, Firefox or Safari.

## Using the app

| Term | Meaning |
|------|---------|
| **Project** | A named set of everything below, such as *Production Servers*, *DR Environment* or *Development Environment*. Create, open, rename, duplicate, reset and delete projects in the left sidebar. |
| **Server configuration** | One generated file (for example `conf.d/external.conf`) with one or more server blocks. |
| **Server block** | One `server { }`: listeners, server names, TLS, logging, proxy defaults, security, error pages and locations. |
| **Location** | One `location { }`: a proxy to an upstream group or a single backend, a redirect, static files, a health check, the stub status page, or custom directives. |
| **Upstream group** | One `upstream name { }` with its backend servers, in its own file. |
| **Generated file** | Output derived from the above. It is never edited directly. |

The layout:

- **Toolbar**: project name, validation status (click it for details), Import YAML, Export YAML, Download ZIP, and the preview toggle.
- **Left sidebar**: projects and the tree of generated files. The menu button hides it.
- **Tabs**: *Overview* (project details, summary table, every issue), *Servers*, *Upstreams*, *Generated files* (the exact package content), *Import / Export* (project YAML, endpoint routing table, ZIP) and *Settings*.
- **Right panel**: a live preview of the file you are editing. Focusing a field highlights the lines it produces. Drag the panel's edge to resize it.

Typical workflow:

1. Create a project, or open the sample project (it uses placeholder addresses only).
2. In **Upstreams**, add groups and their backend servers (address, port, weight, max_fails, fail_timeout, max_conns, backup, down, or commented out). Set the load-balancing method (round robin, least_conn, ip_hash, hash with a key, random) and keepalive.
3. In **Servers**, add a server configuration. Set its folder and file name, then its listeners (port, address, SSL, default_server), server names and locations.
4. Review the issues inline, in the preview and on the Overview tab.
5. **Download ZIP**, or download single files from the preview or the Generated files tab.
6. **Export YAML** to keep or share the project.

Features that need something outside the package are marked in the UI and listed in the package README:

| Feature | Needs |
|---------|-------|
| HTTPS | `ngx_http_ssl_module`, plus the certificate and key files on the server |
| HTTP/2 | `ngx_http_v2_module`. Written as `listen … http2` (any version) or `http2 on;` (1.25.1+, Settings) |
| Status page | `ngx_http_stub_status_module` |
| Access log format other than `combined` | `log_format <name>` in nginx.conf |
| Basic authentication | A password file created with `htpasswd` on the server |
| Ports below 1024 | Root, or `CAP_NET_BIND_SERVICE` on the nginx binary |
| Custom directives using Lua, njs, headers-more | Those modules (they are flagged) |
| Active health checks, `sticky`, `least_time` | NGINX Plus (not supported by open-source Nginx) |

## Endpoint routing table (image and CSV)

*Import / Export → Endpoint routing table* turns the project into one table of every endpoint. It shows the upstream group, the port on each backend host, the configuration file and the status. It is meant for handover documents, change tickets and spreadsheets. The preview on screen shows exactly what the image contains. A second layout turns the table around and lists the endpoints per backend worker — see *Group by backend worker* below.

```text
 Endpoint             Upstream / handled by   Balancing  │ 192.0.2.11  192.0.2.12  192.0.2.13  192.0.2.14 │ Notes      Status
 External  conf.d/external.conf · listen 8444 · any host name · External
 /catalog/            ext_catalog                        │ 9000        9000                               │            Active
 /billing/            ext_billing                        │ 9000 off    9000                               │            Active
 /billingKycShop/     ext_billingKycShop                 │                         9000        9000       │            Active
 Internal  conf.d/internal.conf · listen 8443 · any host name · Internal
 /billingJob/         int_billingJob                     │ 9005        9005 backup                        │ read 600s  Active
 = /healthz           health check (200 "ok")            │                                                │            Active
```

How it is laid out:

- **One column per backend host**, with the port in each cell, so you can see at a glance which nodes serve which application. Markers show `backup`, `down`, `off` (kept in the file as a comment, out of rotation) and weights (`w2`). A legend under the table explains only the markers that appear. Above 8 hosts, *Automatic* switches to one *Backend servers* column (`host:port, …`) so the table stays readable. Either layout can also be chosen explicitly, as can *Group by backend worker* below.
- **Rows are grouped by server block.** A band shows the file, the listen port, the server names and the category, so those values are not repeated on every row. Turn grouping off to get them as columns instead.
- **Columns that would be empty are left out.** These are *Balancing* (round robin is the default), *Backend path* and *Notes*.
- **Notes** list per-endpoint overrides: timeouts, body size, WebSocket, allowed methods, IP allowlists, passwords, rate limits, internal-only and HTTPS backends.
- **Status** comes from validation: *Active*, *Review* (warnings), *Error*, *Missing upstream*, *Upstream off*, *No backend* or *Disabled*. Upstream groups that no endpoint uses are listed under the table.
- Redirects, static files, health checks and the status page appear with what handles them. Choose *Proxy endpoints only* to leave them out.

### Group by backend worker

The *Group by backend worker* layout answers the other question: **what does one backend node run, and which applications does it serve?** Every distinct backend target (a host and a port) becomes one row — one worker — and the rows are grouped by host:

```text
 Worker   Port  Role    Upstream group            Count  Endpoints served   Served from  Status
 192.0.2.11  2 workers · 3 endpoints · ports 9000, 9005
 worker1  9000  off     ext_billing, ext_catalog  2      /billing/          External     Active
                                                         /catalog/                       Error
 worker2  9005          int_billingJob            1      /billingJob/       Internal     Review
 192.0.2.12  2 workers · 3 endpoints · ports 9000, 9005
 worker1  9000          ext_billing, ext_catalog  2      /billing/          External     Active
                                                         /catalog/                       Error
 worker2  9005  backup  int_billingJob            1      /billingJob/       Internal     Review
```

- **Endpoints served** lists every endpoint that reaches that worker, one per line, ordered by upstream group and then by path, with the count next to it. A worker that serves ten applications shows them all; beyond twelve the rest become `+N more`.
- **Status is per application, not per worker.** Each endpoint on the row gets its own pill on its own line, so one failing application never hides the others. The worker's own state is in *Role* (`backup`, `down`, `off`, weights) and in the CSV column *Worker state*.
- **Hosts are ordered numerically** (IPv4 first, then IPv6, host names and unix sockets), and each band gives the number of workers, the number of endpoints and the ports in use. Turn grouping off to get the host as a column instead.
- **Upstream group** names the groups the worker belongs to (`direct` for a `proxy_pass` straight to an address), and *Served from* the server configurations whose traffic reaches it.
- Endpoints without a backend server (static files, health checks, redirects) have no worker; they are counted in a footnote under the table.

#### Naming the workers

By default workers are numbered **by port across the whole project**, so port 9000 is `worker1` on every host and a name means the same thing everywhere. The *Port* column always shows the real port, so the numbering is never the only thing you go by.

| Option | What it does |
|--------|--------------|
| *Number workers: by port across the project* | Every port in use gets a number in ascending port order; the same port is the same worker on every host (default) |
| *Number workers: per host* | Each host starts again at its lowest port |
| *Start at worker0* | Zero-based names: `worker0`, `worker1`, … |
| *Worker names by port* | Your own name for single ports, one per line; ports that are not listed keep their number |

```text
9000 = worker0
4776 = worker1
5323 = worker2
```

Write `port = name`, `port: name` or `port name`; names are cut at 40 characters, and lines without a port are ignored. *Fill worker names* writes one line per port in use, numbered in port order, as a starting point to edit. The legend under the table names the ports you gave names to and how the rest were numbered.

#### What the colours mean

Under the table — in the preview and at the bottom of the image — a colour key explains the status pills. Only the colours the table actually uses appear:

```text
 [Active] green: in service   [Review] amber: works, but something needs checking
 [Error] red: not serving traffic   [Off] grey: turned off or out of rotation
```

A row is greyed only when nothing on it is in service, so a worker that is commented out keeps its colours while the applications it would serve still run on another host.

Exports:

| Action | Result |
|--------|--------|
| Download PNG | `<project>-routing-table.png`, drawn at 2× for sharp text, light document colours whatever the app theme |
| Copy image | the same PNG on the clipboard, ready to paste into a document, ticket or e-mail |
| Download CSV | `<project>-routing-table.csv`: one row per endpoint with every column (match type, environment, server configuration, listen, server names, upstream file, …), UTF-8 with BOM so Excel shows it correctly. In the worker layout: one row per worker (host, worker, port, role, upstream groups, endpoint count, endpoints served, the status of each endpoint, worker state) |
| Copy for Excel | the same rows as tab-separated text, to paste into a spreadsheet |

The CSV is also added to the ZIP package as `routing-table.csv` (*Add routing-table.csv to the ZIP package*). Cells that start with `=`, `+`, `-` or `@` are prefixed with `'`, so spreadsheets never run them as formulas.

## Validation

Every change is checked immediately.

- **Errors** block the ZIP and the download of the affected file: missing required fields, ports outside 1–65535, invalid IP addresses, hostnames, CIDR ranges and server names, duplicate upstream names (compared without case, like Nginx), duplicate or case-colliding output paths, path traversal, missing or turned-off upstream references, HTTPS without certificate paths, PEM or `data:` key material in fields, hash load balancing without a key, `backup` with `ip_hash`/`hash`/`random`, duplicate `default_server` or `server_name` on one address and port, SSL and plain HTTP on the same port, duplicate locations or listeners, a URI in `proxy_pass` inside a regex location, insecure TLS protocols, and files that `nginx.conf` would load twice. Custom directives are checked for syntax errors (missing `;`, unbalanced braces or quotes), for directives not allowed in their block (`listen` inside a location, for example), and for duplicates of single-use directives.
- **Warnings** need review but do not block: placeholder values (documentation IP ranges, example.com), certificates without an SSL listener, keepalive groups whose locations never reuse connections, trailing-slash mismatches between location and proxy path, `alias` path traversal, files that nginx.conf does not load, unknown or code-running custom directives, includes of files outside the package, and similar.
- **Notes** describe what the target server needs (modules, log formats, log folders, certificates).

The generator also handles one common Nginx pitfall automatically. `proxy_set_header`, `add_header` and `proxy_hide_header` are inherited all-or-nothing, so a location that sets one header silently loses every header from the server block. When that happens, the generator repeats the inherited directives in the location (or re-includes `security_headers.conf`), and says so in a comment.

**Passing these checks does not prove that Nginx will accept the configuration.** That depends on the Nginx version, its modules, `nginx.conf`, and the certificates, log folders and other files on the server. Always run `nginx -t` on the target server or an identical staging server.

## Deploying a package to a server

Each ZIP contains a `README.md` written for that package: the includes `nginx.conf` needs, certificate paths, the log folders to create, an exact `install` command for each file, and smoke tests with `curl`. In short:

```bash
unzip -o production-servers.zip -d /tmp/production-servers
sudo tar -czf /root/nginx-backup-$(date +%Y%m%d-%H%M%S).tar.gz -C /etc nginx
cd /tmp/production-servers/nginx-config
sudo install -D -m 644 conf.d/external.conf /etc/nginx/conf.d/external.conf   # one line per file, see the package README
sudo nginx -t
sudo systemctl reload nginx
```

If `nginx -t` fails, do not reload. Fix the project, download a new package, or restore the backup. If Nginx runs as a systemd user service under a dedicated account, run `nginx -t` and `systemctl --user reload nginx` as that account.

To test a package before it reaches a server, use a staging machine or container with the same Nginx version and modules. Install the files under the same directory, add the includes to its `nginx.conf`, put test certificates at the referenced paths (a self-signed pair is enough for `nginx -t`), and create the log folders. Hostnames used as backends must resolve there.

## YAML project files

Exported projects are versioned YAML documents (schema version 1). Import validates the structure first. Malformed YAML, wrong types, unsupported schema versions and unsafe keys are rejected with the path and line. You then see a review of what would be added, removed or changed, and can replace the current project or import it as a new one. Unknown fields are reported and ignored. Missing optional fields get their defaults, so files stay compatible as the schema grows. Older schema versions will be migrated on import.

```yaml
schemaVersion: 1
project:
  name: Production Servers
  description: Production Nginx configuration
  environment: production
settings:
  nginxRoot: /etc/nginx
  httpIncludes: [upstreams.conf, conf.d/*.conf]   # what nginx.conf loads in its http block
  nginxVersion: 1.24-or-older                      # or 1.25-or-newer (HTTP/2 syntax)
  serverDir: conf.d
  upstreamDir: upstreams
  disabledDirName: disabled
  upstreamIndex: { enabled: true, path: upstreams.conf, style: directories }
  sharedHttpPath: conf.d/00-shared.conf
  logRoot: /var/log/nginx
  logFormat: main
  proxyParams:     { path: proxy_params.conf, hostHeader: $host, realIp: true, forwardedFor: true, forwardedProto: true, httpVersion: '1.1', clearConnectionHeader: true, redirect: 'off' }
  sslParams:       { path: ssl_params.conf, protocols: [TLSv1.2, TLSv1.3], ciphers: '…', sessionCache: shared:SSL:20m, sessionTimeout: 10m, sessionTickets: 'off' }
  securityHeaders: { path: security_headers.conf, hideUpstreamHeaders: true, frameOptions: SAMEORIGIN, contentTypeOptions: true, hsts: true, hstsMaxAge: 31536000 }
  format:  { indent: 4, alignValues: true, headerComments: true }
  package: { rootFolder: nginx-config, includeDisabled: true, includeProjectFile: true, includeTable: true }
  table:   { layout: auto, groupRows: true, proxyOnly: false, includeDisabled: true,    # routing table: auto | matrix | list | worker
             workerNumbering: port, workerFromZero: false, workerNames: ['9000 = worker0'] }   # worker layout names: port | host
rateLimitZones:
  - { name: api, key: $binary_remote_addr, size: 10m, rate: 10r/s }
upstreams:
  - name: ext_app
    category: external
    enabled: true
    outputDir: upstreams/external
    fileName: app.conf
    method: least_conn            # round_robin | least_conn | ip_hash | hash | random
    keepalive: 32
    servers:
      - { address: 10.0.0.11, port: 9000, weight: 2, maxFails: 2, failTimeout: 30s }
      - { address: 10.0.0.12, port: 9000, backup: true }
      - { address: 10.0.0.13, port: 9000, enabled: false, comment: out of rotation }
servers:
  - name: External gateway
    category: external
    enabled: true
    outputDir: conf.d
    fileName: external.conf
    blocks:
      - listen: [{ port: 8444, defaultServer: true }]
        serverNames: [_]
        clientMaxBodySize: 100M
        logging: { perLocation: true }
        locations:
          - path: /app/
            group: Pair A
            type: proxy                # proxy | return | static | health | status | custom
            proxyPass: { target: upstream, upstream: ext_app, scheme: http }
            proxy: { includeParams: true, readTimeout: 600s }
```

Full field list:

| Object | Fields |
|--------|--------|
| upstream | `name`, `description`, `environment`, `category`, `enabled`, `outputDir`, `fileName`, `method`, `hashKey`, `hashConsistent`, `randomTwo`, `zoneSize`, `keepalive`, `keepaliveRequests`, `keepaliveTime`, `keepaliveTimeout`, `servers[]`, `customDirectives` |
| upstream server | `address` (IP, hostname or `unix:/path`), `port`, `weight`, `maxFails`, `failTimeout`, `maxConns`, `backup`, `down`, `enabled` (false = commented out), `comment` |
| server configuration | `name`, `description`, `environment`, `category`, `enabled`, `outputDir`, `fileName`, `httpDirectives` (http-level text at the top of the file), `blocks[]` |
| server block | `label`, `listen[]` (`address`, `port`, `ssl`, `defaultServer`), `serverNames[]`, `http2`, `tls` (`certificate`, `certificateKey`, `includeParams`), `redirectHttp` (`enabled`, `port`, `code`), `securityHeaders`, `clientMaxBodySize`, `sendTimeout`, `logging`, `proxy`, `responseHeaders[]`, `access`, `rateLimit`, `errorPages[]` (`codes`, `target`), `customDirectives`, `locations[]` |
| location | `name`, `group`, `match` (`prefix`, `exact`, `prefix_no_regex`, `regex`, `regex_ci`), `path`, `type`, `internal`, `proxyPass` (`target`: `upstream`/`direct`, `upstream`, `scheme`, `address`, `port`, `uri`), `return` (`code`, `value`), `static` (`root`, `alias`, `index`, `tryFiles`), `health` (`text`), `methods[]`, `clientMaxBodySize`, `sendTimeout`, `logging`, `proxy`, `responseHeaders[]`, `access`, `rateLimit`, `customDirectives`. Only the section for the location's type is saved. |
| logging | `accessLog`, `accessLogFormat`, `accessLogOff`, `errorLog`, `errorLogLevel` (+ `perLocation` on server blocks) |
| proxy | `includeParams`, `httpVersion`, `clearConnectionHeader`, `hostHeader`, `realIp`, `forwardedFor`, `forwardedProto`, `requestHeaders[]` (`name`, `value`), `connectTimeout`, `sendTimeout`, `readTimeout`, `buffering`, `requestBuffering`, `bufferSize`, `buffers`, `busyBuffersSize`, `redirect`, `hideHeaders[]`, `websocket`, `sslServerName` |
| access | `rules[]` (`action`: allow/deny, `source`), `basicAuthRealm`, `basicAuthUserFile` |
| rateLimit | `zone`, `burst`, `nodelay`, `status` |

The single source of truth for the schema is `js/core/schema.js`. Internal ids are never written to YAML; upstreams are referenced by name.

## Deploy the app to GitHub Pages

The app is static and uses only relative paths, so it works at `https://<user>.github.io/<repository>/` and on refresh (navigation uses the URL hash).

**Option A, deploy from a branch** (simplest):

1. Push the contents of this folder to a GitHub repository.
2. In the repository, open **Settings → Pages**. Set **Source** to *Deploy from a branch*, then choose `main` and `/ (root)`.
3. Open the URL GitHub shows after the first deployment.

`.nojekyll` makes GitHub serve the files as they are.

**Option B, deploy with GitHub Actions** (runs the tests first and publishes only the app files):

1. Push the repository, including `.github/workflows/pages.yml`.
2. Set **Settings → Pages → Source** to *GitHub Actions*.
3. Every push to `main` runs `npm test` and deploys. Pull requests only run the tests.

No secrets or configuration are needed. The page sets a strict Content Security Policy (scripts and styles from the site only, `connect-src 'none'`).

## Development and tests

```bash
npm test               # 87 tests, no npm install needed (the vendored libraries are used directly)
npm run fixtures       # regenerate tests/fixtures/sample after an intended output change
npm run vendor:check   # verify the vendored libraries against vendor/checksums.json
```

The tests cover generation (upstreams, every load-balancing method, servers, TLS, HTTP/2 syntaxes, redirects, locations of every type, proxy settings and header inheritance, custom directives, multiple blocks, nested paths, disabled files), validation (every error class above), YAML round-trips and malformed or hostile input, ZIP structure and manifest checksums, the routing table (layouts including the worker grouping and its naming options, markers, per-endpoint status, CSV quoting and formula protection), project storage, golden files for the sample project, and static-hosting compatibility (relative imports, CSP, no network or dynamic code, subpath serving).

Project structure:

```text
index.html, favicon.svg, css/app.css
js/main.js                  entry point
js/theme-init.js            applies the saved theme before the page draws
js/core/                    no DOM access; runs in Node for tests
  schema.js                 data model + YAML schema v1 (defaults, type checks, compact export)
  model.js                  factories and entity helpers (rename, duplicate, paths)
  generate.js               project → configuration tree → text
  ast.js, syntax.js         configuration tree/serializer; tokenizer, parser, highlighter
  analyze.js, directives.js block-level checks against a catalog of Nginx directives
  validate.js, build.js     validation rules; generation + validation + issue-to-line mapping
  yaml-io.js, package.js    YAML import/export; manifest, README, ZIP
  table.js                  endpoint routing table model, CSV/TSV
  diff.js, sample.js, net.js, paths.js, formats.js, util.js, version.js
js/ui/                      DOM: app controller, form fields, dialogs, code view, tree, store, table image (canvas)
js/ui/views/                toolbar, sidebar, preview and the six tabs
vendor/                     js-yaml 4.1.1 and fflate 0.8.2 (pinned, with licenses and checksums)
tests/                      node:test suites and golden files
scripts/                    dev server, vendor check/copy, fixture update
```

## Security

- All processing happens locally. The app makes no network requests, and the CSP forbids them.
- Imported YAML is treated as data. It is size-limited and parsed with js-yaml's safe default schema (no executable tags), with a budget against alias bombs. Only known fields are copied into new objects, and `__proto__`, `constructor` and `prototype` keys are rejected.
- Nothing is rendered as HTML. All text, including file previews and syntax highlighting, is inserted as text nodes.
- Every value written into a configuration is checked or quoted, and single-line fields reject line breaks, so no field can inject extra directives. Custom directives are parsed and checked per block, and flagged as advanced input.
- Output paths are validated (no `..`, no absolute paths, no reserved or case-colliding names). The ZIP writer checks them again.
- Packages never contain certificates, private keys, passwords or application files. Fields that look like PEM content or `data:` keys are rejected.
- Projects stay in this browser's local storage. Clearing site data removes them, so export important projects as YAML.

## Limitations

- Not a full Nginx parser or validator. Directive values inside custom directives are not checked, and only `nginx -t` on the target server is authoritative.
- The generator does not write `nginx.conf` itself. It writes what `nginx.conf` includes, and checks that against the include patterns you enter.
- Upstream groups are written one per file. Defining several upstreams in one file, or inside a server configuration file, is possible only through custom directives.
- A direct backend is a single server. Several backends need an upstream group.
- `stream` (TCP/UDP) proxying, mail, FastCGI/uWSGI/gRPC templates, caching and NGINX Plus features (active health checks, sticky sessions, `least_time`) are not modelled. Use custom directives where Nginx allows them.
- The upstream index with folder includes loads every `.conf` already in those folders on the server, as the reference layout does. Use per-file includes in Settings to load only the generated files.
- Projects are stored per browser. There is no sync between machines; use YAML export and import.
