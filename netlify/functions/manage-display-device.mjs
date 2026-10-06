import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  failure,
  httpError,
  json,
  requireUser,
  targetDb,
} from "./_firebase-admin.mjs";

const CONTROL_ROLES = new Set([
  "Super Admin",
  "Admin",
  "HO Admin",
  "BO Admin",
  "Lounge Officer",
  "Lounge Manager",
]);
const CONFIG_ROLES = new Set(["Super Admin", "Admin", "HO Admin"]);
const GLOBAL_ROLES = new Set(["Super Admin", "Admin", "HO Admin"]);
const COMMANDS = new Set([
  "PLAY_CHANNEL",
  "SET_OVERLAY",
  "CLEAR_OVERLAY",
  "STOP_PLAYBACK",
  "PAUSE",
  "RESUME",
  "REFRESH",
  "REQUEST_SCREENSHOT",
]);
const text = (value, max = 500) =>
  String(value || "")
    .trim()
    .slice(0, max);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const shareSignalId = (sessionId, deviceId) =>
  sha(`${sessionId}|${deviceId}`).slice(0, 48);
const timestampMillis = (value) => value?.toDate?.().getTime?.() || 0;
const SHARE_CONTROLLER_LEASE_MS = 30_000;

const DEFAULT_ANNOUNCEMENT_TEMPLATES = {
  boarding: {
    name: "Boarding Now",
    messageTemplate: "{flight} {route} — BOARDING NOW",
    defaultDurationMinutes: 10,
    priority: 60,
    repeatCount: 1,
  },
  "final-call": {
    name: "Final Call",
    messageTemplate: "{flight} {route} — FINAL CALL",
    defaultDurationMinutes: 5,
    priority: 80,
    repeatCount: 2,
  },
  delay: {
    name: "New ETD / Delay",
    messageTemplate: "{flight} {route} — NEW ETD {etd}",
    defaultDurationMinutes: 15,
    priority: 50,
    repeatCount: 1,
  },
  "gate-change": {
    name: "Gate Change",
    messageTemplate: "{flight} {route} — GATE CHANGE: {oldGate} TO {newGate}",
    defaultDurationMinutes: 15,
    priority: 70,
    repeatCount: 2,
  },
  cancellation: {
    name: "Cancellation",
    messageTemplate: "{flight} {route} — FLIGHT CANCELLED",
    defaultDurationMinutes: 15,
    priority: 90,
    repeatCount: 2,
  },
  emergency: {
    name: "Emergency",
    messageTemplate: "{message}",
    defaultDurationMinutes: 30,
    priority: 100,
    repeatCount: 3,
  },
  custom: {
    name: "Custom Message",
    messageTemplate: "{message}",
    defaultDurationMinutes: 10,
    priority: 40,
    repeatCount: 1,
  },
};

function requireController(actor) {
  if (!CONTROL_ROLES.has(actor.profile.role))
    throw httpError(403, "Role tidak memiliki akses remote display.");
}

function requireConfigurator(actor) {
  if (!CONFIG_ROLES.has(actor.profile.role))
    throw httpError(
      403,
      "Role tidak memiliki akses konfigurasi display device.",
    );
}

function isApprovedStatus(value) {
  return ["approved", "disetujui"].includes(text(value, 40).toLowerCase());
}

function requireStation(actor, station) {
  if (
    !GLOBAL_ROLES.has(actor.profile.role) &&
    actor.profile.station !== station
  )
    throw httpError(403, "Device berada di luar scope station akun.");
}

async function loadDevice(db, actor, deviceId) {
  const snapshot = await db.collection("displayDevices").doc(deviceId).get();
  if (!snapshot.exists) throw httpError(404, "Display device tidak ditemukan.");
  const device = { id: snapshot.id, ...snapshot.data() };
  requireStation(actor, device.station);
  return device;
}

async function createEnrollment(db, actor, input) {
  const deviceId = text(input.deviceId, 160);
  const device = await loadDevice(db, actor, deviceId);
  if (!isApprovedStatus(device.approvalStatus) || device.status === "Disabled")
    throw httpError(
      409,
      "Device harus Approved dan tidak Disabled sebelum enrollment.",
    );
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  const code = Array.from(bytes, (value) => alphabet[value % alphabet.length])
    .join("")
    .slice(0, 8);
  const codeHash = sha(code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const batch = db.batch();
  batch.set(db.collection("displayEnrollments").doc(codeHash), {
    deviceId,
    station: device.station,
    codeHash,
    status: "Pending",
    expiresAt,
    createdAt: new Date(),
    createdBy: actor.decoded.uid,
  });
  batch.update(db.collection("displayDevices").doc(deviceId), {
    approvalStatus: "Approved",
    enrollmentStatus: "Pending",
    enrollmentExpiresAt: expiresAt,
    updatedAt: new Date(),
  });
  batch.create(db.collection("displayActivityLogs").doc(), {
    action: "DISPLAY_ENROLLMENT_CREATED",
    station: device.station,
    deviceId,
    actorId: actor.decoded.uid,
    actorName: text(actor.profile.name, 120),
    createdAt: new Date(),
  });
  await batch.commit();
  return {
    deviceId,
    code,
    expiresAt: expiresAt.toISOString(),
    status: "Pending",
  };
}

async function sendCommand(db, actor, input) {
  const deviceId = text(input.deviceId, 160);
  const type = text(input.type, 40).toUpperCase();
  if (!COMMANDS.has(type))
    throw httpError(400, "Jenis remote command tidak valid.");
  const device = await loadDevice(db, actor, deviceId);
  if (device.enrollmentStatus !== "Enrolled")
    throw httpError(409, "Device belum ter-enroll pada player.");
  const commandId = randomUUID();
  const expiresAt = new Date(
    Date.now() + (type === "REFRESH" ? 5 : 15) * 60 * 1000,
  );
  const payload = {
    channelId: text(input.channelId, 160),
    overlayText: text(input.overlayText, 500),
    overrideUntil: new Date(
      Date.now() +
        Math.max(5, Math.min(480, Number(input.durationMinutes) || 60)) *
          60 *
          1000,
    ).toISOString(),
  };
  if (type === "PLAY_CHANNEL") {
    const channel = await db
      .collection("displayChannels")
      .doc(payload.channelId)
      .get();
    if (!channel.exists || channel.data()?.status !== "Active")
      throw httpError(409, "Channel aktif tidak ditemukan.");
  }
  if (type === "SET_OVERLAY" && !payload.overlayText)
    throw httpError(400, "Running text wajib diisi.");
  const batch = db.batch();
  batch.create(db.collection("displayCommands").doc(commandId), {
    id: commandId,
    deviceId,
    station: device.station,
    type,
    payload,
    status: "Pending",
    createdAt: new Date(),
    expiresAt,
    createdBy: actor.decoded.uid,
    createdByName: text(actor.profile.name, 120),
  });
  batch.create(db.collection("displayActivityLogs").doc(), {
    action: `DISPLAY_COMMAND_${type}`,
    station: device.station,
    deviceId,
    commandId,
    actorId: actor.decoded.uid,
    actorName: text(actor.profile.name, 120),
    createdAt: new Date(),
  });
  await batch.commit();
  return {
    id: commandId,
    status: "Pending",
    expiresAt: expiresAt.toISOString(),
  };
}

function announcementMessage(template, input) {
  const values = {
    flight: text(input.flightNumber, 24).toUpperCase(),
    route: text(input.route, 32).toUpperCase(),
    etd: text(input.etd, 12).toUpperCase(),
    oldGate: text(input.oldGate, 24).toUpperCase(),
    newGate: text(input.newGate, 24).toUpperCase(),
    message: text(input.message, 500),
  };
  return text(template.messageTemplate, 500)
    .replace(
      /\{(flight|route|etd|oldGate|newGate|message)\}/g,
      (_, key) => values[key] || "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

async function loadAnnouncementTemplate(db, templateId) {
  const fallback = DEFAULT_ANNOUNCEMENT_TEMPLATES[templateId];
  if (!fallback)
    throw httpError(400, "Quick announcement template tidak valid.");
  const snapshot = await db
    .collection("displayAnnouncementTemplates")
    .doc(templateId)
    .get();
  return {
    id: templateId,
    ...fallback,
    ...(snapshot.exists ? snapshot.data() : {}),
  };
}

async function announce(db, actor, input) {
  const station = text(input.station, 12).toUpperCase();
  requireStation(actor, station);
  const deviceIds = [
    ...new Set(
      (Array.isArray(input.deviceIds) ? input.deviceIds : [])
        .map((value) => text(value, 160))
        .filter(Boolean),
    ),
  ].slice(0, 50);
  if (!deviceIds.length)
    throw httpError(400, "Pilih minimal satu target device.");
  const deviceSnapshots = await Promise.all(
    deviceIds.map((id) => db.collection("displayDevices").doc(id).get()),
  );
  if (
    deviceSnapshots.some(
      (snapshot) =>
        !snapshot.exists ||
        snapshot.data()?.station !== station ||
        snapshot.data()?.enrollmentStatus !== "Enrolled",
    )
  )
    throw httpError(
      409,
      "Seluruh target harus merupakan device Enrolled pada station yang dipilih.",
    );
  const templateId = text(input.templateId, 40).toLowerCase();
  const template = await loadAnnouncementTemplate(db, templateId);
  if (template.status === "Inactive")
    throw httpError(409, "Quick announcement template sedang tidak aktif.");
  const message = announcementMessage(template, input);
  if (!message) throw httpError(400, "Isi quick announcement belum lengkap.");
  const configuredDuration = Number(template.defaultDurationMinutes) || 10;
  const durationMinutes = CONFIG_ROLES.has(actor.profile.role)
    ? Math.max(
        1,
        Math.min(180, Number(input.durationMinutes) || configuredDuration),
      )
    : Math.max(1, Math.min(180, configuredDuration));
  const flightNumber = text(input.flightNumber, 24).toUpperCase();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);
  const existing = await db
    .collection("displayAnnouncements")
    .where("station", "==", station)
    .get();
  const batch = db.batch();
  if (flightNumber) {
    existing.docs
      .filter(
        (snapshot) =>
          snapshot.data()?.status === "Active" &&
          text(snapshot.data()?.flightNumber, 24).toUpperCase() ===
            flightNumber,
      )
      .forEach((snapshot) =>
        batch.update(snapshot.ref, {
          status: "Replaced",
          endedAt: now,
          updatedAt: now,
        }),
      );
  }
  const id = randomUUID();
  batch.create(db.collection("displayAnnouncements").doc(id), {
    id,
    station,
    deviceIds,
    templateId,
    templateName: text(template.name, 80),
    message,
    flightNumber,
    route: text(input.route, 32).toUpperCase(),
    priority: Math.max(1, Math.min(100, Number(template.priority) || 40)),
    repeatCount: Math.max(1, Math.min(5, Number(template.repeatCount) || 1)),
    durationMinutes,
    status: "Active",
    startsAt: now,
    expiresAt,
    createdAt: now,
    createdBy: actor.decoded.uid,
    createdByName: text(actor.profile.name, 120),
  });
  batch.create(db.collection("displayActivityLogs").doc(), {
    action: "DISPLAY_ANNOUNCEMENT_CREATED",
    station,
    announcementId: id,
    deviceIds,
    actorId: actor.decoded.uid,
    actorName: text(actor.profile.name, 120),
    detail: message,
    createdAt: now,
  });
  await batch.commit();
  return { id, status: "Active", expiresAt: expiresAt.toISOString() };
}

async function saveAnnouncementTemplate(db, actor, input) {
  requireConfigurator(actor);
  const id = text(input.templateId, 40).toLowerCase();
  if (!DEFAULT_ANNOUNCEMENT_TEMPLATES[id])
    throw httpError(400, "Template tidak valid.");
  const fallback = DEFAULT_ANNOUNCEMENT_TEMPLATES[id];
  await db
    .collection("displayAnnouncementTemplates")
    .doc(id)
    .set(
      {
        id,
        name: text(input.name, 80) || fallback.name,
        messageTemplate:
          text(input.messageTemplate, 500) || fallback.messageTemplate,
        defaultDurationMinutes: Math.max(
          1,
          Math.min(
            180,
            Number(input.defaultDurationMinutes) ||
              fallback.defaultDurationMinutes,
          ),
        ),
        priority: Math.max(
          1,
          Math.min(100, Number(input.priority) || fallback.priority),
        ),
        repeatCount: Math.max(
          1,
          Math.min(5, Number(input.repeatCount) || fallback.repeatCount),
        ),
        status: input.status === "Inactive" ? "Inactive" : "Active",
        updatedAt: new Date(),
        updatedBy: actor.decoded.uid,
      },
      { merge: true },
    );
  return { id, status: "Saved" };
}

async function clearAnnouncements(db, actor, input) {
  const station = text(input.station, 12).toUpperCase();
  requireStation(actor, station);
  const targetIds = new Set(
    (Array.isArray(input.deviceIds) ? input.deviceIds : [])
      .map((value) => text(value, 160))
      .filter(Boolean),
  );
  const snapshot = await db
    .collection("displayAnnouncements")
    .where("station", "==", station)
    .get();
  const rows = snapshot.docs.filter(
    (row) =>
      row.data()?.status === "Active" &&
      (!targetIds.size ||
        (row.data()?.deviceIds || []).some((id) => targetIds.has(id))),
  );
  if (rows.length) {
    const batch = db.batch();
    rows.forEach((row) =>
      batch.update(row.ref, {
        status: "Cleared",
        endedAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    await batch.commit();
  }
  return { status: "Cleared", count: rows.length };
}

async function stopAnnouncement(db, actor, input) {
  const announcementId = text(input.announcementId, 160);
  if (!announcementId) throw httpError(400, "Announcement ID wajib tersedia.");
  const ref = db.collection("displayAnnouncements").doc(announcementId);
  const snapshot = await ref.get();
  if (!snapshot.exists)
    throw httpError(404, "Quick announcement tidak ditemukan.");
  const announcement = snapshot.data();
  requireStation(actor, announcement.station);
  const now = new Date();
  const batch = db.batch();
  batch.update(ref, {
    status: "Cleared",
    endedAt: now,
    updatedAt: now,
    endedBy: actor.decoded.uid,
  });
  batch.create(db.collection("displayActivityLogs").doc(), {
    action: "DISPLAY_ANNOUNCEMENT_STOPPED",
    station: announcement.station,
    announcementId,
    deviceIds: announcement.deviceIds || [],
    actorId: actor.decoded.uid,
    actorName: text(actor.profile.name, 120),
    detail: text(announcement.message, 500),
    createdAt: now,
  });
  await batch.commit();
  return { id: announcementId, status: "Cleared" };
}

async function updateAnnouncementDuration(db, actor, input) {
  requireConfigurator(actor);
  const announcementId = text(input.announcementId, 160);
  const requestedDuration = Number(input.durationMinutes);
  if (
    !announcementId ||
    !Number.isFinite(requestedDuration) ||
    requestedDuration < 1
  )
    throw httpError(400, "Announcement dan durasi wajib tersedia.");
  const durationMinutes = Math.min(180, requestedDuration);
  const ref = db.collection("displayAnnouncements").doc(announcementId);
  const snapshot = await ref.get();
  if (!snapshot.exists)
    throw httpError(404, "Quick announcement tidak ditemukan.");
  const announcement = snapshot.data();
  requireStation(actor, announcement.station);
  if (announcement.status !== "Active")
    throw httpError(409, "Quick announcement sudah tidak aktif.");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);
  await ref.update({
    durationMinutes,
    expiresAt,
    updatedAt: now,
    updatedBy: actor.decoded.uid,
  });
  return {
    id: announcementId,
    status: "Active",
    expiresAt: expiresAt.toISOString(),
  };
}

async function revoke(db, actor, input) {
  const deviceId = text(input.deviceId, 160);
  const device = await loadDevice(db, actor, deviceId);
  const batch = db.batch();
  batch.delete(db.collection("displayDeviceCredentials").doc(deviceId));
  batch.update(db.collection("displayDevices").doc(deviceId), {
    enrollmentStatus: "Revoked",
    status: "Offline",
    revokedAt: new Date(),
    updatedAt: new Date(),
  });
  batch.create(db.collection("displayActivityLogs").doc(), {
    action: "DISPLAY_ENROLLMENT_REVOKED",
    station: device.station,
    deviceId,
    actorId: actor.decoded.uid,
    actorName: text(actor.profile.name, 120),
    createdAt: new Date(),
  });
  await batch.commit();
  return { id: deviceId, status: "Revoked" };
}

async function deleteDevice(db, actor, input) {
  requireConfigurator(actor);
  const deviceId = text(input.deviceId, 160);
  const device = await loadDevice(db, actor, deviceId);
  const enrollments = await db
    .collection("displayEnrollments")
    .where("deviceId", "==", deviceId)
    .get();
  const batch = db.batch();
  enrollments.docs.forEach((snapshot) => batch.delete(snapshot.ref));
  batch.delete(db.collection("displayDeviceCredentials").doc(deviceId));
  batch.delete(db.collection("displayDevices").doc(deviceId));
  batch.create(db.collection("displayActivityLogs").doc(), {
    action: "DISPLAY_DEVICE_DELETED",
    station: device.station,
    deviceId,
    deviceName: text(device.name, 160),
    actorId: actor.decoded.uid,
    actorName: text(actor.profile.name, 120),
    createdAt: new Date(),
  });
  await batch.commit();
  return { id: deviceId, status: "Deleted" };
}

async function saveOutputGroup(db, actor, input) {
  requireConfigurator(actor);
  const id = text(input.id, 160) || randomUUID();
  const station = text(input.station, 12).toUpperCase();
  const name = text(input.name, 120);
  const deviceIds = [
    ...new Set(
      (Array.isArray(input.deviceIds) ? input.deviceIds : [])
        .map((value) => text(value, 160))
        .filter(Boolean),
    ),
  ].slice(0, 50);
  if (!station || !name || !deviceIds.length)
    throw httpError(
      400,
      "Station, nama Output Group, dan minimal satu device wajib tersedia.",
    );
  requireStation(actor, station);
  const deviceSnapshots = await Promise.all(
    deviceIds.map((deviceId) =>
      db.collection("displayDevices").doc(deviceId).get(),
    ),
  );
  if (
    deviceSnapshots.some(
      (snapshot) =>
        !snapshot.exists ||
        snapshot.data()?.station !== station ||
        !isApprovedStatus(snapshot.data()?.approvalStatus),
    )
  )
    throw httpError(
      409,
      "Seluruh device harus Approved dan berasal dari station yang sama.",
    );
  const groups = await db
    .collection("displayOutputGroups")
    .where("station", "==", station)
    .get();
  const duplicate = groups.docs.find(
    (snapshot) =>
      snapshot.id !== id &&
      snapshot.data()?.status === "Active" &&
      (snapshot.data()?.deviceIds || []).some((deviceId) =>
        deviceIds.includes(deviceId),
      ),
  );
  if (duplicate)
    throw httpError(
      409,
      `Device sudah digunakan oleh Output Group ${text(duplicate.data()?.name, 120)}.`,
    );
  const ref = db.collection("displayOutputGroups").doc(id);
  const existing = await ref.get();
  const now = new Date();
  const sourceModes = new Set([
    "Cached Playlist",
    "Managed Channel",
    "Live Screen Share",
    "External TV/IPTV",
    "Emergency Override",
  ]);
  const sourceMode = sourceModes.has(input.sourceMode)
    ? input.sourceMode
    : "Managed Channel";
  const batch = db.batch();
  batch.set(
    ref,
    {
      id,
      station,
      name,
      description: text(input.description, 500),
      deviceIds,
      status: input.status === "Inactive" ? "Inactive" : "Active",
      sourceMode,
      sessionStatus: existing.data()?.sessionStatus || "Idle",
      activeSourceName: existing.data()?.activeSourceName || "",
      updatedAt: now,
      updatedBy: actor.decoded.uid,
      ...(existing.exists
        ? {}
        : { createdAt: now, createdBy: actor.decoded.uid }),
    },
    { merge: true },
  );
  batch.create(db.collection("displayActivityLogs").doc(), {
    action: existing.exists
      ? "DISPLAY_OUTPUT_GROUP_UPDATED"
      : "DISPLAY_OUTPUT_GROUP_CREATED",
    station,
    outputGroupId: id,
    deviceIds,
    actorId: actor.decoded.uid,
    actorName: text(actor.profile.name, 120),
    createdAt: now,
  });
  await batch.commit();
  return { id, status: "Saved" };
}

async function deleteOutputGroup(db, actor, input) {
  requireConfigurator(actor);
  const id = text(input.id, 160);
  const ref = db.collection("displayOutputGroups").doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw httpError(404, "Output Group tidak ditemukan.");
  const group = snapshot.data();
  requireStation(actor, group.station);
  if (group.sessionStatus === "Sharing")
    throw httpError(
      409,
      "Hentikan screen share sebelum menghapus Output Group.",
    );
  const batch = db.batch();
  batch.delete(ref);
  batch.create(db.collection("displayActivityLogs").doc(), {
    action: "DISPLAY_OUTPUT_GROUP_DELETED",
    station: group.station,
    outputGroupId: id,
    actorId: actor.decoded.uid,
    actorName: text(actor.profile.name, 120),
    createdAt: new Date(),
  });
  await batch.commit();
  return { id, status: "Deleted" };
}

async function startShareSession(db, actor, input) {
  const outputGroupId = text(input.outputGroupId, 160);
  const sourceName = text(input.sourceName, 160) || "Operator Screen";
  const groupSnapshot = await db
    .collection("displayOutputGroups")
    .doc(outputGroupId)
    .get();
  if (!groupSnapshot.exists)
    throw httpError(404, "Output Group tidak ditemukan.");
  const group = { id: groupSnapshot.id, ...groupSnapshot.data() };
  requireStation(actor, group.station);
  if (group.status !== "Active")
    throw httpError(409, "Output Group sedang tidak aktif.");
  let expiredSession = null;
  if (group.sessionStatus === "Sharing" && group.activeShareSessionId) {
    const activeSession = await db
      .collection("displayShareSessions")
      .doc(group.activeShareSessionId)
      .get();
    const activeData = activeSession.data();
    const lastControllerActivity = timestampMillis(
      activeData?.controllerHeartbeatAt || activeData?.createdAt,
    );
    if (
      activeSession.exists &&
      activeData?.status === "Sharing" &&
      Date.now() - lastControllerActivity <= SHARE_CONTROLLER_LEASE_MS
    )
      throw httpError(409, "Output Group sedang digunakan untuk screen share.");
    if (activeSession.exists) expiredSession = activeSession.ref;
  }
  const deviceIds = [...new Set(group.deviceIds || [])].slice(0, 20);
  const deviceSnapshots = await Promise.all(
    deviceIds.map((id) => db.collection("displayDevices").doc(id).get()),
  );
  const availableDevices = deviceSnapshots.filter(
    (snapshot) =>
      snapshot.exists &&
      snapshot.data()?.station === group.station &&
      snapshot.data()?.enrollmentStatus === "Enrolled",
  );
  if (!availableDevices.length)
    throw httpError(409, "Tidak ada Player Enrolled di dalam Output Group.");
  const sessionId = randomUUID();
  const now = new Date();
  const batch = db.batch();
  batch.create(db.collection("displayShareSessions").doc(sessionId), {
    id: sessionId,
    outputGroupId,
    outputGroupName: group.name,
    station: group.station,
    sourceName,
    deviceIds: availableDevices.map((snapshot) => snapshot.id),
    status: "Sharing",
    createdAt: now,
    controllerHeartbeatAt: now,
    createdBy: actor.decoded.uid,
    createdByName: text(actor.profile.name, 120),
  });
  if (expiredSession)
    batch.set(
      expiredSession,
      { status: "Expired", stoppedAt: now, updatedAt: now },
      { merge: true },
    );
  availableDevices.forEach((snapshot) =>
    batch.update(snapshot.ref, {
      activeShareSessionId: sessionId,
      updatedAt: now,
    }),
  );
  batch.update(groupSnapshot.ref, {
    sessionStatus: "Sharing",
    activeShareSessionId: sessionId,
    activeSourceName: sourceName,
    updatedAt: now,
  });
  batch.create(db.collection("displayActivityLogs").doc(), {
    action: "DISPLAY_SHARE_STARTED",
    station: group.station,
    outputGroupId,
    sessionId,
    actorId: actor.decoded.uid,
    actorName: text(actor.profile.name, 120),
    detail: sourceName,
    createdAt: now,
  });
  await batch.commit();
  return {
    id: sessionId,
    sessionId,
    status: "Sharing",
    deviceIds: availableDevices.map((snapshot) => snapshot.id),
  };
}

async function submitShareOffer(db, actor, input) {
  const sessionId = text(input.sessionId, 160);
  const deviceId = text(input.deviceId, 160);
  const offerSdp = text(input.offerSdp, 120_000);
  const session = await db
    .collection("displayShareSessions")
    .doc(sessionId)
    .get();
  if (!session.exists || session.data()?.status !== "Sharing")
    throw httpError(409, "Screen share session tidak aktif.");
  const data = session.data();
  requireStation(actor, data.station);
  if (
    data.createdBy !== actor.decoded.uid &&
    !CONFIG_ROLES.has(actor.profile.role)
  )
    throw httpError(403, "Screen share dikendalikan operator lain.");
  if (!data.deviceIds?.includes(deviceId) || !offerSdp)
    throw httpError(400, "Target device atau WebRTC offer tidak valid.");
  await db
    .collection("displayShareSignals")
    .doc(shareSignalId(sessionId, deviceId))
    .set({
      sessionId,
      deviceId,
      station: data.station,
      offerSdp,
      answerSdp: "",
      status: "Offer",
      updatedAt: new Date(),
    });
  return { id: deviceId, status: "Offer" };
}

async function shareSessionStatus(db, actor, input) {
  const sessionId = text(input.sessionId, 160);
  const session = await db
    .collection("displayShareSessions")
    .doc(sessionId)
    .get();
  if (!session.exists)
    throw httpError(404, "Screen share session tidak ditemukan.");
  const data = session.data();
  requireStation(actor, data.station);
  if (
    data.createdBy !== actor.decoded.uid &&
    !CONFIG_ROLES.has(actor.profile.role)
  )
    throw httpError(403, "Screen share dikendalikan operator lain.");
  await session.ref.update({ controllerHeartbeatAt: new Date() });
  const signals = await Promise.all(
    (data.deviceIds || []).map((deviceId) =>
      db
        .collection("displayShareSignals")
        .doc(shareSignalId(sessionId, deviceId))
        .get(),
    ),
  );
  return {
    id: sessionId,
    sessionId,
    status: data.status,
    devices: (data.deviceIds || []).map((deviceId, index) => ({
      deviceId,
      status: signals[index].data()?.status || "Waiting",
      answerSdp: text(signals[index].data()?.answerSdp, 120_000),
    })),
  };
}

async function stopShareSession(db, actor, input) {
  const sessionId = text(input.sessionId, 160);
  const sessionRef = db.collection("displayShareSessions").doc(sessionId);
  const session = await sessionRef.get();
  if (!session.exists)
    throw httpError(404, "Screen share session tidak ditemukan.");
  const data = session.data();
  requireStation(actor, data.station);
  if (
    data.createdBy !== actor.decoded.uid &&
    !CONFIG_ROLES.has(actor.profile.role)
  )
    throw httpError(403, "Screen share dikendalikan operator lain.");
  const now = new Date();
  const batch = db.batch();
  batch.update(sessionRef, {
    status: "Stopped",
    stoppedAt: now,
    updatedAt: now,
  });
  (data.deviceIds || []).forEach((deviceId) => {
    batch.update(db.collection("displayDevices").doc(deviceId), {
      activeShareSessionId: "",
      updatedAt: now,
    });
    batch.set(
      db
        .collection("displayShareSignals")
        .doc(shareSignalId(sessionId, deviceId)),
      { status: "Stopped", updatedAt: now },
      { merge: true },
    );
  });
  batch.update(db.collection("displayOutputGroups").doc(data.outputGroupId), {
    sessionStatus: "Idle",
    activeShareSessionId: "",
    activeSourceName: "",
    updatedAt: now,
  });
  batch.create(db.collection("displayActivityLogs").doc(), {
    action: "DISPLAY_SHARE_STOPPED",
    station: data.station,
    outputGroupId: data.outputGroupId,
    sessionId,
    actorId: actor.decoded.uid,
    actorName: text(actor.profile.name, 120),
    createdAt: now,
  });
  await batch.commit();
  return { id: sessionId, status: "Stopped" };
}

const handler = async (request) => {
  try {
    if (request.method !== "POST")
      return json(405, { error: "Method not allowed." });
    const actor = await requireUser(request);
    requireController(actor);
    const input = await request.json();
    const action = text(input.action, 40).toLowerCase();
    const db = targetDb();
    if (action === "createenrollment")
      return json(200, await createEnrollment(db, actor, input));
    if (action === "command")
      return json(200, await sendCommand(db, actor, input));
    if (action === "revoke") return json(200, await revoke(db, actor, input));
    if (action === "delete")
      return json(200, await deleteDevice(db, actor, input));
    if (action === "announce")
      return json(200, await announce(db, actor, input));
    if (action === "clearannouncements")
      return json(200, await clearAnnouncements(db, actor, input));
    if (action === "stopannouncement")
      return json(200, await stopAnnouncement(db, actor, input));
    if (action === "updateannouncementduration")
      return json(200, await updateAnnouncementDuration(db, actor, input));
    if (action === "saveoutputgroup")
      return json(200, await saveOutputGroup(db, actor, input));
    if (action === "deleteoutputgroup")
      return json(200, await deleteOutputGroup(db, actor, input));
    if (action === "startsharesession")
      return json(200, await startShareSession(db, actor, input));
    if (action === "shareoffer")
      return json(200, await submitShareOffer(db, actor, input));
    if (action === "sharestatus")
      return json(200, await shareSessionStatus(db, actor, input));
    if (action === "stopsharesession")
      return json(200, await stopShareSession(db, actor, input));
    if (action === "savetemplate")
      return json(200, await saveAnnouncementTemplate(db, actor, input));
    throw httpError(400, "Device management action tidak valid.");
  } catch (error) {
    return failure(error);
  }
};

export default handler;
