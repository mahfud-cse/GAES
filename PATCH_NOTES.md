# Patch Notes

## Patch 4 — Passenger Experience & Advanced Facility

### Shift Handover interface correction

- The Offline Continuity Pack button no longer stretches to the combined height of the station label and selector on desktop.
- Its desktop height now follows the shared control-height foundation.
- On mobile, the control remains full-width with a touch-safe height.
- The correction is scoped to the continuity header and does not override button sizing across unrelated pages.

### Passenger access-aware lounge map

- Lounge areas can now be assigned to one or more passenger access profiles: All Guests, Business Class, First Class, GarudaMiles Platinum, SkyTeam Elite Plus, and VIP/CIP.
- Existing areas without access metadata remain backward compatible and are treated as All Guests.
- The public passenger map includes a `Your Access / Akses Anda` selector and only exposes common areas or areas available to the selected passenger profile.
- A QR location remains visible as `You Are Here` even when the passenger changes their service filter.
- Area detail panels show the access profiles applicable to that facility.

### Access-aware QR and passenger links

- Administrators can select both the physical QR location and passenger access profile before generating a passenger-map QR.
- The generated QR, Open Passenger View link, and copied link carry the selected location and access profile.
- Passenger access information is sanitized by the public backend before being returned to an unauthenticated map visitor.
- No passenger identity or visitor record is exposed through the public map.

### Mobile passenger experience

- The passenger map now provides a Share action using the phone's native share sheet when supported, with clipboard fallback.
- Search, service category, and passenger access controls are grouped into one responsive filter panel.
- The previous instructional sentence has been repositioned inside the filter panel so it remains connected to the controls on desktop and mobile.
- Existing marker stability, mobile bottom sheet, photo carousel, full-screen photos, bilingual display, and route line remain intact.

## Deployment

1. Copy only the files contained in this delta to the same repository paths.
2. Push the repository so Netlify rebuilds the application and Netlify Functions.
3. No Firebase Rules deployment is required for Patch 4.
4. No Firebase data migration or new composite index is required.
5. Existing published areas automatically use `All Guests` until their access profile is edited and saved.

## Verification

- 11 logic tests passed.
- 40 UI/security regression tests passed.
- ESLint completed with 0 errors; 24 pre-existing warnings remain.
- Next.js production build completed successfully for `/`, `/player`, and `/lounge-map/[id]`.
