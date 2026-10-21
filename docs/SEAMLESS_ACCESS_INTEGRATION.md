> Historical first-delta simulator documentation. The current UI, private enrollment and 1:1 integration boundary are documented in `SEAMLESS_OPERATIONS.md`. The operational UI no longer calls the DEMO endpoint.

# Seamless Access — demo and integration handover

## Baseline

Apply only to the ROOT Next.js application in `GAES-V-22.2(1).zip` (internal path `GAES-V-22.2/GAES-V-22.2/`; package version 0.23.1). Source ZIP SHA256: `c4ffbc4c2dc4610d0fbc56fb8c5ae53233c100d63e00fef733b99a0c233a1609`.

`GAES-main(1).zip` is an older reference, commit archive `b2820418fe84fe6404766986a3d78af034698e6f`, SHA256 `a267c92b6efb3fd1a6b74d2a73a808fe516f4ad482bc4d25f0f2ff3afbeb12ae`. It lacks the newer facility implementation and is NOT the target. The nested `source/` and `static-build/` trees in the latest package are unused by its root Netlify pipeline. They remain untouched.

Framework: Next.js 16.2.6 / React 19.2.6, TypeScript, npm lockfile, root `app/page.tsx` query navigation. Firebase web initialization, Auth session/profile, existing `users`, `lounges`, `entitlements`, `flights`, `visitors`, audit helpers, and Netlify deployment remain in place. No vendor passenger/biometric/hardware implementation was found. The baseline API guide refers to connector files that do not exist in the supplied root source. No production connector was replaced.

## Implemented behavior

Lounge/Tenant Access now exposes Access Verification and Seamless Access (`/?view=seamless`). Access Verification retains its existing barcode/QR scanner, image reader, manual inputs, and visitor save. Seamless shares the signed-in session, shell, CSS, notifications, forms and tables. No new stylesheet, login, user collection, or production entitlement engine is added.

All 14 public fixtures are DEMO. Identity recognition and entitlement/authorization are separate stages. A matching face alone never grants access. Passenger entitlement in the simulator is a fictional attestation constrained to the chosen location and expiration. **It is not an evaluation of real passenger entitlement.** Existing production rules stay in the original Access Verification workflow. Live mode stays disabled both in UI and backend; no credential or environment toggle can activate it prematurely. Never use the simulated adapter as a production entitlement authority.

Gate scenarios: confirmed simulated open/close, accepted without acknowledgement, timeout, fault, offline and wrong-device acknowledgement. Physical confirmation is always false. The application decision can be ELIGIBLE while the gate remains unconfirmed/unavailable.

## Permissions

| Action | Backend authority |
|---|---|
| Verify synthetic scenarios; review scoped activity | Active Super Admin / Admin / BO Admin / Lounge Officer / Lounge Manager; password change must be complete |
| Cross-station demo operations | Super Admin / Admin only |
| Station operations | BO Admin limited to profile station |
| Lounge operations | Lounge Officer / Lounge Manager limited to profile station AND nonempty assigned loungeId |
| Staff list, enrollment, reference replacement, update/deactivation, test managed staff | Super Admin / Admin only |
| Create staff identity or change role, employee reference, station, account active state | Existing User & Role / create-user and manage-user; unchanged |
| Configure locations and production policy | Existing master management only; no new endpoint for bypassing it |
| Read auditLogs directly | Existing Super Admin / Admin rules; unchanged |

Backend reads authoritative profiles rather than trusting browser roles. Rechecks acting profile/location and managed staff at result commit. Staff demo access uses existing role, station and assigned lounge; valid enrollment cannot elevate them. Staff roles allowed for simulated entry: BO Admin, Lounge Officer, Lounge Manager. Existing staff user IDs are the stable identity reference; no redundant personnel registry.

## Data ownership and persistence

| Path | Fields / ownership | Permissions / retention |
|---|---|---|
| `users/{uid}.seamlessDemo` | DEMO active, loungeIds, enrollmentStatus, synthetic providerReference, enrolledAt/By, createdAt, updatedAt/By, identityConfirmedAt, privacyConfirmedAt; owned by GAES admins | Existing users rules; mutations only by audited function. Deactivation revokes demo reference. Provider reference excluded from staff-list response. Existing authenticated self-profile read can include the synthetic reference; no production biometric reference is stored here. |
| `seamlessDemoRequests/{sha256(actorUid + requestId)}` | Fingerprint, actorId, loungeId, PENDING/COMPLETE, result, createdAt | Server-only under existing default-deny rules. Preserve deduplication keys while retries can occur. No automatic expiry supplied. |
| `seamlessDemoLocations/{loungeId}/attempts/{requestHash}` | Masked identifier, category, mode, identity, authorization, decision, reason, station/lounge, timestamp, gate trace, deviceId | Server-only; authorized scoped function returns 50 rows/page newest-first; uses single-field createdAt index. No new composite index needed. |
| `auditLogs/{id}` | Existing audit schema; decision and each simulated gate transition; masked/no face data | Existing admin-only read and backend-only write; existing audit retention policy. |
| `public/demo-media/manifest.json` | Fictional fixtures; public source assets | Public; no production data. |

Records survive refresh by querying Firestore rather than local storage. Staff save and audit commit together; result, deduplication completion, decision and gate audit events commit together. No face image, embedding, raw provider payload, passenger record or full staff name is copied into activity. Staff identity and standard profile timestamps remain in existing users records.

Do not broadly enable Firestore access to the new paths. Existing rules deny unspecified paths, including their descendants, and all new data access uses authenticated Functions. No changes to rules, Firebase configuration, existing collections/documents/valid queries or deployment variables are needed. Staff metadata is a namespaced additional field on users only after an administrator explicitly saves enrollment.

Demo retention is intentionally not guessed: admins must choose the approved demo retention period and purge demo activity and user metadata when the demonstration ends. Preserve request tombstones until retry windows close. Production retention/deletion, lawful processing approval, provider access and incident handling remain prerequisites before live activation. No production personal-data processing compliance is claimed.

## Internal service contract

`POST /.netlify/functions/seamless-access`, JSON, existing Firebase ID token headers via `seamlessAccessRequest`.

- `verify`: `{mode: 'DEMO'|'LIVE', loungeId, scenarioId, gateBehavior, requestId, subjectUid?}`. `subjectUid` only for admin testing enrolled existing staff. Never accept a browser eligibility flag.
- `activity`: `{loungeId, cursor?}` → `{activity, nextCursor}`. Cursor is the last attempt document ID within the same lounge.
- `staff-list`: `{cursor?}` → `{staff, nextCursor}`, 100 profiles/page.
- `staff-save`: `{uid, operation: 'enroll'|'update'|'deactivate', loungeIds, identityConfirmed: true, privacyConfirmed: true}`. No uploaded image or raw biometric input. These checkboxes record admin confirmation, not legal approval or a biometric service enrollment.

Normalized identity adapter: `{available, captured, matched, referenceId, category, liveness?, confidence?}`. Missing/incorrect required fields fail closed. Current DEMO liveness is `SIMULATED`; no invented numeric threshold. Future provider matching must map its approved decision/liveness policy, not infer identity from filename or score.

Normalized passenger adapter: availability, minimal authoritative reference, entitlement decision with policy provenance, validity and station/lounge scope. The current DEMO adapter uses `DEMO_ONLY` policy; live must instead invoke the established business entitlement policy with authoritative passenger, flight/time, partner and lounge restrictions. If those rules cannot be mapped, return manual review/rejection. Do not copy an entire DCS response into Firestore.

`withDeadline(operation, 3000)` supplies an AbortSignal. Both future biometric and passenger adapters must pass it to actual network requests and sanitize errors. Simulator failure fixtures are deterministic immediate failures; tests also execute the deadline/abort path. No automatic retry of failed verification or open commands.

Gate adapter boundary: server-generated device binding, eligible application decision, loungeId/station, unique attempt/command key, requested action; normalized response must include command state, authenticated device ID/location, command correlation, acceptance/open/close/rejection/fault feedback and timestamps. The implemented `simulateGate` has no network endpoint and cannot control hardware. A future live driver must validate signed feedback/correlation and device scope before reporting physical open. Use transactional outbox/claim-before-send and controller deduplication; never substitute this synchronous simulator for a hardware delivery worker.

Idempotency: scoped to actor/request UUID; fingerprint prevents changing scenario/location/device behavior with the same key. Reservation precedes simulation, completed retries return the saved result, PENDING retries never dispatch another command. If execution stops after reservation, PENDING stays safe and requires operator investigation; no automatic takeover/retry opens a gate. Client retains the UUID for same-input retry during a mounted screen. Refresh does not auto-verify; refreshing activity does not send a gate command. New deliberate verifications generate new UUIDs. Rate limit 30 verification/enrollment requests per actor/IP per minute uses the existing Firestore rate-limit helper; replay requests count toward this limit.

## Unknown external integrations / production blockers

| Dependency | Required before enabling live |
|---|---|
| Authorized check-in/passenger API | Actual endpoint/auth contract, authorization to access minimal reference data, timeout/error semantics, refresh/retention rules, stable identity linkage. Check-in alone does not imply available biometrics. |
| Biometric provider | Approved match + liveness policy, secure enrollment/match/reference deletion contracts, credential management and authenticated responses. Provider owns biometric templates. |
| Staff identity | Existing users is reused for demo; corporate staff source/role authorization and lawful enrollment approval must be confirmed for production. |
| Entitlement | Server-side approved mapping to existing entitlement rules and authoritative flight/station/lounge/partner/time data; demo attestation is insufficient. |
| Autogate | Hardware/controller model, SDK/protocol, device registry, secure command/ack channel, correlation, idempotency and fail-safe policy. |
| Firebase live UAT | Existing environment and authorized accounts; no production credentials supplied or production writes attempted in this session. |

No vendor URL, secret name or authentication scheme was invented. Keep any future provider credentials exclusively in server environment, using names agreed with the actual integration. Existing Firebase environment variables and Netlify configuration remain unchanged; no new variables needed for demo. A future live enable/configuration switch must be added only with all adapters, security/policy validation and live UAT in place.

## Manual installation

1. Back up the current repository. Confirm it is the latest package's ROOT Next application, not its nested `source/` or `static-build/` folder and not the older GAES-main package.
2. Extract the delta directly into the folder containing root `package.json`, `app/`, `lib/`, `netlify.toml`. Preserve exact paths from PATCH_NOTES.md. Replace only listed files; no deletion required. Do not copy compiled source into public.
3. Public manual media destination: `<root>/public/demo-media/`. Source replacements remain under app/lib/tests/docs; server entrypoint is `<root>/netlify/functions/seamless-access.mjs` and its server modules under `<root>/lib/seamless/`. They must be deployed together through the existing build pipeline.
4. Use Node >=22.13: `npm ci`, then `npm test`. Lockfile unchanged because no application dependencies were added. Existing Netlify command remains `npm test`, publish `.next`, Functions `netlify/functions`.
5. Commit/deploy the added and replaced source files using the normal GitHub → Netlify deployment. Merely copying public assets does not deploy the UI or function. Do not upload this delta ZIP as a standalone static full app.
6. Existing Firebase web/Admin configuration is required for the signed-in demo. No login bypass or local-data replacement is supplied. Select an active existing lounge within the user's scope, then open Lounge/Tenant Access → Seamless Access.
7. Test DEMO passenger-valid/invalid/unknown and gate accepted/offline/confirmed. Confirm physicalOpenConfirmed remains false. As Admin/Super Admin, select existing staff, confirm identity/privacy, enroll, verify, update, deactivate, refresh, and verify rejection. Use existing User & Role to create new staff identities if needed.
8. Run signed-in production-environment UAT of existing Boarding Pass, QR Code, Manual Input and unrelated facility/master/dashboard pages before rollout; these require real credentials and were not claimed live-tested here.

Rollback: restore the six replaced source/doc files from the baseline and remove only added files listed in PATCH_NOTES after checking no later work depends on them. Restore the added `users.seamlessDemo` fields/data separately only under an approved data cleanup, never delete existing users, visitors or lounges. No database migration or data deletion is part of install.
