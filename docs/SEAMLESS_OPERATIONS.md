# Seamless Access V3 — first-stage local engine and UX correction

This is the current implementation guide. Earlier simulator and V2 descriptions
are historical. The existing Next.js app, Firebase project/Auth, master data,
permissions and document-verification workflow are preserved.

## Changes requested and delivered

1. Main tabs use exactly the portal's `subTabs facilityTabs` contract: same pill
   buttons, typography and navy hover/active state. Shared global CSS is unchanged.
2. “Open lounge display” opens a display-only full viewport portal, outside the
   application content/animation container. Camera activation starts immediately
   (the browser still needs the device's camera permission). The display has no
   guest buttons, login form, identity entry or passenger/staff selector. The
   operator exits with Escape. Landscape and portrait are selectable and saved.
3. Camera capture remains available under the idle advertisement/welcome screen.
   An anonymous face-count detector switches video to the camera. Only an already
   prepared single-identity session can be verified; a face by itself does not
   cause a database identity search. No 1:N identification is implemented.
4. A valid face match without evaluated liveness shows “Face matches the
   reference” and requests staff confirmation. It cannot show an open gate or
   authorize unattended entry. Passenger welcome/map results still require the
   full identity/liveness/entitlement/gate acknowledgement chain.
5. Registration is available to HO administrators and BO Admin within its own
   station. Other operational roles do not gain registration privileges. The
   server rechecks this scope, including the issuing manager of self-enrollment.
6. Staff no longer need a portal login. The optional account picker uses the
   existing `users` User & Role master and retrieves all pages, including active
   roles previously excluded. Optional search filters names/roles. It does not
   create a Firebase Auth user. A linked account's deactivation blocks sessions.
7. Lounge assignments are only existing active master IDs passed from the same
   portal lounge dataset and revalidated against the server's `lounges` collection.
   There is no text field for creating a lounge and no fake master data.
8. Photo attachment, camera capture and private-repository import remain supported
   after saving registration. Self enrollment also works for staff without login.
9. Activity opens with no selected lounge. Its own station/lounge filters control
   loading and clear previous results, so an inherited lounge name cannot appear
   as an unexplained page heading. Empty, loading and no-match states are explicit.
10. ID/EN is implemented for revised fields, guidance, errors and the display.

## Identity session flow

Operator/check-in controls are separate from the display. They prepare one
consented reference/session, bound to actor, lounge and a two-minute expiry.
A single pointer in `seamlessDisplayQueue` identifies that lane's prepared
session. Another authenticated portal tab can prepare the next session while
its display stays open. Do not replace the lane's session while another person
is being verified. Future trusted card/check-in device events can use the same
claim action; they do not need any on-screen guest controls.

The display performs anonymous presence detection only, then submits the
captured image against that one reference. The existing request reservation and
idempotency protections handle retry. Results clear automatically after ten
seconds. Camera tracks stop on exit/unmount. If camera permission or engine
connectivity is unavailable, the display reports that state; no success is
invented. Model inference and advertising never read arbitrary identity records.

## Registration data and compatibility

Existing `users/{uid}.seamlessStaff` enrollment is listed and edited in place.
Independent staff are stored under `seamlessStaffProfiles/stf-...` with profile
fields and an optional `accountUid`; this is not an Auth/login identity. Their
schema mirrors the existing enrollment envelope. No existing staff data is
copied/deleted. Registration changes clear activation and invitations for review.

Employee-number uniqueness uses the existing transactional reservation
collection. Optional links are reserved in `seamlessStaffAccountLinks` to prevent
one portal account being associated with two registrations. Removed/changed
credential reservations are retained to avoid accidental reassignment; only the
current employee number can initiate a face session.

New `registry-*` actions implement scoped registration. Historical HO-only staff
actions remain for compatibility; the current UI uses the registry actions.
Modern self-enrollment links use a `#registry:<random-token>` fragment and the
same restricted image storage. Earlier V2 links without that prefix remain on
the legacy flow. Tokens are hashed in Firestore, valid for 24 hours, replaced by
new invitations, and consumed once on submission. Self enrollment cannot alter
name, station, account links or lounge assignments. Images alone do not activate
face verification; administrator review calls the real engine to enroll a reference.

Original photo objects use restricted Firebase Storage paths, never public photo
URLs. Import folder/file fields refer to `private/staff-enrollment/` in a private
repository. Server path, extension, size and image-header checks remain enforced.
The local engine obtains bytes through the backend's restricted Storage adapter.
Real production bucket permissions and signed-photo reads still require UAT.

## Start the project-owned engine

The ZIP now includes `face-service/`, executable Python code, ONNX models,
licenses/checksums, Docker recipe, requirements and tests. It is a real local
inference implementation rather than an unavailable adapter or cloud biometric
API. It compares a single reference and has no identity-search endpoint.

**Deploying the web ZIP alone does not start the Python process.** Run the engine
on infrastructure controlled by your organization, publish an authenticated TLS
endpoint reachable by the existing Netlify backend, then set only server-side:
- GAES_FACE_SERVICE_URL
- GAES_FACE_SERVICE_KEY

The engine also needs GAES_FACE_ENCRYPTION_KEY and persistent private storage for
its encrypted references. Full instructions and commands: `face-service/README.md`.
Do not put these secrets in NEXT_PUBLIC_* or source control. The identity status
uses a real /health check, so it remains unavailable until the process is reachable.
The corporate workstation does not need Node/Netlify CLI to update the current PR.

## Operational limits of first stage

Real-model detection, enrollment and comparison have been tested. Liveness/
presentation-attack detection is not implemented or certified, and the service
always returns livenessPassed=false. A photo/video may produce a facial match;
this is why a match alone does not authorize a gate. The default threshold 0.5
is not a production accuracy guarantee and needs representative calibration.
Passenger identity/entitlement integration and physical autogate feedback are
still not connected. No fake passenger data or physical gate result is substituted.

The engine encrypts reference embeddings; source enrollment photos remain in
Firebase Storage. Retirement/deletion and orphan-photo cleanup must follow the
operator's retention process. No production database change, deployment or gate
action was performed during this work. See TEST_REPORT.md for exact test scope.
