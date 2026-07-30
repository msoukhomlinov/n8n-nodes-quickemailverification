# Changelog

All notable changes to the n8n-nodes-quickemailverification package will be documented in this file.

## [1.2.6] - 2026-07-30

### Fixed
- Bumped `keyv` from `^4.5.3` to `^5.6.0` to align with `keyv-file`'s v5-family `@keyv/serialize` dependency, removing an internal keyv v4/v5 version mismatch in this package's own dependency tree (#2). No API changes needed — `get`/`set`/`clear`/`on`/`opts.ttl` surface is unchanged between keyv v4 and v5.
- Fixed `getNodeVersion()` resolving the wrong path for `package.json` (was reading `dist/package.json`, which never exists), which silently broke cache-version invalidation on every upgrade since it was introduced in 1.2.3. Cache-version checking now actually runs; as a one-time side effect, address and domain caches will be cleared on first use after this upgrade. Also gave the internal version marker an explicit `ttl: 0` (no expiry) so it can't itself expire and trigger a periodic full cache wipe.

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
