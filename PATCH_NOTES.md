# V4.1 — repository photo import correction

Root cause: the old filename whitelist rejected spaces, including otherwise valid PNG filenames. The real repository reader is now isolated and tested with the reported filename, Unicode names, nested folders and uppercase extensions. File content must still match a supported image signature, remain under 1,000,000 bytes and remain inside the private source directory. Traversal and symlinks are rejected.

Missing files or missing bundled directories now return REPOSITORY_PHOTO_NOT_FOUND (404), with bilingual guidance to check exact case and the deployed branch. This is distinct from an invalid path. The reader uses only deployed private repository files, not the live GitHub API.

Validation: full npm test passed (145 tests = 11 normalization + 40 UI + 94 seamless), ESLint 0 errors / 32 existing warnings, TypeScript and production build passed. 20 browser checks passed using explicit test doubles; 10 new filesystem tests exercise the real repository reader. Production deployment, live Firebase Storage and the user's actual personal photo were not accessed or verified.

Upload the updated first cumulative ZIP and deploy the branch containing both code and the photo. Model Part2 is unchanged. Repository input can retain its exact filename, including internal spaces. The file name and branch shown in the report are covered as path behavior, not evidence of a successful live import.

# V4 — staff photo guidance and lounge camera flow

- Optional portal accounts link staff profiles only; selecting an account does not enroll or verify a face.
- ID/EN wording clarifies registration, photo storage, review, activation and operator-prepared verification sessions.
- Consent guidance is beside photo input; oversized photos get a specific error. Local preview appears before upload finishes; failed storage is explained beside the photo and blocks submission, with retry supported.
- Lounge display starts on camera. Unavailable/failed engine never leaves a misleading welcome screen; the display retries readiness every 10 seconds while unavailable. Healthy no-face detection permits idle video; detected faces reveal camera, then an explicitly prepared 1:1 session produces a verification result.
- Display has no passenger/staff chooser, login or guest controls. Portrait/landscape and operator Escape exit preserved.
- Content library orientation and media-source instructions are localized; demo implementation hints removed from the reviewed form.
- Full npm test passed: 135 Node tests, lint 0 errors (32 existing warnings), TypeScript and production build. 20 browser checks passed with camera/storage/face test doubles and real React/GAES service code. No live production Firebase, physical camera, gate or hosted Python server acceptance performed.
- Model splitting is unchanged: use BOTH ZIP archives. If the earlier Part2 is already in your branch, its content is identical and need not be uploaded again.

# GitHub browser upload packaging revision

- SFace is distributed as two independently checksummed parts (20 MiB and 16.9 MiB).
- Docker build and direct Python engine startup reassemble and verify the original model automatically; no runtime model download.
- Both delivery ZIPs and every extracted repository file are below 25 MiB.
- Extract both ZIPs into one directory; upload extracted contents, never the ZIP archives. See GITHUB_UPLOAD.md.
- Model weights and portal behavior are unchanged from V3. Engine server deployment and backend configuration are still required.

# Seamless Access V3 — cumulative delta

Replaces the V2 interaction design and adds the first project-owned 1:1 face
engine. This ZIP supersedes the earlier Seamless ZIPs; do not apply them afterward.

## Changes
- Shared portal tab/button/hover behavior.
- Display-only lounge screen with immediate camera startup, idle video, automatic
  face-presence/session processing, result reset, and landscape/portrait selection.
- Scoped BO registration, optional existing User & Role account link, independent
  staff records, existing-enrollment reuse and functional photo/camera enrollment.
- Activity requires its own station/lounge selection; no inherited lounge title.
- Local YuNet/SFace inference service with included models, encrypted embeddings,
  private authenticated HTTP transport and actual Node backend integration.
- ID/EN throughout. Existing Auth, Firebase setup, rules, data masters, signage,
  map and boarding-pass/QR/manual verification stay on the existing implementation.

## Install/update the current PR
1. Back up the current branch. Extract into the actual root containing package.json,
   app/, lib/ and netlify.toml. Do not extract into the archived source/ copy.
2. The package is cumulative against GAES-V-22.2(1).zip and contains the previous
   Seamless files at their newest state. Review DELTA_MANIFEST.json. No existing
   files are deleted. Package-lock.json and Firebase/Firestore/Storage setup and
   rules are unchanged. The Python service has its own pinned requirements.
3. Push to the current PR and let the existing Netlify npm test/build pipeline run.
   Use that PR's Deploy Preview, then sign in with the existing Firebase account.
4. Deploy face-service separately on a managed server/container host. Follow its
   README, generate the two private keys, persist its encrypted database, expose
   an authenticated TLS endpoint, and configure GAES_FACE_SERVICE_URL and
   GAES_FACE_SERVICE_KEY on the existing Netlify backend. Redeploy the preview.
   Merely copying the ZIP to the web repository does not launch the Python engine.
5. Check connections. Register a staff member with or without an account, use the
   master lounge assignment, submit photos, and approve reference enrollment.
6. Choose orientation/video/map. Prepare one consented 1:1 identity session in
   operator/check-in controls, then open the lounge display. Camera permission
   is required. The display has no guest controls; Escape returns the operator.
7. UAT the actual device/camera, account scopes and Firebase Storage before use.

## First-stage status
The real local engine detects faces, enrolls references and compares against one
claimed identity. Liveness is NOT implemented, so a successful comparison shows
“Face matches the reference — staff confirmation required.” It does not authorize
an unattended gate. Passenger integration and physical gate are also pending.
There is no passive search to identify every person arriving at the lounge.

## Rollback
Restore the backed-up source and deploy through the existing pipeline. Retain
new enrollment metadata/photos/encrypted references according to the operator's
retention and recovery process. Do not reset Firebase or delete the database.

Details: docs/SEAMLESS_OPERATIONS.md and face-service/README.md.
Executed checks and limits: TEST_REPORT.md.
