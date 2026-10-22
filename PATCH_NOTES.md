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
