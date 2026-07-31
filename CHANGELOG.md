# Changelog

All notable changes to the n8n-nodes-quickemailverification package will be documented in this file.

## [1.2.7] - 2026-07-31

### Fixed
- Removed the `keyv` and `keyv-file` runtime dependencies entirely (#4). When this node is installed alongside other community nodes in n8n's shared `node_modules` tree (the real-world "Update from UI" path, not an isolated `npm install`), npm's resolver was nesting a `keyv` copy under this package with a mismatched file layout (v4's `src/index.js` vs v5's `dist/index.js`), so the node failed to load with `ENOENT ... node_modules/keyv/src/index.js` and the update never completed. The address/domain caches are now backed by a small in-repo, zero-dependency file-backed TTL cache (sync `fs` + JSON), which has no external package to collide on. Cache semantics (TTL, version-based invalidation, disable/cleanup) are unchanged; expired entries are now pruned on every write (keyv-file did the same), so the cache file no longer grows unbounded.
- As a side effect of dropping Keyv, the init-promise/race-tracking machinery from #2/#3 is gone — the new cache's reads/writes are synchronous, so there's no async window for concurrent calls to interleave in the first place.

## [1.2.6] - 2026-07-30

### Fixed
- Bumped `keyv` from `^4.5.3` to `^5.6.0` to align with `keyv-file`'s v5-family `@keyv/serialize` dependency, removing an internal keyv v4/v5 version mismatch in this package's own dependency tree (#2). No API changes needed — `get`/`set`/`clear`/`on`/`opts.ttl` surface is unchanged between keyv v4 and v5.
- Fixed `getNodeVersion()` resolving the wrong path for `package.json` (was reading `dist/package.json`, which never exists), which silently broke cache-version invalidation on every upgrade since it was introduced in 1.2.3. Cache-version checking now actually runs; as a one-time side effect, address and domain caches will be cleared on first use after this upgrade. Also gave the internal version marker an explicit `ttl: 0` (no expiry) so it can't itself expire and trigger a periodic full cache wipe.
- `getAddressCache()`/`getDomainAcceptAllCache()` now await cache-version initialisation before returning, instead of firing it off in the background. Previously `execute()` could read/write cache entries while the version check and clear were still in flight, letting a stale entry slip through on the first run right after an upgrade.
- That await only protected the call that created the cache instance — a concurrent second call with the same TTL saw the cache already assigned and returned immediately without waiting for the first call's version check to finish. Both getters now track their in-flight initialisation in a shared promise so every caller, not just the one that created the instance, waits for it.
- `execute()` awaited the returned cache instance from the getters but then discarded it, reading/writing via the static field for the rest of the run. A concurrent execution with a different TTL could reassign that static field mid-run, so a still-in-progress execution could end up reading/writing an unrelated cache instance instead of the one it was just handed. `execute()` now uses the instance the getter actually returned for every cache access in that run.
- The internal version marker was stored under the same key namespace as user-supplied cache entries. Since the email parameter has no format validation, an email like `x@__cache_version__` made the domain-cache key collide with the marker, returning it as a malformed cached result and skipping API verification entirely. The marker now lives in its own Keyv namespace on the same underlying store, which cannot collide with any user-derived key.

### Note
- Different credentials on this node share the same on-disk address/domain cache files, and can legitimately race each other's reads/writes/cleanup (e.g. one credential disabling caching while another has it enabled). This is intentional — credentials are expected to enrich the same shared cache — so it is not treated as a bug.

## [1.2.5] - 2026-07-10

### Changed
- Aligned `peerDependencies.n8n-workflow` to `"*"` for consistency with other n8n community node packages (no behaviour change)

## [1.2.3-1.2.4] - 2025-04-29
- Fixed domain cache to only store results for domains with accept_all=true (handles API returning string/boolean)
- Implemented cache versioning: cache is now invalidated automatically if node version changes, using a special __cache_version__ key in the cache content
- Old cache files are automatically cleared of stale data on first use after upgrade; no new files are created
- Improved cache safety and upgrade experience; no risk of using stale or incompatible cache after node update

## [1.2.2] - 2025-04-27

### Changed
- Added support for usableAsTool

## [1.2.1] - 2025-04-21

### Changed
- Aligned package general content such as README and documentation

## [1.2.0] - 2025-03-18

### Security

- Replaced vulnerable `request` and `request-promise-native` packages with `axios`
- Fixed SSRF vulnerability (CVE-2023-28155) by upgrading HTTP client

## [1.1.0] - 2025-02-26

### Changed

- Improved caching terminology for clarity:
  - Renamed caching references to "per-address caching" in the UI and code
  - Replaced the `cached` boolean field with a `source` string field that indicates where the result came from: "api", "addressCache", or "domainCache"
  - Updated file paths and variable names to reflect per-address caching
  - Improved error messages and log messages to be more specific
- Domain-level caching for mail servers that accept all addresses
  - Cache verification results for domains with `accept_all=true`
  - Configuration options for domain cache behavior
  - Significantly reduces API calls for emails from domains that accept all addresses
- Added retry mechanism for greylisted emails
  - Optional toggle to enable retries for temporarily blocked emails
  - Configurable delay before first retry attempt (default: 90 seconds)
  - Configurable maximum number of retry attempts (default: 1)
  - Additional `retryInfo` metadata in API response when retries are performed
  - Allows handling emails from servers that implement greylisting policies

### Fixed

- Improved clarity in API response by making it more explicit when data comes from the cache

## [1.0.0] - Initial Release

### Added

- Initial implementation of QuickEmailVerification node
- Support for verifying email addresses via the QuickEmailVerification API
- Basic caching of email verification results 
