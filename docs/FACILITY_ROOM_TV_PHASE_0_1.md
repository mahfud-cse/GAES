# Facility & Room Operations — Phase 0–1

## Scope of this patch

This patch establishes the operational foundation without pretending that remote TV control is already connected.

- Main navigation: Facility & Room Operations.
- Overview: room readiness and display online/offline summary.
- Room inventory: station, room, area, capacity, facilities, and operational state.
- Display inventory: platform, connection, room mapping, approval, status, heartbeat, Now Playing, and running text.
- Device approval: available to Super Admin, Admin, and HO Admin.
- Station scope: HO/global roles can view configured stations; station roles are limited to their assigned station.
- Play Now and Request Screenshot remain disabled until the command service and player enrollment are implemented.

## Phase 0 inventory

Use the templates in `docs/templates/` to collect actual CGK and DPS data before device integration:

- `TEMPLATE_ROOM_INVENTORY.csv`
- `TEMPLATE_DISPLAY_DEVICE_INVENTORY.csv`

Do not store device passwords or Wi-Fi credentials in these templates.

## Data collections

- `rooms`
- `roomFacilities`
- `displayDevices`
- `displayChannels`
- `displaySchedules`
- `displayCommands`
- `displayActivityLogs`

The UI currently reads and manages `rooms` and `displayDevices`. The remaining collections are reserved for the next phases. Client-side writes to `displayCommands` and `displayActivityLogs` are denied; commands and logs must be created by an authenticated backend service.

## Next implementation gate

Before enabling remote controls, complete:

1. Device enrollment service with a one-time registration code and device-specific credential.
2. Player proof of concept on one CGK screen and one DPS screen.
3. Heartbeat, acknowledgment, idempotent command processing, and offline cache.
4. Backend validation for user role, station scope, target device, command priority, and expiry.
5. Now Playing and screenshot validation on the selected hardware.
