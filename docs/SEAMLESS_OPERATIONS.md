# Seamless Access — operational UI and staff enrollment

This release supersedes the simulator-first UI in the previous Seamless delta.
It extends the existing Next.js app; it does not replace Firebase Auth, the data
masters, existing document verification, the signage player, or the lounge map.

## Available application behavior

- Lounge/Tenant Access still contains two options: document verification and
  Seamless Access. Seamless is available to Super Admin, Admin, HO Admin,
  BO Admin, Lounge Officer and Lounge Manager, with existing location scope.
- Seamless has Operations & lounge display, Staff registration (HO only), and
  Access activity tabs. Station dropdowns use the station master `code`, not
  document IDs. Lounge labels show names, not stored assignment IDs.
- The lounge display is a fullscreen overlay within the authenticated portal.
  It loops a selected active Video from the existing signage Content Library,
  or shows a branded welcome screen. Video remains muted for browser autoplay.
- A published layout is selected for the exact lounge. QR links use the
  existing `/lounge-map/[id]` route. No invented map or placeholder QR is used.
- The guest claims a single identity using a check-in session reference or
  employee number/card and confirms consent. The server binds a 120-second
  session to that reference, operator and lounge. Camera access is explicit.
  Capture follows after three seconds once the camera is ready. There is no
  ambient face search, passive identification, or 1:N matching.
- The guest sees a welcome only when identity, liveness, entitlement/staff
  authority and physical gate acknowledgement succeed. An accepted command
  alone cannot produce an “open confirmed” screen. Staff results omit employee
  numbers, IDs, photographs and passenger map QR. Passenger names are reduced
  to the first component. Results clear and return to standby after 16 seconds.
- ID/EN uses explicit React translations. The existing portal language switch
  controls this module; the self-enrollment page also has its own switch.
  The portal's legacy DOM translator skips this module to avoid modifying text
  managed by React. Other portal translation behavior is unchanged.

## Staff registration and permissions

Only active Super Admin, Admin and HO Admin accounts with `station: ALL` and
without a pending password change may manage registration/enrollment. The
backend enforces this independently of the UI. Branch-scoped administrators
cannot register, approve, deactivate, list staff or issue enrollment links.

Select an existing active operational account from User & Role. This release
adds access registration to that account and does not create another login or
identity directory. Create missing login accounts through the existing module.

Fields: name, unit, employee number, station and authorized lounge. Station must
match the account; Lounge Officer/Manager scope must match its assigned lounge.
Changing station remains part of the existing User & Role assignment process.
Employee number reservations are transactional. Old reservations prevent
reassignment; replaced numbers cannot act as a current identity credential.
Saving registration invalidates previous invitations and activation, requiring
review again. Deactivation remains possible after an account becomes inactive.

Photo sources:

1. Upload JPEG, PNG or WebP, up to 1 MB. The server stores bytes in the existing
   Firebase bucket under `staff-enrollment/<uid>/<owner>/<random-object>`.
2. Capture a photo using the browser camera.
3. Enter folder and filename under `private/staff-enrollment/` in a PRIVATE
   repository. The server reads only files in this directory, rejects traversal
   and symlink escapes, validates file signatures and imports into the same
   restricted bucket. It does not fetch arbitrary GitHub URLs. Public GitHub
   repositories and the `public/` directory must not contain personal photos.

Photo submissions become `PendingReview`, never automatically `Active`. Admin
review can display a two-minute signed photo URL. No public Firebase download
token is generated. Activation calls the approved enrollment provider and
requires its verified reference. Uploading a photograph is not biometric
verification or identity proof on its own.

## Guided self enrollment

The administrator generates a single-use link valid for 24 hours. Share it
privately; the application does not send it to another person. The token is
random (256 bits), appears only in the URL fragment, and is removed from the
address bar after initialization. Its SHA-256 hash is stored server-side.
A new invitation revokes the previous one. Revoking the staff access or the
issuing administrator also invalidates the link.

The page shows the intended staff name/station, obtains confirmation, captures
front/right/left photos and submits for review. A transaction consumes the
invitation once. It cannot change identity, station or lounge assignments.
Guided poses are image collection instructions; they are NOT a certified
liveness check. A refresh after token removal requires reopening an unused
original link, or asking for a new one if already submitted/expired.

Camera tracks stop when closed or unmounted and after verification capture.
Browser HTTPS/camera permissions are required. Captures for access verification
are forwarded transiently; they are not written to activity or audit logs.
Uploaded enrollment images are stored until managed by the operator's retention
process. Retakes can leave unreferenced objects; automatic retention cleanup is
not included. Configure retention and deletion procedures before real enrollment.

## Data additions (server-only unless already protected users data)

Existing: `users/{uid}.seamlessStaff` contains registration fields, photo object
paths, consent/review timestamps, invitation hash, status, active flag and an
approved provider reference. Existing Auth roles, station/lounge assignments,
account active flags and other profile fields are unchanged.

New collections use existing default-deny Firestore behavior:

- `seamlessEmployeeNumbers/{hash}` — unique employee number owner.
- `seamlessEnrollmentLinks/{hash}` — subject, issuer, expiry, consumption.
- `seamlessDisplaySettings/{loungeId}` — selected video/layout references.
- `seamlessVerificationSessions/{random}` — scoped 1:1 reference, expiry/status.
- `seamlessAccessLocations/{loungeId}/attempts/{hash}` — access/gate result.

All mutations go through `seamless-operations`, using the existing authentication,
rate limiter and audit writer. Existing Firestore and Storage rules are unchanged.
These new paths have no client allow rule. Storage Admin SDK access uses the
existing service credential, with all permissions enforced before every action.
Audit records omit photos, tokens and biometric provider references. Session and
activity records require an agreed retention policy before production operation.

## Biometric and gate integration: explicit remaining dependency

**No live biometric, passenger identity or gate provider was supplied.** The
shipped `lib/seamless/provider.mjs` therefore exports unavailable adapters and
all integration status flags are false. This is deliberate fail-closed behavior;
the guest UI has no simulator selector and cannot manufacture a live approval.
The old `seamless-access` DEMO endpoint, fixtures and tests remain isolated for
regression/reference; the new operational UI does not call that endpoint.

An approved integration must implement the following LOCAL adapter interface;
these signatures are not a fabricated vendor HTTP API:

- `configured`, `entitlementConfigured`, `gateConfigured`: actual readiness.
- `resolveClaim({credential,loungeId,station,mode,signal})`: resolve an opaque
  check-in credential to exactly one authenticated/enrolled passenger identity;
  return `subjectKey`, `referenceId`, `category: Passenger`, minimal display name
  and flight. Validate the credential, reference provenance and consent. Passport
  reference photos must originate from an approved document/identity process;
  this release does not scrape passports or treat a photo as an authentic document.
- `enroll({subjectKey,photos,consentAt,mode,signal})`: validate enrollment and
  return `{verified:true,referenceId}` only after the approved workflow succeeds.
  `photos` contains restricted Storage object paths. The provider needs a secure
  server-side mechanism to read these objects; never turn them into public URLs.
- `verifyOneToOne({sessionId,referenceId,subjectKey,capture,consentAt,mode,signal})`:
  return `matched`, `livenessPassed`, and the same `sessionId`/`referenceId`.
  The provider must enforce genuine session-bound liveness/anti-replay. If its
  SDK requires an interactive challenge/video, integrate that SDK into the capture
  screen before enabling readiness; a still capture is not a liveness proof.
- `passengerEntitlement({subjectKey,loungeId,station,signal})`: use authoritative
  passenger/entitlement data and return `{eligible,subjectKey,loungeId,validUntil}`,
  with numeric expiry in milliseconds. No hardcoded commercial eligibility.
- `openGate({idempotencyKey,loungeId,sessionId,signal})`: resolve an approved
  lounge-to-device mapping, issue a deduplicated authenticated command and return
  `{physicalOpenConfirmed,idempotencyKey,loungeId}` only after device feedback.

Each call has an eight-second deadline and cancellation signal. Align timeouts
with the approved vendor and Netlify plan. Biometric and entitlement failures
never issue a gate command. A command intention is persisted before dispatch;
ambiguous gate results are not automatically resent. A timeout returns assistance,
not a claim that the gate is closed. Hardware needs its own safety interlocks,
interruption recovery, door-open timeout and operator reconciliation. If a function
stops at Processing/GatePending, replay reports that state; it never reissues the
command. Operator reconciliation of such records is a remaining integration task.

## Environment and installation

Use the existing Firebase project, Auth and Firestore. Configure the existing
bucket name through `FIREBASE_STORAGE_BUCKET` or the existing
`NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`. No new Firebase project or public photo
rules are needed. The existing Admin service credential needs bucket write and
signed read capability. Real bucket permissions and signed URLs still need UAT.

The Netlify configuration adds only the private enrollment asset inclusion for
this Function and no-store/no-referrer headers for the enrollment page. Keep the
existing Next.js plugin, build command, functions directory and environment.

Install the cumulative delta at the repository root containing package.json and
netlify.toml, not under the archived `source/` copy. Update the current PR, let the
existing pipeline run `npm test`, and test its Deploy Preview while signed in.
Merging the PR alone is not evidence of a successful deployment. No automatic
merge, deploy or production database operation was performed here.

## Checks and limitations

See TEST_REPORT.md for executed checks. Browser checks use actual React components
and the actual orchestration with explicit Auth/Firestore/Storage/provider/device
behavior doubles and generated camera frames. They do not demonstrate real-person
face matching, Firebase production permissions, passport authenticity or a gate.
