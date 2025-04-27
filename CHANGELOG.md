# Changelog

All notable changes to the n8n-nodes-quickemailverification package will be documented in this file.

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
