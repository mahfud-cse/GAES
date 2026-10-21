# Seamless Access delta — 2026-10-21

STATUS: demo implementation validated locally; production Firebase UAT and all live integrations remain blocked by external access/contracts. This is a delta, not a standalone full application.

## Baseline

Target: root Next.js app in `GAES-V-22.2(1).zip`, internal path `GAES-V-22.2/GAES-V-22.2/`, package 0.23.1. ZIP SHA256 `c4ffbc4c2dc4610d0fbc56fb8c5ae53233c100d63e00fef733b99a0c233a1609`.

Older `GAES-main(1).zip` is reference only. Do not apply to it, the nested `source/` copy, or `static-build/`.

## Actual changes

- Lounge/Tenant Access submenu: original Access Verification plus Seamless Access. Original Access Verification form, barcode/QR/image scanning, manual entry and visitor save JSX are unchanged except title/subtitle. Camera/scanner stops when leaving that page.
- New signed-in Seamless page: explicit DEMO simulations, location, capture/identity/authorization/decision states, gate connectivity/acknowledgements, masked results, searchable/filterable paginated activity.
- Fourteen synthetic passenger/staff scenarios, conceptual floor plan and illustrated preview assets. No real face recognition or biometric capture is claimed.
- Existing users model reused: Admin/Super Admin can enroll/update/deactivate DEMO staff authorization metadata; existing User & Role management creates/updates the actual user identity. Enrollment, active status, role, station and assigned lounge are independently enforced.
- Backend-only Firestore activity, decisions, synthetic gate feedback, rate limits, atomic audit writes and request idempotency. No changes to production visitors, entitlement logic, existing Firebase config/rules or Netlify variables.
- Replaceable internal adapters, safe deadlines and fail-closed LIVE mode. Hardware state is explicitly SIMULATED and `physicalOpenConfirmed` remains false.

## Files added (14)

- `app/seamless-access.tsx` — page component inside existing shell.
- `lib/seamless/adapters.mjs` — normalized demo providers, deadline and gate simulator.
- `lib/seamless/core.mjs` — separated identity/authorization decisions and role/location checks.
- `lib/seamless/service.mjs` — authenticated orchestration, staff metadata, Firestore persistence and idempotency.
- `netlify/functions/seamless-access.mjs` — existing Netlify/Firebase helper integration.
- `tests/seamless-access.test.mjs` — 36 node:test cases.
- `docs/SEAMLESS_ACCESS_INTEGRATION.md` — contracts, permissions, data model, install/rollback and blockers.
- `public/demo-media/README.md` — public asset instructions/limitations.
- `public/demo-media/manifest.json` — synthetic fixtures.
- `public/demo-media/layout/access-point.svg` — conceptual access-point floor plan.
- `public/demo-media/passenger/illustration.svg` — fictional passenger illustration.
- `public/demo-media/staff/illustration.svg` — fictional staff illustration.
- `public/demo-media/camera/illustration.svg` — simulated camera placeholder.
- `TEST_REPORT.md` — executed results and blocked live checks.

## Files replaced (6)

- `app/page.tsx` — minimal tab/submenu integration, authoritative profile lounge scope propagation and scanner cleanup.
- `lib/firebase/api.ts` — add one function using existing authenticated POST/token-refresh mechanism.
- `package.json` — add Seamless test script to existing npm test pipeline; no dependency change.
- `tests/ui-foundation.test.mjs` — extend the expected test pipeline to include the new suite.
- `docs/CHANGELOG.md` — append current delta entry using existing history convention.
- `PATCH_NOTES.md` — current canonical patch/install notes.

## Files to delete

NONE. No data migration, collection deletion or automatic database cleanup.

## Exact manual installation

1. Back up the latest root repository. Extract the delta ZIP **into the folder containing root `package.json`, `app/`, `lib/` and `netlify.toml`**, preserving paths and replacing only the six listed files.
2. For manual media copying, destination is exactly `<repository-root>/public/demo-media/`. These assets are public. No source/function/secret/real biometric information belongs in public.
3. Source files in `app/` and `lib/`, backend entry in `netlify/functions/`, and assets must be built/deployed together. Use Node >=22.13, `npm ci`, then `npm test`. No application dependency or lockfile change required.
4. Deploy via the existing GitHub/Netlify build (`npm test`, publish `.next`, functions `netlify/functions`). Do not upload the delta ZIP as a standalone static site. Existing Firebase client/Admin environment remains required and unchanged.
5. Sign in with an authorized existing account, select an active lounge within station/assignment scope, open Lounge/Tenant Access → Seamless Access, and run DEMO scenarios. Admin/Super Admin may configure DEMO staff enrollment. Create new actual staff identities in Master Data → User & Role using existing mechanisms.
6. Run credentialed Firebase/Netlify and existing boarding-pass/QR/manual regression UAT before rollout. Production integration is NOT verified by local test doubles.

See `TEST_REPORT.md` for exact checks. See `docs/SEAMLESS_ACCESS_INTEGRATION.md` for internal adapter schemas, external prerequisites, retention and rollback. No live vendor endpoints, authentication schemes, hardware protocol or keys have been fabricated.
