# Patch Notes

## Patch 3 — Shift & Business Continuity

### Shift handover workflow

- Facility & Room Operations now includes a dedicated `Shift Handover` tab.
- The outgoing shift records the shift date, shift name, receiving officer/shift, operational summary, and priority or escalation notes.
- A mandatory continuity checklist covers rooms, bookings, cleaning, maintenance, incidents, display Players, active announcements, offline preparation, and escalation contacts.
- An unfinished handover draft is retained locally in the current browser so an accidental refresh does not erase the operator's work.
- Only one Pending handover can exist per station. A server-side transactional station lock prevents simultaneous submissions from creating parallel pending handovers.

### Incoming shift acknowledgment

- Pending handovers are presented separately to the incoming shift.
- A non-administrator cannot acknowledge a handover using the same account that submitted it.
- The receiving shift can add an initial follow-up note before acknowledgment.
- Submission and acknowledgment create immutable backend-owned Room Activity records.
- The handover register retains the outgoing user, intended recipient, acknowledgment user, time, status, and operational snapshot.

### Continuity snapshot and offline pack

- The continuity dashboard summarizes occupied and cleaning rooms, open maintenance, open incidents, enrolled/offline Players, active announcements, and pending commands.
- The authoritative snapshot stored with the handover is recalculated by the backend from current station data; browser-supplied totals are not trusted.
- Operators can download an Offline Continuity Pack in XLSX format containing the current summary, active bookings, open incidents, display device state, and recent shift history.
- The layout is responsive for desktop and mobile and uses the consolidated UI foundation.

## Deployment

1. Copy only the files contained in this delta to the same repository paths.
2. Push the repository so Netlify rebuilds the application and Netlify Functions.
3. Deploy the updated Firestore Rules from the project root:

   ```bash
   firebase deploy --only firestore:rules
   ```

4. No Firebase Storage Rules deployment is required for Patch 3.
5. No Firebase data migration or new composite index is required.

## Verification

- 11 logic tests passed.
- 39 UI/security regression tests passed.
- ESLint completed with 0 errors; 24 pre-existing warnings remain.
- Next.js production build completed successfully for `/`, `/player`, and `/lounge-map/[id]`.
