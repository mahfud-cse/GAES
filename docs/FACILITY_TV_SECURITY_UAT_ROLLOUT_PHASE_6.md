# Facility TV — Phase 6 Security, Pilot UAT & Rollout

## Scope

Phase 6 closes the first operational implementation cycle. It adds endpoint hardening, automated device-health classification, persistent pilot test results, and a controlled rollout certification gate.

This patch provides the tools to execute a CGK–DPS pilot. It does not claim that physical-device UAT has passed; operational users must record the actual results from the selected hardware.

## Security hardening

- Player requests are limited to 64 KB.
- Enrollment claim attempts are rate-limited per privacy-preserving client fingerprint.
- Invalid, expired, and previously used codes return the same generic message.
- Enrollment codes remain single-use and expire after ten minutes.
- Device credential hashes, enrollment records, and rate-limit state remain inaccessible to browsers through Firestore rules.
- `/player` receives no-store caching, restrictive referrer and permissions policies, and a player-specific Content Security Policy.
- Player content must use HTTPS.

## Automated health monitoring

`sweep-display-health` runs every minute through Netlify Scheduled Functions.

- **Healthy / Online:** heartbeat age is no more than two minutes and the player reports no error.
- **Degraded:** heartbeat age is two to five minutes, or the player reports an error.
- **Offline:** no heartbeat exists or the heartbeat is older than five minutes.

Health transitions are recorded in `displayActivityLogs`. The monitor page shows Healthy, Degraded, Offline, Not Enrolled, and Ready for Operations totals.

## Pilot UAT checks

Every pilot device has 12 required checks:

1. Secure enrollment
2. Heartbeat and health state
3. Scheduled playback
4. Channel playback order
5. Offline plan fallback
6. Play Channel Now
7. Running text overlay
8. Pause and resume
9. Remote refresh
10. Revoke and re-enroll
11. Autoplay and audio policy
12. Live TV/source compatibility

Native screenshot capability is optional. Mark it `N/A` for the browser player. It must be tested only when an Android/native companion player is used.

Each result supports `Not Tested`, `Pass`, `Fail`, or `Blocked`; the optional screenshot check also supports `N/A`. Fail and Blocked results require a test note.

## Rollout readiness gate

A device can be certified **Ready for Operations** only when:

- it is still Enrolled; and
- all 12 required checks have status Pass.

Certification requires Lounge Manager, BO Admin, Super Admin, Admin, or HO Admin. Changing any test result returns the device to `Testing` and requires recertification.

## Recommended pilot execution

### CGK

- Select one operational screen and one backup laptop or mini PC.
- Test using the actual lounge LAN/Wi-Fi, HDMI path, TV resolution, and audio connection.
- Validate at least one Live TV source and one uploaded video/image channel.

### DPS

- Repeat on a separate network and hardware profile.
- Confirm station scoping prevents DPS operators from controlling CGK devices.
- Validate timezone scheduling using the DPS station configuration.

## Rollback procedure

If a pilot device becomes unstable:

1. Revoke enrollment from Device Control Center.
2. Disable or deactivate its schedule.
3. Switch the TV to the previous local source or normal broadcast input.
4. Record the failed or blocked UAT item and investigation note.
5. Re-enroll only after the problem is resolved.

HDMI fallback remains independent from portal data; the TV can always be returned to its previous input source locally.

## Deployment requirements

- Deploy the application and `firestore.rules` together.
- Confirm Netlify Scheduled Functions are enabled for the production site.
- No new environment variable is required.
- Keep HTTPS enabled for the portal and all configured content sources.

## Production acceptance

Do not declare the TV feature operational solely because the website deploy succeeds. Production acceptance requires at least one CGK device and one DPS device to be physically tested, all required checks recorded as Pass, and rollout certification completed in the portal.
