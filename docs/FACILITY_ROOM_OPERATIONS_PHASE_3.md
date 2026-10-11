# Facility & Room Operations — Phase 3

## Scope

Phase 3 activates the operational workflow after a room booking is approved. It also refines the Facility & Room Operations layout for desktop and mobile without changing the Phase 2 booking rules.

## Operational workflow

1. **Approved booking → Check-in**
   - Operator completes the room readiness checklist.
   - A supervisor override reason is required when the checklist is incomplete or the action is outside the operational window.
   - The booking becomes `Checked-in` and the room becomes `Occupied`.
2. **Checked-in → Check-out**
   - Operator records handover recipient, handover note, and any issue summary.
   - The booking becomes `Completed` and the room becomes `Cleaning`.
3. **Cleaning → Available**
   - All cleaning completion items are mandatory.
   - Booking slot locks are released only after cleaning completion.
   - The room becomes `Available`.
4. **No Show**
   - Lounge Manager, BO Admin, or HO administrator records a mandatory reason.
   - The booking becomes `No Show` and its slot locks are released.
5. **Move Room**
   - Available only for an `Approved` booking before check-in.
   - The backend validates station, capacity, room state, and time conflicts before moving the slot locks.
6. **Maintenance**
   - A supervisor can place a non-occupied room into `Maintenance`.
   - A completion resolution is mandatory before returning it to `Available`.
7. **Incident**
   - An operator can report a room incident with category, severity, and description.
   - Incident and activity records are created by the backend.

## Access and integrity

- All operational mutations go through `manage-room-operation` and Firebase Admin.
- The browser has read-only access to `roomOperations`, `roomMaintenance`, `roomIncidents`, and `roomActivityLogs` within the user's role and station scope.
- Firestore rules reject direct browser writes to these four collections.
- Maintenance and incident creation use stable request IDs to avoid duplicate records when a request is retried.
- Backend transactions protect room and booking state transitions.

## UI refinement

- Facility tabs use one consistent segmented navigation style.
- KPI cards use an adaptive grid instead of a fixed five-column layout.
- Calendar controls are grouped in a bordered toolbar and collapse cleanly on mobile.
- Room Operations uses separate sections for active bookings, cleaning, maintenance, incidents, and activity history.
- Operational dialogs are width constrained and use single-column context on mobile.
- The active palette remains navy, white, and neutral; no teal/tosca colors or `!important` declarations are introduced.

## Deployment

Deploy the application and the updated `firestore.rules` together. No new environment variable is required.

## UAT checklist

- Approve a test booking and complete check-in with all readiness items.
- Verify the booking is `Checked-in` and the room is `Occupied`.
- Check out the same booking and verify the room enters `Cleaning`.
- Confirm incomplete cleaning cannot be submitted; complete all items and verify the room becomes `Available`.
- Test No Show and Move Room using a supervisor account.
- Start and complete maintenance, verifying the room state at each step.
- Report an incident and verify it appears in Open Incidents and Activity Log.
- Verify a station-scoped account cannot see another station's operation records.
- Verify the layout at desktop, tablet, and 320 px mobile width.
