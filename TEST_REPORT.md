# Seamless Access — executed validation

Date: 21 October 2026. Baseline: latest supplied GAES-V-22.2 root Next.js application, package 0.23.1. Runtime: Node v24.19.0, npm 11.9.0. Deployment target remains existing Node 22 (>=22.13); no Node-version configuration changed. No production credentials, external provider contracts or gate hardware were supplied.

## Final automated results

| Check | Actual result |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | PASS — 769 packages installed using existing lockfile; dependency install scripts intentionally disabled for local installation. No vulnerability audit claimed. |
| `npm test` on final source | PASS, exit 0 — existing complete pipeline, now including Seamless suite. |
| `npm run test:logic` | PASS — 11/11 existing data normalization tests. |
| `npm run test:ui` | PASS — 40/40 existing UI/source/rendering contract tests. These are not authenticated end-to-end runtime tests. |
| `npm run test:seamless` | PASS — 36/36 decision, adapter, permission, persistence and idempotency tests. |
| `npm run lint` | PASS — 0 errors, 27 warnings (including existing legacy warnings and two state-synchronization effect warnings in the new component); warnings remain visible. |
| `npm run build` | PASS — Next.js 16.2.6 production build, TypeScript and page generation complete. Routes `/`, `/player`, `/lounge-map/[id]`, `/_not-found` retained. |
| `npx tsc --noEmit` | PASS — exit 0. |
| `node --check` new core/adapter/service/function modules | PASS — all four modules parse. |
| Function esbuild bundle, Node 22 target, ESM, external packages | PASS — entrypoint and local JSON/module graph bundle successfully. This is not a Netlify deployment. |
| Baseline preservation comparison | PASS — existing Access Verification JSX byte-identical after normalizing only required title/subtitle changes. Firebase client, Firestore rules, Netlify config, package-lock and facility operations source hashes unchanged. |
| Delta ZIP | PASS — opens/CRC-valid, exact expected 20 files, relative paths preserved, each payload byte compared to final source; no node_modules/.git/build output/secrets included. |

87 Node tests passed in total; 0 failed, cancelled or skipped.

## Browser/runtime results

Executed in headless Chromium 153 through Playwright. The existing browser download failed in this environment; a temporary browser runtime obtained separately was used successfully. No browser/testing dependency was added to the application.

### Isolated component with service integration — PASS (12 checks)

The actual `app/seamless-access.tsx` was mounted with existing `globals.css` and its authenticated client request wrapper. A local HTTP endpoint called the actual Seamless service using a Firestore behavior double and an explicitly fictional test actor/token. This harness was temporary, never added to production source or delivered as a login bypass. All data was fictional; this is **not** evidence of live Firebase persistence or production Auth.

1. Eligible passenger renders separate identity/entitlement decisions and simulated gate acknowledgement; physical confirmation stays No.
2. Browser refresh retrieves persisted activity from the test backend.
3. Invalid entitlement and unknown-face scenarios reject without gate commands.
4. Accepted command without an open acknowledgement stays unconfirmed.
5. Offline device shows unavailable, without false physical success.
6. LIVE selection disables verification and displays controlled unavailable message.
7. Admin staff enrollment saves, survives reload, and managed staff can verify in DEMO.
8. Deactivated staff is rejected.
9. Lost HTTP verification response followed by user retry reuses the key; only one attempt/command sequence is stored.
10. Activity decision filter and text search work.
11. Mobile 390px viewport has no document horizontal overflow; rendered mobile screenshot visually inspected.
12. Zero browser runtime errors across these interactions.

### Production Next application unauthenticated smoke — PASS

Started the compiled application with `next start`. In a real browser, `/?view=access`, `/?view=seamless` and `/player` render HTTP 200 without browser runtime errors. Both access URLs retain the existing sign-in screen; Seamless content is unavailable before authentication. No authentication bypass was used. This validates the unauthenticated runtime only.

## Coverage against master handover

| Domain | PASS locally | BLOCKED / not live verified |
|---|---|---|
| Navigation/regression | Next compile/routes; auth wall; submenu/source contracts; original barcode/QR/manual JSX preserved; existing 51 logic/UI tests | Signed-in navigation, camera/QR/manual visitor submission, dashboard/master/facility production regression require authorized Firebase account/environment. |
| Passenger | Valid/invalid/expired entitlement; unknown identity; missing passenger; simulated passenger/biometric service failure; malformed response; actual deadline AbortSignal; different station/lounge rejection | Real DCS/passenger reference lookup, real entitlement attestation and production flight/partner/time mapping. |
| Staff | Existing-profile enrollment/update/deactivation; reload persistence in behavior double; inactive, unknown, role/location mismatch, incomplete enrollment; identity/privacy confirmations; unauthorized list/enroll/reference lookup blocked; deactivation after lounge/role changes | Actual Firestore writes/read-after-refresh, corporate identity confirmation and approved production biometric enrollment. Staff identity creation itself remains in unchanged User & Role / create-user and was not executed against production. |
| Gate | Eligible-only command path; rejection issues no command; confirmed simulated open/close; offline, accepted-no-ack, timeout, fault, wrong-device rejection; parallel retries and PENDING replay safe | Physical device network/protocol, authenticated device acknowledgement/correlation, hardware open/close; not simulated as live. |
| Security/privacy | Real function entry rejects missing token before Firebase access; backend role/station/assigned-lounge checks; namespace input validation; public synthetic fixtures; provider reference omitted from staff-list; no real biometric data captured; safe unavailable errors | Credentialed Firebase Auth token checks, Firestore rule emulator/production enforcement, rate-limit helper writes in actual Firebase, provider security review and lawful production processing approval. |
| Persistence/audit | Atomic transaction behavior, staff metadata update/revoke, stored access/gate states, audit records, replay deduplication using test double | Real Firestore/emulator tests NOT RUN: environment/credentials/emulator unavailable. Physical hardware and full Netlify production pipeline NOT RUN. |

## Limitations and handover gates

- Demo identity, passenger entitlement, staff scenario fixtures and gate responses are **simulated**. They grant no real lounge access and create no production visitors/billing entries.
- Staff metadata/attempt/audit persistence is implemented against existing Firestore Admin APIs but only behavior-double tested here. Existing Firebase variables and accounts are required to execute the signed-in demo on Netlify.
- Live mode deliberately fails closed. Passenger/check-in API contract, approved biometric matching/enrollment/liveness policy, staff source approval, production entitlement mapping and autogate controller protocol are unresolved external dependencies.
- A backend process interrupted after reserving an attempt may leave PENDING. Replays never trigger another command. Operator inspection/reconciliation is required; no automatic gate resend/takeover is implemented.
- No production retention period was invented. Define approved retention/cleanup before real data processing; remove demonstration metadata/activity under an approved cleanup after demo use. Never delete existing users, visitors or lounges as part of this delta.
- No final local validation failure remains. Signed-in production and physical-integration checks remain BLOCKED and must not be interpreted as PASS.
