import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("keeps one canonical UI foundation without specificity overrides", async () => {
  const css = await read("../app/globals.css");
  assert.equal((css.match(/:root\s*\{/g) ?? []).length, 1);
  assert.doesNotMatch(css, /!important/);
  assert.doesNotMatch(css, /width\s*:\s*minmax\(/);
  assert.match(css, /--font-ui:/);
  assert.match(css, /--control-height:/);
  assert.match(css, /--touch-target:/);
  assert.match(css, /--z-modal:/);
});

test("keeps shared buttons and mobile-safe modal constraints", async () => {
  const css = await read("../app/globals.css");
  assert.match(css, /button,\s*\n\.uploadButton\s*\{/);
  assert.match(css, /max-height:\s*calc\(100dvh - 24px\)/);
  assert.match(
    css,
    /\.modalActions > button,[\s\S]*?min-height:\s*var\(--touch-target\)/,
  );
  assert.match(
    css,
    /\.modal \.form,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
});

test("rejects teal UI colors, including the sign-in surface", async () => {
  const css = await read("../app/globals.css");
  const colors = css.match(/#[0-9a-f]{3,8}\b/gi) ?? [];

  for (const color of colors) {
    let hex = color.slice(1);
    if (hex.length === 3 || hex.length === 4)
      hex = [...hex].map((digit) => digit + digit).join("");
    const [red, green, blue] = [0, 2, 4].map((offset) =>
      Number.parseInt(hex.slice(offset, offset + 2), 16),
    );
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    let hue = 0;
    if (maximum !== minimum) {
      if (maximum === red)
        hue = (60 * ((green - blue) / (maximum - minimum)) + 360) % 360;
      else if (maximum === green)
        hue = 60 * ((blue - red) / (maximum - minimum) + 2);
      else hue = 60 * ((red - green) / (maximum - minimum) + 4);
    }
    const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum;
    assert.ok(
      hue < 175 || hue > 205 || saturation <= 0.03,
      `prohibited teal color ${color} remains in the active stylesheet`,
    );
  }

  assert.match(css, /\.loginPage\s*\{[\s\S]*?#062b5ce8[\s\S]*?#0b3e75cc/);
});

test("keeps interactive panel content readable on navy states", async () => {
  const css = await read("../app/globals.css");
  assert.match(
    css,
    /\.dashboardKpis > button:hover,[\s\S]*?background:\s*var\(--color-navy-900\);[\s\S]*?color:\s*#fff;/,
  );
  assert.match(
    css,
    /\.dashboardKpis[\s\S]*?> button:is\([\s\S]*?\.accountList[\s\S]*?button:is\([\s\S]*?color:\s*inherit;/,
  );
});

test("keeps bilingual rendering symmetric and responsive to UI changes", async () => {
  const page = await read("../app/page.tsx");
  assert.match(page, /"Memulihkan sesi\.\.\.":\s*"Restoring session\.\.\."/);
  assert.match(page, /"Lupa password\?":\s*"Forgot password\?"/);
  assert.match(page, /className="loginLanguageToggle"/);
  assert.match(page, /tr\("Masuk", "Sign In"\)/);
  assert.match(
    page,
    /"DATA PENUMPANG PER FLIGHT":\s*"FLIGHT-LEVEL PASSENGER DATA"/,
  );
  assert.match(page, /Object\.entries\(interfaceTranslations\)\.map/);
  assert.match(page, /attributes:\s*true/);
  assert.match(page, /characterData:\s*true/);
  assert.match(
    page,
    /attributeFilter:\s*\["placeholder", "aria-label", "title"\]/,
  );
});

test("uses the root Next.js application for local and Netlify builds", async () => {
  const [packageJson, netlify] = await Promise.all([
    read("../package.json").then(JSON.parse),
    read("../netlify.toml"),
  ]);

  assert.equal(packageJson.scripts.dev, "next dev");
  assert.equal(packageJson.scripts.build, "next build");
  assert.equal(packageJson.scripts.start, "next start");
  assert.equal(
    packageJson.scripts.test,
    "npm run test:logic && npm run test:ui && npm run lint && npm run build",
  );
  assert.match(netlify, /command\s*=\s*"npm test"/);
  assert.doesNotMatch(netlify, /source\/|static-build\/|vinext|vite/);
});

test("adds the facility and display foundation without exposing unfinished remote commands", async () => {
  const [page, module, repository, rules] = await Promise.all([
    read("../app/page.tsx"),
    read("../app/facility-operations.tsx"),
    read("../lib/firebase/repository.ts"),
    read("../firestore.rules"),
  ]);

  assert.match(page, /"facility"/);
  assert.match(page, /FacilityOperations/);
  assert.match(module, /Device Control Center/i);
  assert.match(module, /Now Playing/);
  assert.match(module, /Remote Control/);
  assert.match(repository, /\| "rooms"/);
  assert.match(repository, /\| "displayDevices"/);
  assert.match(rules, /match \/rooms\/\{id\}/);
  assert.match(rules, /match \/displayDevices\/\{id\}/);
  assert.match(
    rules,
    /match \/displayCommands\/\{id\}[\s\S]*?allow write: if false;/,
  );
});

test("keeps the facility module bilingual and mobile safe", async () => {
  const [page, css] = await Promise.all([
    read("../app/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(
    page,
    /"Fasilitas & Operasional Ruangan": "Facility & Room Operations"/,
  );
  assert.match(page, /"Pemesanan Ruangan": "Room Booking"/);
  assert.match(page, /"Kalender Pemesanan": "Booking Calendar"/);
  assert.match(page, /"Kirim untuk Persetujuan": "Submit for Approval"/);
  assert.match(css, /\.facilityOverviewGrid/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.facilityTitle/);
});

test("implements room booking views with backend-only conflict locks", async () => {
  const [module, api, backend, rules] = await Promise.all([
    read("../app/facility-operations.tsx"),
    read("../lib/firebase/api.ts"),
    read("../netlify/functions/manage-room-booking.mjs"),
    read("../firestore.rules"),
  ]);
  for (const view of ["Day", "Week", "Month", "List"])
    assert.match(module, new RegExp(`"${view}"`));
  assert.match(module, /Submit for Approval/);
  assert.match(module, /Cleaning Buffer/);
  assert.match(api, /manageRoomBooking/);
  assert.match(backend, /runTransaction/);
  assert.match(backend, /roomBookingSlots/);
  assert.match(backend, /roomBookingRequests/);
  assert.match(backend, /ROOM_BOOKING_CONFLICT/);
  assert.match(
    rules,
    /match \/roomBookings\/\{id\}[\s\S]*?allow write: if false;/,
  );
  assert.match(
    rules,
    /match \/roomBookingSlots\/\{id\}[\s\S]*?allow read, write: if false;/,
  );
  assert.match(
    rules,
    /match \/roomBookingRequests\/\{id\}[\s\S]*?allow read, write: if false;/,
  );
});

test("implements guarded room operations and backend-owned audit records", async () => {
  const [module, api, backend, rules] = await Promise.all([
    read("../app/facility-operations.tsx"),
    read("../lib/firebase/api.ts"),
    read("../netlify/functions/manage-room-operation.mjs"),
    read("../firestore.rules"),
  ]);

  for (const action of [
    "checkin",
    "checkout",
    "completecleaning",
    "noshow",
    "moveroom",
    "startmaintenance",
    "endmaintenance",
    "reportincident",
  ])
    assert.match(backend, new RegExp(action));

  assert.match(module, /Operational Control/);
  assert.match(module, /Readiness Checklist/);
  assert.match(module, /Cleaning Queue/);
  assert.match(module, /Room Activity Log/);
  assert.match(api, /manageRoomOperation/);
  assert.match(backend, /runTransaction/);
  assert.match(backend, /cleaningComplete/);
  assert.match(backend, /\["Occupied", "Maintenance"\]/);
  for (const collection of [
    "roomOperations",
    "roomMaintenance",
    "roomIncidents",
    "roomActivityLogs",
  ])
    assert.match(
      rules,
      new RegExp(
        `match /${collection}/\\{id\\}[\\s\\S]*?allow write: if false;`,
      ),
    );
});

test("keeps facility controls readable and responsive across desktop and mobile", async () => {
  const [module, css] = await Promise.all([
    read("../app/facility-operations.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(
    module,
    /<div className="title facilityTitle">[\s\S]*?<p>FACILITY &amp; ROOM OPERATIONS<\/p>/,
  );
  assert.match(
    css,
    /\.facilityTabs\s*\{[\s\S]*?display:\s*flex;[\s\S]*?margin:\s*-4px 0 17px;/,
  );
  assert.doesNotMatch(
    css,
    /\.facilityTabs\s*\{[\s\S]*?grid-template-columns:\s*repeat\(6/,
  );
  assert.match(
    css,
    /\.facilityStationFilter select\s*\{[\s\S]*?border-radius:\s*20px;/,
  );
  assert.match(
    css,
    /Tab hover and active states retain navy contrast across every tab pattern/,
  );
  assert.match(
    css,
    /button:not\(:disabled\):is\([\s\S]*?:hover,[\s\S]*?:focus-visible[\s\S]*?\)[\s\S]*?background:\s*var\(--color-navy-800\);[\s\S]*?color:\s*#fff;/,
  );
  assert.match(
    css,
    /\.facilityKpis\s*\{[\s\S]*?repeat\(auto-fit, minmax\(155px, 1fr\)\)/,
  );
  assert.match(
    css,
    /\.operationsColumns\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2/,
  );
  assert.match(
    css,
    /@media \(max-width: 760px\)[\s\S]*?\.operationsColumns\s*\{\s*grid-template-columns:\s*1fr;\s*\}/,
  );
  assert.match(css, /\.operationModal\s*\{[\s\S]*?calc\(100vw - 24px\)/);
  assert.match(
    css,
    /\.bookingViewSwitch,\s*\n\.bookingPeriodNav\s*\{[\s\S]*?flex-wrap:\s*nowrap;/,
  );
  assert.match(css, /\.bookingToolbar\s*\{[\s\S]*?minmax\(390px, 1\.15fr\)/);
});

test("explains device inventory approval and secure player enrollment", async () => {
  const facilityModule = await read("../app/facility-operations.tsx");
  assert.match(facilityModule, /Device Registration Guide/);
  assert.match(facilityModule, /Generate enrollment code/);
  assert.match(facilityModule, /href="\/player"/);
  assert.match(facilityModule, /Klik Enroll Player pada tab Monitor/);
  assert.match(facilityModule, /masukkan kode[\s\S]*?dalam 10 menit/);
  assert.match(facilityModule, /Registered Devices/);
  assert.match(
    facilityModule,
    /isDeviceApproved\(device\)[\s\S]*?!isDeviceEnrolled\(device\)[\s\S]*?Enroll Player/,
  );
  assert.match(facilityModule, /const CONTROL_ROLES:[\s\S]*?"Super Admin"/);
});

test("keeps room facilities editable until submit and restores a year-only header period", async () => {
  const [facilityModule, page] = await Promise.all([
    read("../app/facility-operations.tsx"),
    read("../app/page.tsx"),
  ]);
  assert.match(facilityModule, /roomFacilitiesInput/);
  assert.match(facilityModule, /value=\{roomFacilitiesInput\}/);
  assert.match(
    facilityModule,
    /roomFacilitiesInput[\s\S]*?\.split\(","\)[\s\S]*?\.map\(\(value\) => value\.trim\(\)\)/,
  );
  assert.match(page, /\[operationalYear, setOperationalYear\]/);
  assert.match(page, /value=\{operationalYear\}/);
  assert.match(page, /filter\(\(year\) => \/\^\\d\{4\}\$\/\.test\(year\)\)/);
  assert.match(page, /"Semua Periode": "All Periods"/);
  assert.match(page, /Object\.values\(dictionary\)\.includes\(value\)/);
});

test("implements phase 4 display content, channels, and conflict-safe schedules", async () => {
  const [module, api, backend, repository, rules, storageRules] =
    await Promise.all([
      read("../app/facility-operations.tsx"),
      read("../lib/firebase/api.ts"),
      read("../netlify/functions/manage-display-content.mjs"),
      read("../lib/firebase/repository.ts"),
      read("../firestore.rules"),
      read("../storage.rules"),
    ]);
  for (const surface of [
    "Content Library",
    "Channels",
    "Display Schedules",
    "Display Monitoring",
  ])
    assert.match(module, new RegExp(surface));
  assert.match(module, /Enable scheduled running text/);
  assert.match(api, /manageDisplayContent/);
  assert.match(repository, /\| "displayContents"/);
  assert.match(backend, /DISPLAY_SCHEDULE_CONFLICT/);
  assert.match(backend, /row\.daysOfWeek/);
  assert.match(backend, /isApprovedStatus/);
  for (const collection of [
    "displayContents",
    "displayChannels",
    "displaySchedules",
  ])
    assert.match(
      rules,
      new RegExp(
        `match /${collection}/\\{id\\}[\\s\\S]*?allow write: if false;`,
      ),
    );
  assert.match(
    storageRules,
    /match \/display-content\/\{station\}\/\{contentId\}\/\{fileName\}/,
  );
  assert.match(storageRules, /200 \* 1024 \* 1024/);
});

test("implements phase 5 secure browser player and acknowledged remote commands", async () => {
  const [module, player, adminBackend, playerBackend, api, rules, css] =
    await Promise.all([
      read("../app/facility-operations.tsx"),
      read("../app/player/page.tsx"),
      read("../netlify/functions/manage-display-device.mjs"),
      read("../netlify/functions/display-player.mjs"),
      read("../lib/firebase/api.ts"),
      read("../firestore.rules"),
      read("../app/globals.css"),
    ]);
  assert.match(module, /Enroll Player/);
  assert.match(module, /PLAY_CHANNEL/);
  assert.match(module, /SET_OVERLAY/);
  assert.match(module, /Browser player tidak mendukung unattended screenshot/);
  assert.match(player, /gaes-display-player-credential-v1/);
  assert.match(player, /offlinePlanCache/);
  assert.match(player, /Idempotent replay acknowledged/);
  assert.match(player, /playerTicker/);
  assert.match(adminBackend, /randomBytes/);
  assert.match(adminBackend, /DISPLAY_COMMAND_/);
  assert.match(adminBackend, /DISPLAY_DEVICE_DELETED/);
  assert.match(adminBackend, /action === "delete"/);
  assert.match(adminBackend, /"approved", "disetujui"/);
  assert.match(playerBackend, /timingSafeEqual/);
  assert.match(playerBackend, /displayDeviceCredentials/);
  assert.doesNotMatch(playerBackend, /deviceSecretHash/);
  assert.match(playerBackend, /acknowledgedAt/);
  assert.match(api, /manageDisplayDevice/);
  assert.match(
    rules,
    /match \/displayEnrollments\/\{id\}[\s\S]*?allow read, write: if false;/,
  );
  assert.match(
    rules,
    /match \/displayDeviceCredentials\/\{id\}[\s\S]*?allow read, write: if false;/,
  );
  assert.match(css, /\.displayPlayer\s*\{/);
});

test("normalizes translated approval values and exposes enroll and delete in edit device", async () => {
  const [module, css, backend] = await Promise.all([
    read("../app/facility-operations.tsx"),
    read("../app/globals.css"),
    read("../netlify/functions/manage-display-device.mjs"),
  ]);
  assert.match(module, /function canonicalApprovalStatus/);
  assert.match(module, /\["approved", "disetujui"\]/);
  assert.match(module, /<option value="Approved">Approved<\/option>/);
  assert.match(module, /editingDeviceRecord[\s\S]*?Enroll Player/);
  assert.match(module, /editingDeviceRecord[\s\S]*?Delete Device/);
  assert.match(module, /void deleteDevice\(device\)/);
  assert.match(backend, /displayDeviceCredentials/);
  assert.match(backend, /displayEnrollments/);
  assert.match(
    css,
    /\.subTabs\.facilityTabs button\.active:not\(:disabled\)[\s\S]*?background:\s*var\(--color-navy-900\)/,
  );
});

test("renders Firestore display timestamps and legacy display arrays safely", async () => {
  const facilityModule = await read("../app/facility-operations.tsx");
  assert.match(
    facilityModule,
    /function readableHeartbeat\(value: unknown\): string[\s\S]*?activityMillis\(value\)/,
  );
  assert.match(
    facilityModule,
    /const heartbeat = activityMillis\(device\.lastHeartbeat\)/,
  );
  assert.match(
    facilityModule,
    /function stringArray\(value: unknown\): string\[\]/,
  );
  assert.match(
    facilityModule,
    /function numberArray\(value: unknown\): number\[\]/,
  );
  assert.doesNotMatch(
    facilityModule,
    /return value;[\s\S]{0,120}toLocaleString/,
  );
  assert.doesNotMatch(facilityModule, /row\.deviceIds\.length/);
  assert.doesNotMatch(facilityModule, /row\.contentIds\.map/);
  assert.doesNotMatch(facilityModule, /row\.daysOfWeek\.map/);
});

test("implements phase 6 endpoint hardening, health sweep, and rollout gates", async () => {
  const [
    module,
    playerBackend,
    sweep,
    pilotBackend,
    rules,
    netlify,
    repository,
    css,
  ] = await Promise.all([
    read("../app/facility-operations.tsx"),
    read("../netlify/functions/display-player.mjs"),
    read("../netlify/functions/sweep-display-health.mjs"),
    read("../netlify/functions/manage-display-pilot.mjs"),
    read("../firestore.rules"),
    read("../netlify.toml"),
    read("../lib/firebase/repository.ts"),
    read("../app/globals.css"),
  ]);
  assert.match(playerBackend, /enforceRateLimit/);
  assert.match(playerBackend, /64 \* 1024/);
  assert.match(playerBackend, /Kode enrollment tidak valid atau kedaluwarsa/);
  assert.match(sweep, /schedule: "\* \* \* \* \*"/);
  assert.match(sweep, /DISPLAY_HEALTH_/);
  assert.match(pilotBackend, /REQUIRED_CHECKS/);
  assert.match(pilotBackend, /DISPLAY_UAT_INCOMPLETE/);
  assert.match(pilotBackend, /Ready for Operations/);
  assert.match(module, /Pilot UAT &amp; Rollout Readiness/);
  assert.match(module, /Certify Rollout/);
  assert.match(repository, /\| "displayPilotTests"/);
  for (const collection of [
    "displayRateLimits",
    "displayPilotTests",
    "displayRolloutApprovals",
  ])
    assert.match(rules, new RegExp(`match /${collection}/\\{id\\}`));
  assert.match(netlify, /for = "\/player"[\s\S]*?Content-Security-Policy/);
  assert.match(netlify, /Permissions-Policy/);
  assert.match(css, /\.deviceHealthKpis\s*\{/);
  assert.match(css, /\.pilotChecklist\s*\{/);
});
