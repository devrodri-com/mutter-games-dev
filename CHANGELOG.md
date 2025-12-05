# Changelog

All notable changes to **Mutter Games** will be documented in this file.

This project follows a simplified semantic versioning approach.

---

## [1.0.0] – 2025-11-30
### Added
- Complete architecture documentation:
  - `ARCHITECTURE.md`
  - `SYSTEM_DESIGN.md`
  - `SECURITY_OVERVIEW.md`
  - `TESTING_STRATEGY.md`
  - `CONTRIBUTING.md`
- Safe storage wrapper (`safeStorage.ts`) to prevent iOS Safari crashes.
- Centralized anonymous authentication flow (`ensureAuthReady()`).
- Improved CartContext stability with protected storage parsing and fallback.
- Hardened Admin API:
  - Strict allowlist-based CORS.
  - Centralized `verifyAdmin` with token revocation checks.
  - Secure ImageKit signature endpoint requiring admin auth.
- Full test suite:
  - Vitest unit tests.
  - Firebase Rules tests.
  - Playwright E2E tests.
- New documentation-ready project files for portfolio & onboarding.

### Changed
- Replaced all direct `localStorage` usage with safeStorage.
- Unified cart initialization & Firestore sync logic.
- Cleaned old backend folders (`backend/`, `/api/`) and deprecated utilities.
- Improved project structure and developer onboarding experience.

### Fixed
- Fixed image upload failures on some browsers due to missing CORS headers.
- Prevented iOS Safari infinite reload loops with safer storage access.
- Fixed inconsistent admin token verification on endpoints.

---

## [0.9.0] – 2025-11-15
### Added
- Initial stable release of Mutter Games platform.
- Firestore rules v1 fully operational.
- Admin API deployed with product/category/user CRUD.
- Anonymous cart and checkout flow implemented.
