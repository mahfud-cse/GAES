# Patch Notes

## Patch 2 — Operational Control Center

### Device health and command visibility

- A device is no longer considered online only because its saved status says `Online`. A recent Player heartbeat is now required.
- The existing health thresholds remain: a delayed heartbeat becomes a warning after 20 seconds and offline after 60 seconds.
- The device monitor now includes a Recent Remote Commands ledger with Pending, Executed, Failed, and Expired summaries.
- Each command record shows the send time, target device or output group, command type, acknowledgment time, and Player result.
- Output-group commands retain their group identity, so operators can trace where a remote command originated.

### Output group control

- An active share session can now be stopped directly from its Output Group card.
- Stopping a share is not limited to the browser that originally opened it, subject to the existing backend role and station authorization.
- Device deletion is blocked when the device is still referenced by an Output Group or display schedule, preventing broken operational configuration.

### Group-based scheduling

- Display schedules can now target an active Output Group instead of selecting devices one by one.
- The backend validates that the group is active and belongs to the schedule station.
- Device membership is resolved authoritatively from the selected group when the schedule is saved.
- The saved schedule retains a device snapshot so an existing schedule remains predictable if the group membership changes later.
- Operators can edit the schedule after changing a group's membership when they intentionally want to refresh that snapshot.

## Deployment

1. Copy only the files contained in this delta to the same repository paths.
2. Push the repository so Netlify rebuilds the application and Netlify Functions.
3. No Firebase Rules deployment is required for Patch 2.
4. No Firebase data migration or new composite index is required.
5. The Firebase Rules delivered in Patch 1 must already be active before operational use.

## Verification

- 11 logic tests passed.
- 38 UI/security regression tests passed.
- ESLint completed with 0 errors; 24 pre-existing warnings remain.
- Next.js production build completed successfully for `/`, `/player`, and `/lounge-map/[id]`.
