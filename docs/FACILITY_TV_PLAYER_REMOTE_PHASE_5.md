# Facility TV Player & Remote Operations — Phase 5

## Supported devices

The web player is available at `/player` and can run on:

- a laptop or desktop browser;
- a mini PC connected to a TV through HDMI;
- an Android signage player with a modern browser; or
- a compatible Smart TV browser.

HDMI only carries picture and sound to the TV. The laptop or mini PC remains remotely controlled as long as it has LAN or Wi-Fi connectivity.

## Secure enrollment

1. Create and approve a display device in Device Control Center.
2. Select **Enroll Player** to create an eight-character one-time code.
3. Open `/player` on the target device and enter the code within ten minutes.
4. The backend creates a random device secret and stores only its hash in the backend-only `displayDeviceCredentials` collection.
5. The player stores the device credential locally and starts its heartbeat.

Enrollment codes are single use. Revoking enrollment deletes the backend credential and disconnects the player.

## Playback and schedule

- The player requests its active schedule every five seconds.
- Schedule selection uses the station timezone, operating day, date range, time range, device target, and priority.
- Channel items play in configured order.
- The most recent valid playback plan is cached locally. When the network is interrupted, the player keeps the last plan and reports **Offline cache**.
- The currently loaded media can continue during a connection interruption. Loading media that was never cached still depends on the source URL and browser cache.

## Remote commands

Authorized HO and station operators can send:

- Play Channel Now, with a 15–480 minute override duration;
- Set Running Text;
- Clear Running Text;
- Pause Screen;
- Resume Screen; and
- Refresh Player.

Commands move through `Pending` to `Executed` or `Failed`. The player remembers processed command IDs and acknowledges replays without executing them twice.

## Screenshot capability

Unattended screen capture is intentionally reported as unsupported by the browser player. Standard browser security does not allow a website to silently capture the full screen, and cross-origin Live TV or web content may also block canvas capture.

Actual screenshot capture requires the planned Android/native companion player. Device capability is reported to the portal, so the Screenshot button is disabled rather than pretending that a browser screenshot was taken.

## Browser deployment notes

- Use a modern Chromium-based browser in kiosk/fullscreen mode for laptop or mini PC pilots.
- Browser autoplay rules may block audio after a restart. For a managed kiosk, configure the browser's autoplay policy or perform one local user interaction after launch.
- Live TV and Web URL sources must permit embedding. Sources that send `X-Frame-Options: DENY` or restrictive CSP headers cannot be displayed in an iframe.
- Use HTTPS for the portal and all content sources.

## Collections

- `displayEnrollments` — backend-only one-time enrollment records.
- `displayDeviceCredentials` — backend-only hashed player credentials.
- `displayCommands` — remote commands and acknowledgment status.
- `displayActivityLogs` — enrollment, command, and player audit trail.

## UAT pilot

Pilot with one CGK device and one DPS device:

1. Generate and claim separate enrollment codes.
2. Verify Online/Offline status and heartbeat.
3. Verify scheduled channel playback and item sequence.
4. Disconnect the network and confirm the last plan remains visible.
5. Test Play Channel Now and verify override expiry.
6. Test running text over video or Live TV.
7. Test pause, resume, and refresh.
8. Verify every command becomes Executed or Failed and is not repeated.
9. Revoke enrollment and confirm the player can no longer authenticate.
