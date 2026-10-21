# Seamless Access V2 — validation report

## Result
Operational UI and registration/enrollment changes are implemented and locally
verified. Live biometric recognition, passenger integration, production Firebase
permissions and physical autogate are NOT verified or represented as connected.
No production database update, deployment, PR merge or hardware action was run.

## Baseline and preservation
Working baseline: GAES-V-22.2(1).zip plus the prior Seamless delta.
This is a cumulative delta against GAES-V-22.2(1).zip.
Verified unchanged by SHA-256 against that baseline:
- Firebase client initialization/configuration.
- Firestore and Firebase Storage rules.
- Existing facility/signage implementation and shared global stylesheet.
- package-lock.json (no dependency change).
No existing source files are deleted. Existing document verification, barcode
image scanner, manual input and visitor persistence contracts remain present.

## Automated checks
- PASS: 11 existing data-normalization tests.
- PASS: 40 existing UI/rendered HTML regression tests.
- PASS: 36 existing isolated Seamless DEMO/orchestration regression tests.
- PASS: 37 new operational/enrollment tests (total 124 Node tests across suites).
- PASS: ESLint, 0 errors. The full project reports 32 warnings; remaining
  set-state synchronization and legacy code warnings are recorded, not hidden.
  The final backend and reproducible browser harness also pass targeted lint.
- PASS: TypeScript and optimized Next.js production build.
- PASS: new Netlify Function bundled using esbuild.
- PASS: actual Function entry rejects missing authentication (401) and malformed
  enrollment link (403) before Firebase initialization; responses use no-store.
- PASS: provider diagnostics are excluded from results/activity.

Important backend cases: HO scope required separately from administrator role;
consent and active staff checks; master-station validation; lounge assignment;
transactional employee number uniqueness; old employee credential invalidation;
private photo ownership; image type/size checks; photo submission cannot activate
face access; hashed invitations; link expiry, replacement, issuer revocation,
consumption and deactivation; 1:1 reference/session binding; liveness failure;
invalid/expired/wrong-lounge entitlement; actor/staff revocation during matching;
parallel replay and changed request IDs; wrong gate acknowledgement; bounded
provider/gate timeout; separate physical gate confirmation; dotted master IDs.

## Browser checks: 19 passed, zero uncaught runtime errors
Actual React components plus actual operations service, using explicit in-memory
Firestore, Storage, Firebase identity, biometric, entitlement and hardware doubles.
Camera input is a generated test canvas stream; the test video is a generated
color clip under tests/fixtures, never deployed as public operational content.

1. Master station codes and clean operation UI without IDs/demo scenarios.
2. Signage-video and published-map settings survive reload.
3. Lounge screen loops selected video; unavailable face provider blocks approval.
4. ID/EN updates lounge fields and unavailable-service messages.
5. Staff name/unit/employee number and assigned location persist.
6. Private photo upload/submission awaits review; no provider means no activation.
7. Single-use invitation token is placed in a URL fragment.
8. Staff form at 390 px has no horizontal document overflow.
9. Guided self enrollment captures three poses and submits once; ID/EN result.
10. Reload without the removed token fails safely.
11. Claimed passenger session, camera capture, 1:1 call, entitlement and gate
    feedback produce welcome and QR to the actual selected map (test providers).
12. Eligible identity without gate feedback shows assistance, not welcome.
13. Lost response followed by retry sends no duplicate gate command.
14. HO admin activation requires confirmed provider enrollment (test provider).
15. Staff display omits employee number and passenger map QR.
16. Results clear automatically and display returns to standby.
17. Activity filter/search reads persisted service results.
18. Operations/activity at 390 px have no horizontal document overflow.
19. No uncaught browser runtime errors throughout these interactions.

Visual QA inspected operations, staff mobile and lounge result screenshots.
Screenshots contain only generated test fixtures and remain internal QA artifacts.

## Built application route checks
PASS: production Next.js pages /?view=access, /?view=seamless and /player render.
Access/Seamless retain the Firebase sign-in wall in the unconfigured environment.
PASS: /staff-enrollment handles missing token safely and switches ID/EN.
PASS: no uncaught runtime errors on those built pages.
These route checks do not establish a successful production Firebase login.

## Reproduction
Standard pipeline: npm ci, then npm test (Node >=22.13).
The browser harness is included as tests/seamless-browser.mjs and optional
npm run test:seamless:browser. Supply an existing Playwright installation/browser:
PLAYWRIGHT_MODULE can identify its module; CHROMIUM_EXECUTABLE_PATH optionally
selects a Chromium executable; GAES_BROWSER_TEST_OUTPUT selects the QA output
folder. The harness runs locally with isolated data; it never needs production
credentials. It is deliberately outside the default npm test dependency chain.

## Remaining integration/UAT
- Existing Firebase account/profile access on the PR Deploy Preview.
- Real Storage bucket permissions, writes and temporary signed reads.
- Private repository asset availability in deployed Function bundles.
- Approved passport/check-in identity provenance and session reference contract.
- Approved face provider, enrollment validation and genuine anti-replay/liveness.
- Real passenger entitlement source and commercial policy mapping.
- Lounge-to-autogate device mapping, command protocol, feedback and safety UAT.
- Retention/deletion procedures for enrollment photos, sessions and activity,
  orphan-photo cleanup, and operator reconciliation of interrupted gate requests.

Do not label local test-double results as real-person biometric or hardware UAT.
