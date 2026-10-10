# Patch Notes

## Scope

- Lounge/Tenant Access now displays **Final Destination** in Steps 2–3. Scan results remain read-only; manual entry uses the airport reference list.
- Multi-leg data keeps the active flight segment for schedule validation while storing the last encoded destination separately.
- Eligibility wildcard follows the operational rule: a final indicator beginning with `Y` is eligible (`Y`, `YS`, `Y1`, and similar values).
- Access-denial messages use professional service language and no longer expose the technical `Y` indicator rule to passengers or officers.
- Camera scan requests higher resolution and continuous focus, provides torch/zoom controls when supported, and adds still-image decoding at 0°, 90°, 180°, and 270° with a contrast-enhanced retry.
- Visitor upload accepts the official report headers, the previous template headers, and common aliases.
- Visitor export uses the official header order: separate First/Last Name, Flight Origin/Destination, Guest Name, and the remaining reconciliation fields.
- Spreadsheet support is loaded statically to avoid an upload-only dynamic chunk failure. The application error page now identifies stale deployment chunks and offers **Muat Versi Terbaru**.
- Output Groups now provide group-level remote commands. Commands fan out to enrolled devices and retain per-device Pending/Executed/Failed/Expired acknowledgement monitoring.
- Master Lounge/Tenant now separates Facility Type, Operational Status, and computed Agreement Validity (Valid, Expiring Soon, Expired, Not Yet Valid, Invalid Data).
- Master Lounge/Tenant, Station, and Airline tables support column sorting. Existing data can be downloaded separately from upload templates for Lounge/Tenant, Station, Airline, User & Role, and Access Entitlement.
- Added **Lounge Layout & Service Map** for uploading an existing lounge floor plan as the map background, with URL fallback, interactive service points, operational status, service tags, area photo galleries, passenger preview, publication control, location-specific QR codes, and a public mobile passenger page.
- Passenger QR links can identify the current zone (`You are here`). Selecting another facility draws a simple visual direction line and opens its service/photo information.
- Login data recovery now sanitizes user profiles, notifications, activity logs, and dashboard configuration before rendering. A malformed legacy record is skipped or given a safe fallback instead of taking down the whole page.
- The recovery page now exposes a safe copyable diagnostic code and the actual client-render error message. It no longer labels every application failure as a Firebase data-format problem.
- Responsive rules were consolidated for facility tabs, display controls, output groups, dialogs, tables, layout editor, photo galleries, and the public passenger map.

## Deployment

1. Upload the delta files to the same repository paths.
2. Deploy `firestore.rules` and `storage.rules` because the patch adds the `loungeLayouts` collection and `lounge-layouts/` storage path.
3. Ensure Firebase Storage is enabled to upload denah and photos through the webapp. Before Storage is enabled, local UAT assets can be placed under `public/lounge-layouts/` and referenced as `/lounge-layouts/file-name.png`.
4. Keep the existing Netlify Firebase environment variables. The public passenger view is served through `/.netlify/functions/public-lounge-layout` and only returns layouts marked **Published**.
5. No new Firestore composite index is required.

## Verification

- Logic tests cover normalization, visitor data, room operations, display health, and the `Y*` eligibility wildcard.
- UI regression tests cover the canonical UI foundation, mobile dialogs, hover contrast, booking, display player, output routing, quick announcements, visitor bundle upload, and portrait signage.
- ESLint completes with zero errors; existing baseline warnings remain unchanged.
- The production Next.js build completes successfully, including `/lounge-map/[id]`.
