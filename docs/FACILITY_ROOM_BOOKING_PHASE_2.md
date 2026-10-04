# Facility & Room Operations — Phase 2 Room Booking

## Delivered scope

- Calendar views: Day, Week, Month, and List.
- Room and status filters scoped to the signed-in user's station authority.
- Draft booking and Submit for Approval.
- Approval and rejection by Super Admin, Admin, HO Admin, BO Admin, or Lounge Manager.
- Cancellation by the booking owner or an authorized approver.
- Preparation and cleaning buffers.
- Daily, weekly, and monthly recurrence, limited to 12 occurrences per request.
- Optional visitor or flight reference.
- Notifications to relevant approvers and back to the requester after a status decision.
- Audit logs for creation, draft update, submission, approval, rejection, and cancellation.

## Conflict prevention

Conflict prevention is enforced by the Netlify backend, not the browser. A Requested booking creates deterministic 15-minute lock documents in `roomBookingSlots`. The transaction fails if any required lock already exists.

- Draft does not lock a room.
- Requested, Approved, and Checked-in bookings retain their locks.
- Rejected and Cancelled bookings release their locks.
- Buffer time is included in the locked range.
- Direct client writes to `roomBookings` and `roomBookingSlots` are denied by Firestore rules.
- Every create request carries an idempotency key stored in `roomBookingRequests`, preventing duplicate records when the browser retries after a network interruption.

## Timezone handling

The browser converts station-local date and time to UTC for transport. The backend reads the authoritative IANA timezone from the station master and rejects a payload whose local date/time does not match that timezone.

## Workflow in this phase

`Draft → Requested → Approved`

Exception branches:

- `Requested → Rejected`
- `Draft / Requested / Approved → Cancelled`

`Checked-in`, `Completed`, and `No Show` are displayed in the calendar model but their operational actions will be activated in Phase 3 Room Operations.

## Deployment

Deploy the application and the updated `firestore.rules`. The new backend function is discovered from:

`netlify/functions/manage-room-booking.mjs`

No new Netlify environment variable is required; it uses the existing Firebase Admin configuration.

## UAT minimum

1. Create a Draft and confirm it does not block another request.
2. Submit a booking and confirm a second overlapping booking is rejected.
3. Repeat the overlap test against preparation and cleaning buffers.
4. Approve as Lounge Manager or BO Admin at the same station.
5. Confirm an operator from another station cannot read or manage the booking.
6. Reject and cancel with a mandatory reason, then confirm the slot can be booked again.
7. Create recurring bookings and confirm every occurrence appears on the correct local date.
