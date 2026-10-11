# Patch Notes

## Patch 1 — Operational Stability & Security

### Authentication and public endpoints

- Firebase ID tokens remain separated from Netlify Deploy Preview authorization through `X-Firebase-ID-Token`.
- Username resolution, password reset requests, and initial Super Admin setup now have server-side rate limits.
- Initial setup token comparison uses constant-time comparison, validates bootstrap input, and rolls back the Firebase Auth account if the Firestore bootstrap commit fails.
- Global security headers now include HSTS and a restrictive Permissions Policy while retaining camera access for same-origin boarding-pass scanning.

### Role and station enforcement

- Airline Coordinator and Airline Verifier are station-scoped, as confirmed for this patch.
- BO Admin, Lounge Officer, Lounge Manager, Airline Coordinator, and Airline Verifier can no longer be created or updated with station `ALL`.
- Firestore `sameStation` no longer treats `ALL` as globally trusted for every role. Only approved HO/global roles receive cross-station scope.
- Visitor creation validates role, station, assigned lounge, selected lounge master, eligibility, and identity on the server.

### Visitor data integrity

- Direct Firestore create/update/delete access to `visitors` is closed. All mutations must pass audited backend functions.
- New visitor payloads are allow-listed and server-owned statuses are forced to their safe initial values.
- Visitor updates use an editable-field allow-list, preserve the original station, protect workflow statuses, validate lounge moves, and re-check duplicate passenger identity.
- Evidence resubmission returns the visitor to Pending verification without allowing the browser payload to forge an Accepted/Final status.

### Evidence protection

- Evidence Storage access now checks the visitor record, user role, and station scope.
- New evidence uploads store the protected Firebase Storage path instead of persisting a public download-token URL.
- Direct client access to security rate-limit records is denied.

### Audit trail

- Every recognized boarding-pass scan now records `BOARDING_PASS_READ` with the signed-in user, role, station, lounge, passenger/flight target, and scan source.
- Accepted, rejected, created, updated, imported, deleted, notification, room, and display events continue using their existing server-owned audit records.

## Deployment

1. Copy only the files in this delta to the same repository paths.
2. Push the repository so Netlify rebuilds the application and Functions.
3. Deploy both Firebase rule files from the project root:

   ```bash
   firebase deploy --only firestore:rules,storage
   ```

4. Existing station-bound Airline accounts configured as `ALL` must be assigned a valid three-letter station code before they are edited again.
5. No Firebase data migration or new composite index is required.

## Verification

- 11 logic tests passed.
- 37 UI/security regression tests passed.
- ESLint completed with 0 errors; 24 pre-existing warnings remain.
- Next.js production build completed successfully for `/`, `/player`, and `/lounge-map/[id]`.
