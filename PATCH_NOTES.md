# Seamless Access V2 — cumulative delta

## Outcome
Replaces the simulator-first Seamless UI with a scoped operations workspace,
fullscreen lounge display, HO staff registration, private photo collection,
guided self enrollment and explicit ID/EN support.

The two access paths remain: Access Verification (existing boarding pass/QR/
manual workflows) and Seamless Access (claimed identity + 1:1 face workflow).
The lounge screen no longer exposes admin forms, document IDs or demo scenarios.

## Important integration status
Registration, photo storage workflows, invitations and UI are implemented.
Live face verification, liveness, passenger entitlement and physical gate remain
UNCONNECTED until approved integration contracts/SDKs and device mapping are
provided. The operational screen never uses simulated approvals. A photo upload
alone does not activate face access. See docs/SEAMLESS_OPERATIONS.md.

## Installation in the current PR
1. Back up the current branch. This ZIP is cumulative against GAES-V-22.2(1).zip
   and includes the earlier Seamless delta at its latest state. It can also replace
   those files on the prior Seamless branch; do not apply the older delta afterward.
2. Extract into the actual repository root containing package.json, app/, lib/
   and netlify.toml. Do not extract into source/ or upload the ZIP as a static site.
3. Review the package manifest. No existing files are deleted. Existing Firebase
   initialization/configuration, Firestore rules and Storage rules are preserved.
4. Push to the PR and let the existing Netlify pipeline run npm test/build.
   No Node/Netlify CLI installation on a corporate laptop is required for this.
5. Open the PR Deploy Preview and sign in. Choose Lounge/Tenant Access →
   Seamless Access. Verify master station options, select lounge, select a signage
   library video and published map, save settings, and open the lounge display.
6. As an active HO administrator (station ALL), select Staff registration,
   register an existing operational account, and upload/capture/import a photo
   or generate a private self-enrollment link. Real private photo collection
   requires your existing Firebase Storage bucket and permission UAT.
7. Do not activate provider readiness flags to conceal missing integrations.
   Connect the approved provider implementation and hardware, then perform live
   UAT before enabling operational access.

## Rollback
Restore the backed-up source files and deploy through the existing pipeline.
Do not delete Firestore or reset Firebase. New metadata is isolated; preserve
photos and logs according to the operator's retention and rollback procedures.
No destructive data migration or live production change was run.

Detailed behavior, permissions, adapter interface and remaining integration
requirements: docs/SEAMLESS_OPERATIONS.md. Executed validation: TEST_REPORT.md.
