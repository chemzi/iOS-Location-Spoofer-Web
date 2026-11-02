## 1. Approved baseline and smallest real path

- [x] 1.1 Obtain approval for this complete proposal and the engineering-standard draft; reconcile current main/local changes, create a feature branch from the approved baseline, and add the approved ENGINEERING_STANDARD.md without changing unrelated policy.
- [x] 1.2 Verify a local or preview deployment uses isolated KV, and establish a target-site browser session; record unavailable real visual/device evidence. Production loc/favorites remain read-only during tests.
- [x] 1.3 Implement the global street tile replacement and the global `/search` adapter with auth, common aliases, normalized results, 8-second timeout, no retries, and basic loading/results UI; preserve the existing lock/read interfaces.
- [x] 1.4 Immediately verify the real isolated path: submit 东京涩谷 → country-labelled Japanese results → visible street map → select point → explicit lock → loc.json readback. Record selected and read-back coordinates; fixture success alone does not satisfy this task.

## 2. Complete map and search behavior

- [x] 2.1 Complete independent 全球/国内 search selection, Amap adapter to WGS-84, Chinese alias hints, stale-request handling, empty/error/throttle states, 24-hour prefixed query cache and modest request coalescing/spacing.
- [x] 2.2 Add persisted layer/scope preferences, visible attribution, tile-error/manual-switch feedback, and verify global satellite and domestic layers; retain the existing mobile layout style.
- [x] 2.3 Unify coordinate projection for result/favorite jumps, map switching and direct entry; confirm these previews do not write loc/favorites and negative longitude normalization remains intact.

## 3. Verification and review

- [x] 3.1 Run targeted automated checks for adapter coordinates, aliases, auth, timeout/empty/upstream-429, cache behavior, stale replies and canonical-coordinate invariants, using fixtures/stubbed tiles. Run the existing longitude regression and changed-file syntax/diff checks. Record absence of a full test/lint/type setup rather than claiming it ran.
- [ ] 3.2 Perform bounded real human-browser checks for 东京涩谷/Shibuya Tokyo, 纽约/New York, Beijing domestic search, layer reload/switch, favorites and a mobile-width layout; confirm identifiable map detail and isolated save/readback. Use at most 12 live geocoding requests per verification run at >=1-second intervals and no OSM tile grids, prefetches, or headless panning. Report physical iPhone Safari evidence separately.
- [x] 3.3 Run strict OpenSpec validation and one independent high-reasoning final review against specs, standards, functional evidence and visual evidence; fix only acceptance blockers/regressions and recheck affected paths.

## 4. Delivery

- [x] 4.1 Update user-facing provider/setup notes, including public-service limits, global query language hints and no new Shadowrocket setup; publish a reviewable feature PR with actual verification and remaining device/network gaps.
- [x] 4.2 When authorized to deploy, merge the approved PR, verify Cloudflare Pages and stable-site assets, and report production acceptance separately from unavailable physical-device checks. Preserve a concrete revert path; do not delete production data or caches.
