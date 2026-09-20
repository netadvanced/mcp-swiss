# Changelog

All notable changes to `mcp-swiss-ng` (and, before the fork, `mcp-swiss`) are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [Unreleased]

### Fixed
- `get_dams_by_canton` and `list_postcodes_in_canton` filtered by the canton's bounding box, so they returned places from neighbouring cantons under the wrong canton label. Lucerne, for instance, listed six dams, none of them in LU. Both now use a real canton attribute: dams are checked against the swissboundaries3d canton polygons, postcodes come from the canton column of the official locality register (AMTOVZ). Postcodes that only reach into a canton are listed separately with their main canton and address share, and dams on the German border are flagged.
- `search_dams` always reported `canton: null`: it asked the layer for results without geometry, and the canton lookup used LV03 coordinates against an LV95 service. Both fixed; `get_dam_details` was affected by the second one too.
- `get_property_price_index` served a hand-written table as official BFS values. The numbers rose every single quarter, houses and apartments sat at a near-constant offset from the total, and the series claimed to start in 2009. The real IMPI starts in 2017-Q1. The tool now fetches the published series (order number `ds-x-05.06.03.01.02` on the BFS asset API), caches it in-process, and reports the "data as of" date and the file it came from.

## [0.9.0] - 2026-09-19

First release of the **mcp-swiss-ng** fork of [vikramgorla/mcp-swiss](https://github.com/vikramgorla/mcp-swiss), rebased on upstream `develop` (v0.8.0: pollen module, snow fixes, dependency updates through 2026-09-14).

### Added

**Streamable HTTP transport** (upstream #64) — `--http` / `MCP_TRANSPORT=http`
- `POST/GET/DELETE /mcp` with per-session servers, `GET /health`, 30-min idle session expiry
- Optional bearer auth (`MCP_AUTH_TOKEN`), Host allow-list / DNS-rebinding protection (`MCP_ALLOWED_HOSTS`, on by default for loopback binds), CORS (`MCP_CORS_ORIGIN`)
- `docker-compose.example.yml`; container exposes port 3000, runs as non-root

**Discovery mode** (upstream #106) — `--discovery` / `MCP_SWISS_DISCOVERY=1`
- Starts with `swiss_discover` (module catalog / load modules, emits `tools/list_changed`) and `swiss_call` (fallback for clients that don't refresh tool lists)

**Tool annotations** — every tool is marked `readOnlyHint`, `idempotentHint`, `openWorldHint`, not destructive

**GWR module** (3 tools) — Federal Register of Buildings and Dwellings (BFS), via [api3.geo.admin.ch](https://api3.geo.admin.ch) layer `ch.bfs.gebaeude_wohnungs_register` (closes #142)
- `search_buildings` — find buildings by address → EGID, address, coordinates, category, class, construction year, floors, dwellings
- `get_building` — full decoded record by EGID: category/class/status, construction year/period, floors, areas, heating & hot-water systems, parcel/EGRID, entrances and dwellings (EWID, floor, rooms, area)
- `buildings_near` — buildings around a WGS84 point within a small radius, closest first
- GWR code lists (GKAT, GKLAS, GSTAT, GBAUP, GENH/GENW, GWAERZH/GWAERZW, WSTAT, WSTWK) decoded to English labels
- Added to the `business` preset

### Changed
- Package renamed `mcp-swiss-ng` (bin `mcp-swiss-ng`); not on npm yet — install with `npx -y github:netadvanced/mcp-swiss-ng` or `ghcr.io/netadvanced/mcp-swiss-ng`
- Node.js 22+ required (Node 20 is EOL); CI on 22/24, Docker `node:24-alpine`
- All outbound requests share one client: `mcp-swiss-ng/<version>` User-Agent and a 30 s timeout (`MCP_SWISS_TIMEOUT_MS`; 120 s for the slow BFS PxWeb API); several modules previously had no timeout
- Server reports the real package version (was hard-coded `0.5.8`)
- Tool schemas trimmed 33% (≈9.7k → 6.5k tokens per conversation; upstream #107). `enum`/`default` used where the handler enforces them. Transport `x`/`y` were documented the wrong way round (x is latitude). `npm run docs:tools` regenerates `docs/tools.schema.json` and the manifest tool list; CI checks they are in sync
- `outdoor` preset includes `pollen`; `--list-modules` shows module descriptions
- `src/index.ts` split into `registry`, `config`, `server`, `http-server`; importing modules no longer starts a server
- vitest 5, eslint 10.11, GitHub Actions v7; TypeScript stays on 6.x until typescript-eslint supports 7

### Security
- HTTP mode refuses to start on a non-loopback address unless both `MCP_AUTH_TOKEN` and `MCP_ALLOWED_HOSTS` are set. Without them the SDK's DNS-rebinding protection is off and the server is an open proxy onto the upstream APIs
- Concurrent sessions are capped (`MCP_MAX_SESSIONS`, default 64) and answered with `429` + `Retry-After` beyond it. Previously each `initialize` allocated a server with no limit (~294 MB for 3000 sessions, held for the 30-minute idle window)
- Request bodies over 1 MB return `413`; other internal errors return a generic `500` instead of the exception message
- `/health` reports the session count only on a loopback bind
- Search terms are escaped before going into Basel-Stadt ODSQL filters (`voting`); a quote used to break the query or widen the filter
- SECURITY.md described a stdio-only tool that opens no port

### Fixed
- `get_weather_history` and `get_water_history` sent `startdt`/`enddt`, which api.existenz.ch ignores: every call returned the last 24 hours labelled as the requested period. They now send `startdate`/`enddate`, and say so when a range falls outside the ~32-day archive
- `get_traffic_nearby` and `get_trail_closures_nearby` passed the radius in metres as a pixel tolerance on a 1x1 px map, so a few kilometres matched the whole country (1 km around Lausanne returned 201 stations from 24 cantons). Both now query an LV95 box, filter on real distance and report `distance_m`, nearest first
- `reverse_geocode` always returned zero results: swisstopo's SearchServer has no reverse lookup. It now resolves the nearest address from the building register plus the containing municipality, canton and BFS number
- ZEFIX `search_companies` sent the canton as `cantonAbbreviation` and the legal form as `legalFormCode`; the search endpoint knows neither field and quietly returned unfiltered results. It now resolves the canton to its registry-office ids (`registryOffices`) and the legal form to its numeric id (`legalForms`), and rejects values it cannot resolve
- `list_legal_forms` returned invented `0101`-style codes that `search_companies` never accepted. It now returns the live ZEFIX list (`legalForm.json`) with the ids the search really filters on — `3` = AG, `4` = GmbH
- `search_companies_by_address` sent the address as the company name, so it was a name search wearing an address label. ZEFIX has no street-address search at all, so the tool is now `search_companies_by_locality`: it resolves a commune or town (accent-insensitive, alternate names included) to legal-seat ids. A street address is rejected with an error that explains why
- `get_company` interpolated `ehraid` straight into the URL path; it is now checked for digits only
- `get_company` returned the whole SOGC journal (60 KB for Migros alone); capped at the 10 newest entries plus a `shabPubTotal` count. Search results are slimmed and carry the canton and legal-form label
- Sessions with an open event stream are no longer closed by the idle sweeper
- `search_places` advertised `type: "featuresearch"`, which always returned HTTP 400 because the tool sends no layer; the parameter is gone
- User-Agent and the existenz.ch `app` parameter still said `mcp-swiss`
- VS Code one-click install buttons still installed upstream's npm package
- `energy` worked out the current year once at startup, so a long-running server kept using last year's tariffs
- The release workflow ran the develop version bump in the same job as the release, so a bump failure skipped the Docker image and the .mcpb bundle
- Build broken on upstream `develop` since the TypeScript 6 bump (`types: ["node"]` missing from tsconfig)
- `get_snow_measurements` for study plots returns an empty result with an explanation off-season instead of an HTTP 404 error
- `energy` tools defaulted to tariff year 2026 forever; now the current year
- Pollen integration test assumed 16 stations (MeteoSwiss now runs 15)
- 9 npm audit findings (0 remaining)

---

## [0.1.0] - 2026-03-07

### Added

**Core**
- MCP server on stdio transport — `npx mcp-swiss` works out of the box
- TypeScript strict, Node.js 18+ compatible
- Zero dependencies beyond `@modelcontextprotocol/sdk` and native `fetch`

**Transport module** (5 tools) — [transport.opendata.ch](https://transport.opendata.ch)
- `search_stations` — find stations/stops by name or coordinates
- `get_connections` — journey planner between any two points
- `get_departures` — live departures from a station
- `get_arrivals` — live arrivals at a station
- `get_nearby_stations` — stations near given coordinates

**Weather & Hydrology module** (6 tools) — [api.existenz.ch](https://api.existenz.ch)
- `get_weather` — current conditions at a MeteoSwiss station
- `list_weather_stations` — all ~160 MeteoSwiss stations with full metadata
- `get_weather_history` — historical weather data (up to 32 days)
- `get_water_level` — river/lake level + temperature (BAFU stations)
- `list_hydro_stations` — all 400+ BAFU hydrological monitoring stations
- `get_water_history` — historical hydrology data

**Geodata module** (6 tools) — [api3.geo.admin.ch](https://api3.geo.admin.ch) (swisstopo)
- `geocode` — Swiss address or place name → coordinates
- `reverse_geocode` — coordinates → Swiss address
- `search_places` — Swiss place names, mountains, lakes, geographic features
- `get_solar_potential` — rooftop solar irradiation at a location
- `identify_location` — all geographic data layers at a point (200+ layers)
- `get_municipality` — municipality info by name

**Companies module** (5 tools) — [zefix.admin.ch](https://www.zefix.admin.ch)
- `search_companies` — search ZEFIX registry by name, canton, legal form
- `get_company` — full company details by ZEFIX internal ID (ehraid)
- `search_companies_by_address` — companies registered at an address
- `list_cantons` — all 26 Swiss cantons with codes
- `list_legal_forms` — AG, GmbH, and all Swiss legal forms

**Testing**
- Vitest framework with 104 unit + MCP protocol tests (run in ~9s)
- 27 integration tests against live Swiss APIs
- MCP protocol conformance test (12 assertions on tools/list + tools/call)
- Fixtures for all 4 modules

**Open-source infrastructure**
- Speckit spec-driven development structure (`specs/`, `.specify/`)
  - `specs/000-project-overview/` — project constitution
  - `specs/001-transport-module/` — spec + plan + tasks
  - `specs/002-weather-module/` — spec + plan + tasks
  - `specs/003-geodata-module/` — spec + plan + tasks
  - `specs/004-companies-module/` — spec + plan + tasks
- Tool specifications: `docs/tool-specs.md` + `docs/tools.schema.json`
- CI: Node 18/20/22 matrix, lint, unit tests, integration tests, security audit
- Release workflow: tag → GitHub release with auto-generated notes
- Issue templates (bug report + feature request — YAML forms)
- PR template with module checklist
- `CONTRIBUTING.md` — spec-driven workflow, testing requirements, code style
- `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`
- `CODEOWNERS`, `FUNDING.yml`
- ESLint with TypeScript strict rules (`npm run lint`)
- `npm run validate` — lint + build + test in one command
- `VERSIONING.md` — SemVer policy, branch strategy, conventional commits
- `CHANGELOG.md` — this file

### Fixed
- ZEFIX `get_company`: uses internal `ehraid` integer ID (CHE UID format returns 400)
- ZEFIX `search_companies`: handles 404 response for no-results gracefully
- ZEFIX `list_cantons` / `list_legal_forms`: endpoints return 403 — replaced with authoritative hardcoded data
- Weather API: corrected endpoints (`livedata` → `latest`, `pop` → `daterange`)
- Weather API: corrected parameter name (`stations` → `locations`)
- Geodata identify: corrected path to `/all/MapServer/identify` with WGS84 coordinates directly
- ESLint config: renamed to `.mjs` extension (ESM import requires explicit module type)

[Unreleased]: https://github.com/vikramgorla/mcp-swiss/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vikramgorla/mcp-swiss/releases/tag/v0.1.0
