# Facility TV & Digital Signage — Phase 4

## Scope

Phase 4 provides the administration layer for TV and digital signage content. It prepares what a screen should show and when it should show it. Device enrollment, command delivery, acknowledgment, screenshots, and remote override remain in the player-integration phase.

## Content Library

Authorized HO administrators can create four content types:

- Live TV
- Video
- Image
- Web URL

Content may use an HTTPS source URL. Video and image files can also be uploaded to Firebase Storage when the existing Storage integration is enabled. Supported upload formats are JPG, PNG, WEBP, MP4, and WEBM, with a 200 MB maximum file size.

Content can be network-wide (`ALL`) or limited to one station. Only active content can be placed in a channel.

## Channels

A channel is an ordered playlist of active content. The channel stores content references rather than duplicate media. A channel cannot be deleted while an active schedule is using it, and content cannot be deleted while it is referenced by a channel.

## Display schedules

A schedule defines:

- station;
- channel;
- one or more approved devices;
- start and end dates;
- daily start and end time;
- operating days;
- normal, high, or emergency priority;
- optional scheduled running text; and
- active or inactive status.

The backend rejects an active schedule when its date range, time range, operating day, and target device overlap an existing active schedule. Devices must be approved and belong to the schedule station.

## Access control

- Content and channels: Super Admin, Admin, or HO Admin.
- Schedules: Super Admin, Admin, HO Admin, BO Admin, Lounge Manager, or Lounge Officer, limited by station scope.
- Browser writes to `displayContents`, `displayChannels`, `displaySchedules`, and `displayActivityLogs` are denied by Firestore rules.
- Mutations are handled by `manage-display-content` and recorded in display activity logs.

## Running text

Phase 4 stores the planned running text together with the schedule. This prepares boarding, final-call, lounge, or operational messages to appear over the scheduled content. Live delivery and emergency override require the Phase 5 player and command service.

## Deployment

Deploy the application, `firestore.rules`, and `storage.rules` together. Uploaded display media uses the existing Firebase Storage configuration; URL-based content does not require Storage.

## UAT checklist

- Add URL-based Live TV content.
- Upload one test image or video when Firebase Storage is enabled.
- Create a channel with at least two content items.
- Create a schedule targeting an approved device.
- Verify a schedule with overlapping date, time, day, and device is rejected.
- Verify a station account cannot schedule a device from another station.
- Enable running text and verify it appears in the saved schedule.
- Verify a channel used by an active schedule cannot be deleted.
- Verify the calendar toolbar stays in one row on desktop and stacks cleanly on mobile.
