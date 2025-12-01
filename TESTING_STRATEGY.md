# Mutter Games – Testing Strategy

This document describes the full testing approach for Mutter Games, covering:
unit testing, integration testing, Firestore security testing, and end-to-end (E2E) testing for both the store and the admin panel.

The objective is to guarantee stability, safety, correctness, and regression protection across all user flows and backend operations.

---

## 1. Testing Goals

The testing strategy is designed to ensure:

- ✔ Data integrity

  No inconsistent states in cart, orders, or product catalog.

- ✔ Security enforcement

  Firestore Rules prevent unauthorized reads/writes.
  Admin API enforces admin checks and token validation.

- ✔ Functional correctness

  Each user flow behaves exactly as expected for both visitors and admins.

- ✔ Regression safety

  Changes in code do not silently break checkout, cart sync, admin actions, or product management.

- ✔ Cross-browser stability

  Especially Safari iOS, where WebKit can behave differently from Chromium.

---

## 2. Testing Layers

The project uses four complementary layers:

    UNIT TESTS (Vitest)
    ──────────────────────────
    SMALL functions
    Pure logic
    Deterministic behavior

    FIRESTORE RULES TESTING
    ──────────────────────────
    Access control
    Security enforcement
    Negative tests

    ADMIN API INTEGRATION TESTS (Future)
    ──────────────────────────
    Endpoints correctness
    Token verification
    Error handling

    END-TO-END (Playwright)
    ──────────────────────────
    Real user journeys
    UI + backend + Firestore + ImageKit


---

## 3. Unit Tests (Vitest)

The goal: validate deterministic logic without browser or backend dependencies.

### 3.1 What is covered

| Module           | Description                                      |
|------------------|------------------------------------------------|
| cartUtils.ts     | Pricing, totals, shipping cost logic, item normalization |
| adminApiFetch.ts | Fetch wrapper, error handling, token injection |
| firebaseUtils.ts (selected parts) | Auth helpers (mocked), anonymous UID logic |
| Any pure utility function | Currency, formatting, validation, etc.         |

### 3.2 What is mocked

- fetch is fully mocked.
- Firebase Auth is partially mocked (identity only).
- No Firestore calls.
- No DOM beyond Happy-DOM environment.

### 3.3 Success criteria

- All unit tests must pass.
- No flaky tests.
- No real network requests.

Example test types:
- Returning correct totals for multi-variant items.
- Rejecting invalid product data.
- Ensuring adminApiFetch throws on 401/403.
- Ensuring cartUtils removes invalid items.

---

## 4. Firestore Security Testing

This layer ensures Firestore Rules behave exactly as intended, and prevent any unauthorized access.

### 4.1 Tools

- @firebase/rules-unit-testing
- Firebase Emulator Suite (Firestore only)

### 4.2 Collections covered

| Collection | What is verified                                  |
|------------|--------------------------------------------------|
| orders     | Visitors cannot write orders; admins can delete; owners can read. |
| clients    | Only owner can read/update; admins can also read; no public access. |
| products   | Public read; only admins can write.               |

### 4.3 Types of tests

Positive tests
- Admin can create/edit/delete products.
- Visitor can read catalog.
- User can read their own orders.

Negative tests (critical)
- Visitor cannot write orders directly.
- User cannot impersonate another UID.
- No writes to adminUsers from frontend.
- No cross-tenant access (client A cannot read client B).

### 4.4 Why this matters

Firestore Rules are the last line of defense if the frontend or API is compromised.
Rules testing ensures:
- Zero privilege escalation.
- No path exists for unauthorized writes.
- Admin operations remain backend-exclusive.

---

## 5. End-to-End Testing (Playwright)

E2E tests simulate real users and run the entire stack:
- React UI
- Admin API
- Firebase Auth
- Firestore
- Routing
- ImageKit (mocked or stubbed during CI)

### 5.1 User flows covered

| Area       | Flow                                                |
|------------|-----------------------------------------------------|
| Storefront | Visit homepage → browse products → open product → add to cart |
| Cart       | Add item → go to /cart → verify quantities/prices   |
| Checkout (stubbed) | Validate shipping form → send order request (mock backend) |
| Admin      | Login → view dashboard → create/edit product (image upload stubbed) |

### 5.2 Why Playwright?

- Consistent across devices
- Full browser automation
- Great for Safari issues via WebKit mode
- Screenshots + traces on failures

### 5.3 What is stubbed during CI

To avoid external failures:
- ImageKit upload endpoint
- Mercado Pago
- Network flakiness
- Emails
- Analytics

But the test still asserts:
- Correct API call made
- Correct request body sent
- UI updated accordingly

---

## 6. iOS Stability Testing (Safari/WebKit)

Safari iOS is the hardest environment due to:
- WebKit single-process model
- localStorage limitations
- async race conditions with Firebase
- Suspense + React refresh oddities

Our approach
1. safeStorage wrapper removes the risk of iOS StorageErrors.
2. ensureAuthReady consolidates anonymous auth → no multiple signInAnonymously calls.
3. Cart flows are stabilized through deterministic initialization.
4. E2E tests run in WebKit mode, which simulates Safari behavior.

Planned:
- full on-device Safari automation using Playwright WebKit.

---

## 7. Regression Testing Strategy

Every change must be validated through:

### 7.1 Unit tests

For pure logic.

### 7.2 Manual smoke tests

Critical due to the nature of iOS behavior:
- Product page open
- Add to cart
- Admin add/edit product
- Image upload

### 7.3 E2E test pipeline (CI-ready)

Future integration:
- GitHub Actions
- Run Vitest → Firestore Rules → Playwright
- Block merge if failures occur

---

## 8. Coverage Philosophy

We do not chase 100% coverage. We focus on Risk-Based Coverage:

| Area        | Why                                  |
|-------------|-------------------------------------|
| Cart logic  | High impact, must be deterministic  |
| Auth flows  | Affects entire app                   |
| Firestore Rules | Security-critical                |
| Checkout    | Revenue-critical                    |
| Admin CRUD  | Integrity-critical                  |

Low-risk areas (icons, UI-only components, CSS) are not tested.

---

## 9. Known Limitations

- Playwright cannot fully control a real iPhone (WebKit sandbox).
- SafeStorage fallback reduces iOS crashes but does not fully guarantee Safari stability.
- ImageKit tests require stubbing to avoid rate limits.
- Some rule tests are skipped pending revised order write policy.

---

## 10. Future Improvements

- Add Zod-based request validation and test schemas.
- Add rate-limiting tests for Admin API.
- Add per-profile E2E tests (mobile, desktop, slow networks).
- Add contract tests between frontend <-> Admin API.
- Automated load tests (Locust or k6).

---

## 11. Summary

The testing strategy ensures that Mutter Games is:
- Stable for users and admin operators
- Secure against privilege escalation
- Predictable under WebKit/iOS edge cases
- Maintainable with clear test boundaries
- Scalable with CI-ready foundations