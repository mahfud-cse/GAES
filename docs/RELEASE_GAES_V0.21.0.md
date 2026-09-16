# GAES v0.21.0 — GitHub Patch

## Implemented

- Rebrand to **Garuda Access Entitlement System**.
- Firebase Authentication login via email or username.
- Firestore real-time collections for visitor, lounge, flight, user, station, entitlement, airline, dashboard data, notifications, and audit metadata.
- Atomic duplicate-passenger prevention using Passenger + Flight + Sequence + Date of Travel.
- Explicit success, duplicate, and ineligible dialogs with an OK action.
- Late scan handling: visitor remains pending with `Melewati STD/ETD` for Branch Office verification.
- Irregular Passenger category sorted A–Z with other categories.
- Super Admin user creation/update/deactivation and CSV batch upload; passwords are not stored in CSV/Firestore.
- Firebase Storage evidence upload (PDF/JPG/PNG, maximum 10 MB through Storage Rules).
- Read-only server-side Lounge/Tenant synchronization from Ground Experience Portal.
- Adaptive daily/weekly/monthly visitor trend, dashboard drill-down, and portal-managed dashboard visibility.
- Collapsible sidebar without numerical menu prefixes.
- Scrollable modals with sticky header/actions and regular-weight input/filter text.
- Netlify Functions, Firebase/Storage Rules, environment template, and deployment guide.

## Tim IT configuration still required

These integrations cannot be activated from frontend code alone. Tim IT/data owners must provide production endpoints, authentication, field mappings, retry/timeout rules, and T&C approval:

| Integration | Current readiness | Required next action |
|---|---|---|
| Flight Schedule | Firebase master/fallback ready | Connect authoritative operational schedule API |
| Passenger List / DCS | Import fallback ready | Connect DCS/source API and denominator feed |
| GarudaMiles | Verifier workflow ready | Ancillary API contract and eligible-tier mapping |
| SkyTeam / partner airline | Scoped verifier roles ready | Per-airline API/agreement and organization mapping |
| EMD / Paid Access | Evidence/manual workflow ready | Redemption/payment endpoint and settlement rules |
| Notification email | In-app read state ready | Approved email provider/template if server delivery is required |

## Important deployment order

1. Upload all patch files while retaining their paths.
2. Configure Netlify variables from `.env.example`.
3. Deploy Firestore and Storage Rules.
4. Deploy the site and create the one-time Initial Super Admin.
5. Remove `INITIAL_SETUP_TOKEN`, redeploy, then test every role.
6. Run the Lounge/Tenant source sync only after source-project service-account access is approved.
