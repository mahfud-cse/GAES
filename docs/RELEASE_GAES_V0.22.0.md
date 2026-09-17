# Garuda Access Entitlement System v0.22.0

## Patch scope

This is an incremental GitHub patch for the deployed v0.21.0 source. Copy the patch contents to the repository root and replace files with the same paths.

## Changes

- Restores the Garuda Indonesia logo on the sign-in page and application header by placing the required public assets at the repository root.
- Keeps Firebase authentication in local browser persistence and prevents the sign-in page from flashing while an existing session is restored.
- Stores the active main page and submenu in the URL so refresh returns to the last page.
- Converts sidebar navigation into real links that support browser open-in-new-tab, open-in-new-window, and copy-link actions.
- Adds consistent hover feedback for interactive buttons.
- Standardizes Master Station, Master Airline, User & Role, and Access Entitlement actions.
- Adds manual create/update, template download, and CSV/XLSX upload for Station and Airline data.
- Adds template download and CSV/XLSX upload for Access Entitlement data.
- Adds contextual success dialogs after master data is created or updated.
- Adds temporary-password creation for users and requires users to replace it after their first sign-in.
- Allows Admin to create and manage non-Super-Admin accounts; only Super Admin may create or manage Super Admin accounts.
- Disables Firebase Storage initialization unless `NEXT_PUBLIC_FIREBASE_STORAGE_ENABLED=true`.
- Ensures modals retain two-direction scrolling when their content exceeds the viewport.

## Deployment notes

1. Upload every file and folder in this patch to the GitHub repository root.
2. Deploy `firestore.rules` to the GAES Firebase project because Admin user-list access changed.
3. Add `NEXT_PUBLIC_FIREBASE_STORAGE_ENABLED=false` to Netlify until Firebase Storage is activated.
4. Do not change existing Firebase service-account environment variables.
5. Trigger one Netlify production deploy after the GitHub commit is complete.

## Validation

- `npx tsc --noEmit`: passed.
- `npx next build`: passed using Next.js 16.2.6.
- ESLint: no errors; existing non-blocking warnings remain for seed constants and standard image elements.
