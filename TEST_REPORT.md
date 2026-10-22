# V4.1 — repository photo import correction

Root cause: the old filename whitelist rejected spaces, including otherwise valid PNG filenames. The real repository reader is now isolated and tested with the reported filename, Unicode names, nested folders and uppercase extensions. File content must still match a supported image signature, remain under 1,000,000 bytes and remain inside the private source directory. Traversal and symlinks are rejected.

Missing files or missing bundled directories now return REPOSITORY_PHOTO_NOT_FOUND (404), with bilingual guidance to check exact case and the deployed branch. This is distinct from an invalid path. The reader uses only deployed private repository files, not the live GitHub API.

Validation: full npm test passed (145 tests = 11 normalization + 40 UI + 94 seamless), ESLint 0 errors / 32 existing warnings, TypeScript and production build passed. 20 browser checks passed using explicit test doubles; 10 new filesystem tests exercise the real repository reader. Production deployment, live Firebase Storage and the user's actual personal photo were not accessed or verified.

Upload the updated first cumulative ZIP and deploy the branch containing both code and the photo. Model Part2 is unchanged. Repository input can retain its exact filename, including internal spaces. The file name and branch shown in the report are covered as path behavior, not evidence of a successful live import.

# V4 validation — current UI and camera correction

- Full npm test passed: 11 normalization, 40 UI and 84 seamless service tests (135 total); ESLint 0 errors / 32 existing warnings; Next.js production build and TypeScript passed.
- 20 browser checks passed with zero uncaught runtime errors, using the real React components and GAES operations/registry code with explicit Auth/Firestore/Storage/camera/face/gate test doubles.
- New regressions covered: camera visible while engine unavailable; automatic readiness recovery without reopening; detected face without prepared identity gets check-in guidance; detection failures show camera assistance; consent blocking explained locally; oversized attachment message; failed storage retains local preview without allowing submission; retry succeeds.
- Existing display-only, orientation, full viewport/inert background, master-data sources, accountless registration, camera photo, guided invitation, mobile width, ID/EN, 1:1 queue/result and no-gate-without-liveness coverage remains passing.
- The stale UI source assertion requiring demo helper text was replaced with operational-copy assertions; support for safe existing local media paths is retained in the backend.
- Camera/face behavior in browser tests is simulated; actual model inference and split-model reconstruction were checked in earlier V3/V3.1 runs documented below. No production Firebase, hosted engine or physical gate acceptance is claimed by this package.

# Split-model packaging verification

- Seven assembler tests passed: exact reconstruction/reuse; missing, corrupted and reordered parts; invalid output; traversal and symlink rejection.
- Eight existing real-model tests passed after removing the full model from the test input, exercising automatic reconstruction from the two shipped parts.
- Actual Python HTTP engine / Node adapter integration passed, including real enrollment and single-reference comparison; no gate command without liveness.
- Delivery ZIP integrity, cumulative manifest hashes, extracted file sizes, and exact reconstructed model SHA-256 verified from a clean two-ZIP extraction.
- No UI or web runtime source changed in this packaging revision. Previous V3 build/browser validation below belongs to that implementation; not rerun for this revision.
- Docker daemon/build was not available for this check. The exact assembly command used by Docker was exercised separately with Python.

# Seamless Access V3 — validation report

## Delivered scope
Project-owned local 1:1 face engine and the requested UX corrections. The model
files, executable service, private Node adapter, registration changes, display-only
UI and deployment guide are included. This is not a third-party biometric API.

The engine has been exercised with real ONNX inference. Liveness/PAD has NOT been
implemented or validated. Matching alone cannot issue a gate command. No live
passenger integration, physical gate, production Firebase write or deployment
was performed. A separate managed engine process must be started and configured
before the deployed portal can report the face service connected.

## Automated checks
- PASS: 11 existing data-normalization tests.
- PASS: 40 existing UI/rendered HTML regression tests.
- PASS: 36 legacy isolated simulator tests.
- PASS: 37 existing operational/security tests.
- PASS: 11 new registration/scope/integration tests.
- Total Node suite: 135 passed, no failures.
- PASS: project lint, zero errors (existing synchronization/legacy warnings remain).
- PASS: TypeScript and optimized Next.js production build.
- PASS: new backend Function bundles using esbuild.

New registration tests cover: account-less staff without creating users/Auth;
lookup of non-operational master users; independent pagination; scoped BO writes
and lookups; optional account link validation; exact master lounge references;
in-place reuse of existing enrollment; independent photo upload/approval/session;
self enrollment without portal login; linked-account deactivation; no identity
creation by anonymous presence detection. Existing security tests continue to
cover consent, station/lounge validation, image checks, expired/replaced links,
provider/reference/session binding, entitlement failures, actor/staff revocation,
request replay and gate timeout/acknowledgement handling.

## Actual local face engine
Eight Python tests pass against the SHIPPED YuNet/SFace model files:
1. A real reference photo is detected and matches its enrolled reference.
2. A brightness-adjusted version of that reference matches.
3. A blank/no-face image is rejected for enrollment.
4. A two-face image is rejected for enrollment.
5. Another subject cannot use a reference belonging to the first subject.
6. Embeddings are encrypted; ciphertext tampering is rejected.
7. Invalid images/formats are rejected.
8. Invalid encryption keys and thresholds are rejected.

The input image is a public OpenCV sample, held only as a local test fixture,
not shipped as operational staff/passenger data. These checks establish working
inference and failure handling. They do not measure cross-person false accept/
reject rates or prove a real person is present. No “accuracy percentage” is claimed.

A separate integration test starts the REAL Python HTTP service and exercises:
- Authenticated /health and rejection of missing service credentials.
- Real anonymous face detection and reference enrollment.
- The actual Node self-hosted adapter, staff claim/session and real comparison.
- A matched result with livenessPassed=false does not authorize a gate.

The Python tests were run with the requirements versions packaged for the
service. Docker configuration is included but a Docker daemon/container deployment
was not available in this session. The actual Python process and HTTP integration
were run directly, with isolated generated secrets and temporary encrypted state.

## Browser: 15 checks, zero uncaught runtime errors
Actual React UI + actual operations/registry services with isolated in-memory
Auth/Firestore/Storage and face/hardware behavior doubles. Browser camera frames
are generated test images; REAL-model inference is verified separately above.

1. Activity initially has no inherited lounge or misleading location heading.
2. Master station/lounge, library video, published map and orientation save.
3. Main tab shape, typography and hover colors match the portal facility tabs.
4. Display is full viewport, outside application containing blocks; background
   controls are inert. Camera starts on opening, advertisement loops, and there
   are no guest buttons/login fields/type selectors.
5. Both orientations work; operator Escape exits and restores the application.
6. Staff can register without a portal account; optional lookup lists master users.
7. Photo attachment saves and submits an independent staff enrollment.
8. Camera source captures and stores an enrollment photo.
9. Guided self enrollment works for a staff member without portal login.
10. Registration/photo controls fit a 390px viewport without document overflow.
11. A prepared 1:1 session processes automatically on anonymous face presence,
    with no display interaction or gate command without liveness.
12. Result clears and idle advertising returns automatically.
13. ID/EN updates revised registration, account optionality and controls.
14. Activity loads only after its own explicit location selection and filters.
15. No uncaught browser runtime errors across these flows.

Screenshots of operations, mobile staff forms and display were visually inspected.
QA images remain internal and are not bundled as user artifacts or real staff data.

## Preservation and package checks
SHA-256 verification confirms unchanged existing Firebase client initialization,
Firestore rules, Storage rules, shared global stylesheet, facility/signage module
and package-lock.json. No new master lounge/station/user is seeded by the feature.
New independent staff data is separate from Firebase Auth. Existing staff metadata
is reused rather than duplicated. The cumulative ZIP has no deletions and includes
only source/assets/docs/tests and the model files; no private photos, reference
SQLite databases, generated keys, runtime packages or build caches are included.
Every packaged file is checked against its source hash and ZIP integrity is tested.

## Remaining real-system checks
- Deploy/operate the local engine on managed infrastructure reachable from Netlify.
- Supply the engine URL and private service/encryption keys securely.
- Credentialed Firebase Auth/profile/Storage UAT on the current PR Deploy Preview.
- Camera permission, lighting, positioning, performance and threshold calibration
  using representative consented reference/capture data.
- Evaluated liveness/PAD and anti-replay before unattended gate authorization.
- Passenger reference/entitlement and hardware command/feedback integration.
- Operational retention/deletion/backup procedures and interrupted gate recovery.

Reproduction: npm test; optional npm run test:seamless:browser (existing Playwright
installation/browser, instructions retained in the harness); engine commands in
face-service/README.md. These tests do not substitute for production/hardware UAT.
