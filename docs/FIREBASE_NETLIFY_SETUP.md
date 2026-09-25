# GAES — Firebase & Netlify Setup

## 1. Upload patch to GitHub

Copy every file in the patch while preserving its folder path. Commit `package.json` and `package-lock.json` together. Do not upload `.env` or Firebase service-account JSON.

## 2. Firebase target project

Use project `gaes-5d8c3`, Firestore region `asia-southeast2`, production mode, and Email/Password Authentication. Deploy `firestore.rules` and `storage.rules` with Firebase CLI or the Firebase console.

## 3. Netlify environment variables

Create every variable listed in `.env.example` in **Netlify → Site configuration → Environment variables**. Public web configuration uses `NEXT_PUBLIC_FIREBASE_*`. Both service-account private keys stay in Netlify only.

Project IDs and `NEXT_PUBLIC_FIREBASE_*` values are expected to appear in the browser bundle and are listed in `SECRETS_SCAN_OMIT_KEYS` inside `netlify.toml`. `FIREBASE_PRIVATE_KEY`, `SOURCE_FIREBASE_PRIVATE_KEY`, and `INITIAL_SETUP_TOKEN` remain scanned and must never be committed.

For the source project, create a dedicated service account with read-only access to:

`portalData/lounges/records/{documentId}`

and the Airport/Station master collection. The synchronization function checks
these default paths in order:

- `portalData/airports/records/{documentId}`
- `portalData/stations/records/{documentId}`
- `portalData/network-stations/records/{documentId}`

If the source portal uses another path, add this optional Netlify variable:

`SOURCE_FIREBASE_STATIONS_PATH=your/source/collection/path`

The lounge path can also be overridden when needed:

`SOURCE_FIREBASE_LOUNGES_PATH=your/source/collection/path`

Never commit either service-account JSON file.

## 4. Initial Super Admin

Set a long random `INITIAL_SETUP_TOKEN`, deploy, then call the one-time endpoint:

```bash
curl -X POST https://YOUR-SITE.netlify.app/.netlify/functions/setup-superadmin \
  -H 'content-type: application/json' \
  -d '{"setupToken":"YOUR_TOKEN","name":"Super Administrator","username":"superadmin","email":"admin@company.example","password":"CHANGE-ME-NOW"}'
```

After success, remove `INITIAL_SETUP_TOKEN` from Netlify and redeploy. The endpoint also blocks a second bootstrap using Firestore state.

## 5. User management

Super Admin creates users in GAES. Firebase Authentication accounts are created by the Netlify backend; role/scope profiles and username mappings are stored in Firestore. The browser then requests Firebase to email a set/reset-password link. Passwords are never stored in CSV or Firestore. The upload template is `docs/templates/TEMPLATE_USER_UPLOAD_GAES.csv`.

## 6. Lounge/Tenant synchronization

Run `sync-source-lounges` from an authenticated Super Admin/Admin action. It reads Lounge/Tenant and Airport/Station data from the source project server-side and writes read-only records into GAES collections `lounges` and `stations`. Manual GAES records remain editable. Source records that disappear are retained with `SOURCE_NOT_FOUND` and `Nonaktif` status for audit history. Source credentials never reach the browser.

Multiple source agreements for the same Airport + Lounge Name + Service Type
are consolidated into one Lounge master with multiple `pricePeriods`. The DOT
selects the applicable period. The chosen price, currency, agreement, and price
period are copied into the visitor transaction so future agreement changes do
not alter historical reconciliation values.

## 7. Production checklist

- Confirm Firebase App Check and authorized domains.
- Test Firestore Rules with Emulator Suite before production.
- Confirm Netlify Functions can read both service accounts.
- Validate username login, role scoping, duplicate passenger rejection, late-scan BO queue, and audit logs.
- Schedule lounge synchronization only after data owner approval; daily sync is a common default.
