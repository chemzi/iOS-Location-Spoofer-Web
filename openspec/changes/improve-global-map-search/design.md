## Context

See proposal.md for motivation and specs/global-map-picker/spec.md for the behavior contract. Remote main is `e13c078451677ad42d3792eb6e23879ca6dfe4d3`; the local clean checkout is the previous implementation commit `f706dff` with the same delivered behavior. A fresh implementation branch must be created from current main and any intervening changes reconciled before writes. This planning session only adds OpenSpec artifacts/configuration.

Current Leaflet code is inline in public/index.html. `currentLayer` depends on AMAP_KEY. `doSearch` also branches on AMAP_KEY, independently of the selected map. All four existing layers and WGS/GCJ conversions can be reused. `/set` and `/loc.json` use SPOOFER_DATA; auth is handled by functions/_utils.js.

### Evidence (2026-11-01)

- Stable page returns 200 and still has key-dependent map/search defaults; no tileerror handling or persisted layer preference was found.
- One z=15 public landmark tile per provider/city was checked for Tokyo and New York: Amap returned HTTP 200, 179-byte solid-color PNGs; CARTO returned HTTP 200, 2,049-byte PNGs visibly marked `API KEY REQUIRED`. HTTP 200 is therefore insufficient evidence of a working map.
- A single targeted OSM standard tile of Shibuya returned 200/41,064 bytes and visibly identifiable streets. Existing Esri imagery returned 200/25,448 bytes and visible satellite imagery at the same point. No bulk or headless tile scanning was performed.
- Photon `Shibuya Tokyo` and `New York` returned correct international results. Raw `东京涩谷` returned no results; `涩谷` and `纽约` returned similarly named Chinese POIs. Thus a generic multilingual claim would be misleading; use small explicit aliases and visible country labels.
- Full live browser UI was NOT inspected: automatic approval rejected capturing the unrelated active Chrome page. This is a visual verification gap, not evidence that the live map UI works. Complete targeted UI inspection once the target page is available; avoid unrelated pages.
- ENGINEERING_STANDARD.md, existing OpenSpec specs, CONTEXT.md, and ADRs were absent. No application code was changed.

## Goals / Non-Goals

**Goals:** A usable international map/search path without new paid resources; deterministic country-labelled results for the small declared alias set; preserve the working device integration; make upstream outages understandable.

**Non-Goals:** General-purpose translation, worldwide exhaustive POI coverage, route planning, offline maps, a new frontend framework, self-hosted geocoding databases, paid-provider registration, tile scraping, repairing Shadowrocket/iOS compatibility, or automatic server-location changes while previewing.

## Decisions

### 1. Replace the broken keyless CARTO layer with OSM standard tiles

Keep the existing `osm` layer identity for compatibility, rename its visible label to 全球街道, and use `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. Use maxNativeZoom 19 and overzoom if existing UI allows zoom 20; let the browser obey caching headers and send normal origin Referer. Show linked OSM attribution outside the bottom drawer's covered area. Retain `esri`, `amap`, and `sat` and store only known layer identifiers in localStorage. Default new visitors to 全球街道. Amap remains an explicit domestic option; no automatic region heuristic changes a user's saved preference.

CARTO with a new key is a viable later alternative, but requires email/account coordination; it is not the default plan. OSM is suitable for this small personal interactive application but provides no SLA. Do not proxy/cache tiles on Cloudflare or prefetch geographic grids. Use a bounded tileerror status (after a failed load cycle) with manual layer switch rather than interpreting HTTP 200 or automatically bouncing among providers. Changing tile providers later remains localized to one provider configuration.

### 2. Separate search scope from map selection

Add a compact 全球/国内 control beside the existing search input, keeping the current visual style and mobile drawer layout. Default to 全球. Selection affects geocoding only. Persist explicit scope selection locally. Enter and the existing search button submit queries; do not add search-as-you-type in this change. Return at most six results with country/locality/provider, preserving history and coordinate direct entry. Selecting a result changes the preview only. Use a request sequence or cancellation so stale replies cannot replace the current results.

### 3. Reuse Photon for global geocoding, keep Amap for domestic queries

Photon is Apache-2.0, maintained, and built for OSM search; its public demo explicitly allows reasonable project usage but gives no availability guarantee. Default the global server to `https://photon.komoot.io`; allow an operator-configured GLOBAL_GEOCODER_BASE_URL for another compatible Photon instance. Do not accept an arbitrary upstream URL from the client. Use an identifiable User-Agent with the public project URL. No paid service or database deployment is required.

The existing Nominatim fallback was considered but is not adopted as a new generic search backend: public usage is tightly limited and disallows autocomplete and generic no-code/vibe-coding service offerings. Photon avoids introducing that dependency. No translation service is added. A small alias table maps exactly 东京 → Tokyo, 东京涩谷/涩谷 → Shibuya Tokyo, 纽约 → New York (trimming whitespace). The domestic scope does not apply these aliases. Other languages pass through and failure hints explain query alternatives. Expand the alias list only for a concrete user need.

### 4. Same-origin endpoint with existing authentication

Add `GET /search?q=...&scope=global|domestic&token=...` using authOk. Global calls Photon `/api/`; domestic calls the existing Amap inputtips service via AMAP_KEY. The application token is never forwarded upstream. Both adapters return `{results:[{id,name,label,country,locality,latitude,longitude,provider}],provider}`. WGS-84 is the adapter boundary; only convert Amap GCJ-02 results once. Existing UI projection helpers convert that canonical point to the active layer.

Use 8-second upstream timeout, no automatic retries, max six results and ordinary input validation. Distinguish 401 auth, 400 invalid scope/query, 429 throttled (include Retry-After), 502 upstream failure, 504 timeout, and 200 with empty results. Frontend always ends loading and preserves typed query/locked location.

For this one-person deployment, explicit submitted searches are spaced at least one second apart in the client; duplicate in-flight normalized queries are coalesced per Worker instance. Cache non-empty successful normalized query/scope results in SPOOFER_DATA under a separate `search-cache:` prefix for 24 hours. This is light load reduction, NOT a distributed global 1 request/second guarantee. Cache failure must not fail a successful lookup. Provider-defined 429 is respected without retry loops. Multi-user service/rate-limiter design is out of scope; revisit before expanding deployment.

### 5. Preserve coordinate and device contracts

Keep a single canonical WGS target. Reuse current longitude normalization and extract only the smallest shared browser helpers necessary to apply conversions consistently; audit favorite jumps, which currently treat Esri differently from other global paths. Test domestic conversion round trips and negative western longitudes. Do not change the WLOC scripts, sgmodule, existing KV `loc`/favorites keys, or Token semantics. Tile/search status never writes a target.

### 6. Verification and resource boundaries

Acceptance-critical path: a human-operated browser at 390px-class mobile layout searches 东京涩谷 (normalized to Shibuya Tokyo), sees Japanese street detail, selects a point, explicitly locks, and reads it back through loc.json. Implement this first. Use an isolated local/Pages-preview KV for save tests; verify that isolation before any write. Existing production KV and its locked point are read-only during testing. If preview KV or a browser is unavailable, record the missing real evidence; mocked/fixture checks cannot replace it. Before production deployment, preview checks and one independent final high-reasoning review must pass; do not deploy in this planning turn.

Then cover 纽约/New York, Beijing domestic search, global satellite, layer reload preference, coordinate direct entry, favorites, and the error/stale reply cases. Domestic round-trip tolerance is 2e-5 degrees, overseas 1e-5 degrees. Limit live geocoder probes to a few submitted queries, at most one per second. OSM visual checks are normal human viewport requests; do not implement headless bots panning/zooming OSM tiles. Automated tests use fixtures/stubbed tiles. Real iPhone Safari acceptance is reported separately if not available.

### Sources and alternatives checked

- Leaflet 1.9.4 API: https://leafletjs.com/reference.html
- CARTO current basemap key requirements: https://carto.com/basemaps
- OSM standard tile policy (visible attribution, Referer, browser caching, no bulk/offline): https://operations.osmfoundation.org/policies/tiles/
- Photon source/license/demo usage: https://github.com/komoot/photon
- Public Nominatim restrictions: https://operations.osmfoundation.org/policies/nominatim/

## Risks / Trade-offs

- [Public services can be blocked or unavailable on the user's network] → same-origin geocoding, direct browser tile caching, explicit errors/manual map switch; test on the user's network before acceptance. No claim of guaranteed global availability.
- [Chinese aliases are incomplete] → guarantee only the declared sample aliases, show country labels, offer English/local-script and direct-coordinate hints.
- [HTTP 200 may contain a provider placeholder] → correct the known CARTO source rather than promise a generic tile-image classifier; require human visual evidence.
- [Different map sources use different coordinate conventions] → canonical WGS-84 + bounded conversion tests; preserve explicit lock behavior.
- [Preview can accidentally share production KV] → verify bindings before save-path testing; use local storage/isolated preview binding when uncertain.

## Migration Plan

No data migration is required. Implement on a new branch from current main after proposal approval. Exercise the earliest real path with isolated storage, run checks and final independent review, create a reviewable PR, and deploy only within the user's deployment authorization. Revert that feature commit/PR to roll back; new local preference keys and prefixed short-lived search cache entries can remain harmlessly unused. No cleanup of production data is needed.

## Engineering standard draft for approval

The repository lacks ENGINEERING_STANDARD.md. Proposed minimal content to add during approved implementation (not yet committed as an engineering policy):

1. Keep this app on the existing Leaflet/static page + Pages Functions architecture; introduce no frontend build system for this change.
2. Use WGS-84 at API/storage boundaries and normalize longitude; GCJ-02 conversion belongs only at named map/provider boundaries.
3. Preview actions never write location; reuse authOk and keep application credentials out of third-party requests and logs.
4. External calls have bounded timeouts, clear empty/error states and provider-policy-compliant usage/caching.
5. Preserve public endpoint/device contracts; test changed seams and real browser behavior, documenting unavailable device checks.
6. Non-trivial changes require approved OpenSpec artifacts and one independent high-reasoning review; retain existing license and visible data attribution.

Approval of this plan should explicitly include or exclude submission of that minimal standard; its absence does not authorize unrelated standards cleanup.

## Review Evidence

User approval (2026-11-01): “可以 这么改试试 这主要是个前端任务 注意别搞坏后端”, followed by “可以按需使用Chrome”. The reviewed scope and minimal engineering-standard draft are approved for implementation. Existing backend location/favorites/WLOC contracts must remain unchanged. A fresh `feat/global-map-search` branch starts at current main `e13c078`; the old local implementation tree had only line-ending differences (`git diff --ignore-space-at-eol` empty) before switching. This approval does not by itself request production deployment.

Implementation environment: Wrangler 4.156.0, workerd compatibility 2026-10-30, local-only `http://127.0.0.1:8788`, `SPOOFER_DATA` explicitly shown as local with persistence at `work/preview-kv`; no remote bindings or production credentials. Existing `/`, `/verify`, `/loc.json`, `/favorites` return 200; local location is the default and favorites is empty. The sky window API failed identity checks, but Cua Driver's supported isolated Chrome route established exact binding and rendered the page; the initial browser screenshot visibly confirms CARTO key-required tiles. Physical iPhone testing remains unavailable.

2026-11-01: one fresh independent high-reasoning reviewer (`global_map_proposal_review`) read the complete proposal, spec, design, and tasks. Result: PASS for proposal submission; P0/P1 blockers 0, required P2 fixes 0.

- Requirements/scope/acceptance: consistent defaults, independent scope, declared aliases, canonical WGS-84, explicit persistence, and early real isolated save/readback path; no undeclared device/protocol scope.
- Engineering/feasibility/provider policy: existing Leaflet/Pages/auth helpers are sufficient; bounded adapters/caching match a personal deployment; OSM and Photon policies are represented accurately, without pretending client spacing is a distributed rate limiter.
- Functional/visual evidence: specific tile and geocoder results support the approach, but complete target-page screenshots, real isolated save/readback, user-network behavior, and physical iPhone Safari acceptance remain unavailable and must be recorded during implementation.
- No optional follow-up needs to expand this proposal. Review clearance allows user approval of the plan only; implementation has not started.

Strict OpenSpec validation passed before review. This review-evidence update changes no contracts and does not reopen proposal review.

Implementation evidence, tasks 1.3/1.4 (2026-11-01): global adapter fixture tests 6/6, inline script parsing, and longitude regression passed. Real isolated Chrome at local port 8788 displayed OSM street detail and searched 东京涩谷 into six results with 渋谷区 / 日本 / 東京都. Selecting the first result displayed NHK 放送センター and 宇田川町 at 35.6633709,139.6964952; explicit lock succeeded and /loc.json read back 35.6633709,139.69649519999996. No production data was written. Live geocoding count through this gate: 2/12 (one direct handler probe plus one browser submission). Browser screenshots were inspected in tool output; no separate screenshot file was retained. Broader/mobile/physical-iPhone evidence remains pending.

Implementation evidence, automated gates (2026-11-01): `node --test --test-isolation=none tests/*.test.mjs` passed 19/19, covering the actual adapter handlers and inline browser script with stub DOM/Leaflet/fetch/tiles. Coverage includes domestic coordinate conversion, auth before upstream/cache, aliases, timeout through response-body reading, empty/failure/429, 24-hour nonempty cache and coalescing, independent persisted scope/layer, stale response cancellation, request spacing, tile-cycle error/manual switching, exact canonical target preservation across 20 rounds of four-layer switches, Esri favorite jumps, direct coordinates, and explicit-lock-only writes. `node test-longitude-normalization.js`, changed JS syntax, inline script parsing, and `git -c core.whitespace=cr-at-eol diff --check` passed. There is no package manifest or configured full-suite/lint/typecheck command; these were not claimed. Strict `openspec validate improve-global-map-search --strict` passed. Existing save/read/favorites/auth/config and WLOC/script/module files have an empty diff against e13c078.

The broader real-browser environment runs at local port 8789 with separately persisted `work/preview-kv2` and Wrangler binding explicitly local. It reuses the existing app's Amap configuration in ignored `.dev.vars`; no Key value is recorded or committed and no production location/favorites are written. Port 8788 remains the isolated earliest-path evidence above.

Real browser verification, task 2.2 and partial 3.2 (2026-11-01): isolated Chrome at 8789, 500 CSS px viewport (native Chrome minimum), submitted 东京涩谷 and New York. Tokyo returned Japan/Tokyo results; New York returned United States/New York. New York OSM streets showed City Hall, Park Row and Brooklyn Bridge with visible OSM attribution. Explicit lock/readback gave latitude 40.7127281, longitude -74.00601519999998 (UI 40.7127,-74.0060). A local 纽约测试 favorite was created. Esri imagery showed identifiable buildings and attribution, preserving the target and persisted layer after reload. Global search scope remained independent of every layer change. At direct WGS preview 39.90872,116.39748, Amap streets showed 东长安街/天安门东/皇城艺术馆 and visible 高德 attribution; domestic satellite showed buildings plus 东长安街/皇史宬/皇城艺术馆. Both domestic layers preserved that canonical preview. Clicking the New York favorite on Esri jumped from Beijing back to 40.71273,-74.00602 and displayed locked status. A subsequent direct /loc.json read still returned the saved New York point, proving later coordinate previews/layer/favorite jumps had not saved Beijing.

Domestic real API evidence: the first local Worker Beijing lookup returned the designed 8-second 504 timeout; a single direct-provider comparison using the same existing Key succeeded (HTTP 200, status 1). Adding restapi.amap.com to NO_PROXY only in the local Wrangler child process made the real /search?scope=domestic&q=北京 return 200/provider amap, including 北京南站 / 中国 / 北京市丰台区 at WGS 39.863856084224,116.37229190795021 and 北京西站 at 39.893612651820256,116.3159143863044. No application code or production configuration changed. The isolated location remained New York. Cumulative live geocoding probes/submissions: 7/12; no automatic retries or bulk tile loading.

Independent final code review, task 3.3: reviewer global_map_final_review (high reasoning, independent of both implementation authors) reviewed the complete fixed-baseline e13c078 working-tree diff and untracked files, engineering standard and all approved OpenSpec artifacts, and independently reran 19/19 tests, longitude regression, strict validation and diff checks. Standards PASS; no P0/P1 or mandatory in-scope P2 code findings. Spec implementation has no identified blocker, but real acceptance remains partial. Review supports a draft, reviewable PR that explicitly retains missing evidence and does not claim production readiness. Later browser evidence above supplements this same review without changing any contract or code.

Remaining acceptance evidence: the automation driver could not change the native scope select through its bounded supported UI attempts, so actual browser domestic-scope selection and its changed-preference reload are unverified despite automated frontend tests and the real domestic API success. The narrowest native Chrome viewport tested was 500 CSS px; a single DevTools attempt for 390 px is pending. Physical iPhone Safari/device-location evidence is unavailable. Task 3.2 remains unchecked until those required browser checks are actually supported; task 4.2 awaits separate production merge/deployment authorization. No production data was used for save/favorite tests. No full acceptance or archive is claimed.

Delivery, task 4.1: feature commit b23615f is pushed on feat/global-map-search; draft PR https://github.com/chemzi/iOS-Location-Spoofer-Web/pull/3 targets main/e13c078. Provider/setup notes and actual verification gaps are included. This is a reviewable implementation delivery, not full acceptance or production deployment. Tasks 3.2 and 4.2 remain open; no archive is performed.

Browser verification stopped at the agreed bounds: one DevTools device-mode attempt did not establish a 390 CSS px viewport (narrow docked controls were cramped), so only the confirmed 500 CSS px viewport is accepted as evidence. No additional retries, searches or screenshots were requested. All inspected screenshots remain in the driver's inline output; no independent screenshot asset was exported. Final real gaps are native domestic-scope interaction/changed-preference reload, 390px layout and physical iPhone Safari/device positioning; four-provider map detail and Esri favorite jumps are verified above. Production acceptance remains conditional on task 4.2 authorization.

Same-review evidence supplement: the independent reviewer confirmed the added domestic-layer and Esri-favorite evidence, retained Standards PASS / no blocking code findings, and explicitly supported draft PR #3 with task 3.2 and task 4.2 open. OpenSpec verification: completeness is 10/12 tasks; all seven requirement implementations have code/test evidence, but the named real-UI/physical-device checks above remain unavailable. Correctness is supported by 19 automated cases, existing longitude regression and the bounded isolated real paths. Coherence follows the approved static Leaflet / Pages / existing auth and coordinate contracts. The change is not ready for archive or a full-acceptance claim.
