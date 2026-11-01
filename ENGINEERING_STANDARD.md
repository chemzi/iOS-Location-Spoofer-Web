# Engineering Standard

1. Keep the existing Leaflet/static page and Cloudflare Pages Functions architecture. Do not add a frontend build system for a scoped UI change.
2. Use WGS-84 at API/storage boundaries and normalize longitude to [-180, 180). Apply GCJ-02 conversion only at named map/provider boundaries.
3. Search, layer switching, and preview actions must not save location. Reuse the existing authentication helpers and keep application credentials out of third-party requests and logs.
4. Bound external calls with timeouts, distinguish empty/error states, and follow provider attribution, caching, and usage policies.
5. Preserve existing location, favorites, and device contracts. Test changed seams and the real browser path; explicitly report unavailable device checks.
6. Non-trivial changes require approved OpenSpec artifacts and an independent high-reasoning review. Preserve existing license notices and visible data attribution.
