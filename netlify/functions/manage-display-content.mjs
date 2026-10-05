import { createHash } from "node:crypto";
import {
  failure,
  httpError,
  json,
  requireUser,
  targetDb,
} from "./_firebase-admin.mjs";

const USER_ROLES = new Set([
  "Super Admin",
  "Admin",
  "HO Admin",
  "BO Admin",
  "Lounge Officer",
  "Lounge Manager",
]);
const GLOBAL_ROLES = new Set(["Super Admin", "Admin", "HO Admin"]);
const CONFIG_ROLES = new Set(["Super Admin", "Admin", "HO Admin"]);
const SCHEDULE_ROLES = new Set([
  "Super Admin",
  "Admin",
  "HO Admin",
  "BO Admin",
  "Lounge Officer",
  "Lounge Manager",
]);
const CONTENT_TYPES = new Set(["Live TV", "Video", "Image", "Web URL"]);
const text = (value, max = 500) =>
  String(value || "")
    .trim()
    .slice(0, max);
const isApprovedStatus = (value) =>
  ["approved", "disetujui"].includes(text(value, 40).toLowerCase());

function requireFacilityUser(actor) {
  if (!USER_ROLES.has(actor.profile.role))
    throw httpError(403, "Role tidak memiliki akses TV & Digital Signage.");
}

function requireConfig(actor) {
  if (!CONFIG_ROLES.has(actor.profile.role))
    throw httpError(
      403,
      "Content dan channel hanya dapat dikelola administrator HO.",
    );
}

function requireSchedule(actor) {
  if (!SCHEDULE_ROLES.has(actor.profile.role))
    throw httpError(403, "Role tidak memiliki akses schedule TV.");
}

function requireStation(actor, station) {
  if (
    !GLOBAL_ROLES.has(actor.profile.role) &&
    actor.profile.station !== station
  )
    throw httpError(403, "Station berada di luar scope akun.");
}

function stableId(actor, requestId) {
  if (!/^[a-zA-Z0-9-]{12,120}$/.test(requestId))
    throw httpError(400, "Request ID tidak valid.");
  return createHash("sha256")
    .update(`${actor.decoded.uid}|${requestId}`)
    .digest("hex");
}

function logBatch(batch, db, actor, data) {
  batch.create(db.collection("displayActivityLogs").doc(), {
    ...data,
    actorId: actor.decoded.uid,
    actorName: text(actor.profile.name || actor.decoded.email, 120),
    createdAt: new Date(),
  });
}

async function saveContent(db, actor, input) {
  requireConfig(actor);
  const id = text(input.id, 160) || stableId(actor, text(input.requestId, 120));
  const title = text(input.title, 120);
  const contentType = text(input.contentType, 40);
  const sourceUrl = text(input.sourceUrl, 2000);
  const station = text(input.station, 12) || "ALL";
  if (!title || !CONTENT_TYPES.has(contentType))
    throw httpError(400, "Judul dan jenis content wajib valid.");
  if (!sourceUrl)
    throw httpError(400, "Source URL atau hasil upload wajib tersedia.");
  const localDemoMedia =
    ["Image", "Video"].includes(contentType) &&
    /^\/demo-media\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(sourceUrl) &&
    !sourceUrl.includes("..");
  let secureExternalUrl = false;
  try {
    secureExternalUrl = new URL(sourceUrl).protocol === "https:";
  } catch {
    secureExternalUrl = false;
  }
  if (!localDemoMedia && !secureExternalUrl)
    throw httpError(
      400,
      "Gunakan HTTPS atau path lokal /demo-media/... untuk Image dan Video.",
    );
  if (station !== "ALL") requireStation(actor, station);
  const ref = db.collection("displayContents").doc(id);
  const existing = await ref.get();
  await ref.set(
    {
      id,
      title,
      contentType,
      sourceUrl,
      storagePath: text(input.storagePath, 1000),
      station,
      durationSeconds: Math.max(
        0,
        Math.min(86400, Number(input.durationSeconds) || 0),
      ),
      status: input.status === "Inactive" ? "Inactive" : "Active",
      description: text(input.description, 1000),
      updatedAt: new Date(),
      updatedBy: actor.decoded.uid,
      ...(existing.exists
        ? {}
        : { createdAt: new Date(), createdBy: actor.decoded.uid }),
    },
    { merge: true },
  );
  await db.collection("displayActivityLogs").add({
    action: existing.exists
      ? "DISPLAY_CONTENT_UPDATED"
      : "DISPLAY_CONTENT_CREATED",
    station,
    contentId: id,
    actorId: actor.decoded.uid,
    actorName: text(actor.profile.name, 120),
    createdAt: new Date(),
  });
  return { id, status: "Saved" };
}

async function saveChannel(db, actor, input) {
  requireConfig(actor);
  const id = text(input.id, 160) || stableId(actor, text(input.requestId, 120));
  const name = text(input.name, 120);
  const contentIds = [
    ...new Set(
      Array.isArray(input.contentIds)
        ? input.contentIds.map((value) => text(value, 160)).filter(Boolean)
        : [],
    ),
  ];
  if (!name || !contentIds.length)
    throw httpError(
      400,
      "Nama channel dan minimal satu content wajib tersedia.",
    );
  const snapshots = await Promise.all(
    contentIds.map((contentId) =>
      db.collection("displayContents").doc(contentId).get(),
    ),
  );
  if (
    snapshots.some(
      (snapshot) => !snapshot.exists || snapshot.data()?.status !== "Active",
    )
  )
    throw httpError(
      409,
      "Channel memuat content yang tidak aktif atau tidak ditemukan.",
    );
  const ref = db.collection("displayChannels").doc(id);
  const existing = await ref.get();
  await ref.set(
    {
      id,
      name,
      description: text(input.description, 1000),
      contentIds,
      status: input.status === "Inactive" ? "Inactive" : "Active",
      updatedAt: new Date(),
      updatedBy: actor.decoded.uid,
      ...(existing.exists
        ? {}
        : { createdAt: new Date(), createdBy: actor.decoded.uid }),
    },
    { merge: true },
  );
  await db.collection("displayActivityLogs").add({
    action: existing.exists
      ? "DISPLAY_CHANNEL_UPDATED"
      : "DISPLAY_CHANNEL_CREATED",
    station: "ALL",
    channelId: id,
    actorId: actor.decoded.uid,
    actorName: text(actor.profile.name, 120),
    createdAt: new Date(),
  });
  return { id, status: "Saved" };
}

function validateSchedule(input) {
  const startDate = text(input.startDate, 10);
  const endDate = text(input.endDate, 10);
  const startTime = text(input.startTime, 5);
  const endTime = text(input.endTime, 5);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
    startDate > endDate
  )
    throw httpError(400, "Rentang tanggal schedule tidak valid.");
  if (
    !/^\d{2}:\d{2}$/.test(startTime) ||
    !/^\d{2}:\d{2}$/.test(endTime) ||
    startTime >= endTime
  )
    throw httpError(400, "Rentang jam schedule tidak valid.");
  const daysOfWeek = [
    ...new Set(
      Array.isArray(input.daysOfWeek)
        ? input.daysOfWeek.map(Number).filter((day) => day >= 1 && day <= 7)
        : [],
    ),
  ];
  if (!daysOfWeek.length)
    throw httpError(400, "Minimal satu hari operasi wajib dipilih.");
  return { startDate, endDate, startTime, endTime, daysOfWeek };
}

async function saveSchedule(db, actor, input) {
  requireSchedule(actor);
  const station = text(input.station, 12);
  requireStation(actor, station);
  const id = text(input.id, 160) || stableId(actor, text(input.requestId, 120));
  const title = text(input.title, 120);
  const channelId = text(input.channelId, 160);
  const deviceIds = [
    ...new Set(
      Array.isArray(input.deviceIds)
        ? input.deviceIds.map((value) => text(value, 160)).filter(Boolean)
        : [],
    ),
  ];
  const range = validateSchedule(input);
  if (!title || !channelId || !deviceIds.length)
    throw httpError(
      400,
      "Judul, channel, dan minimal satu device wajib dipilih.",
    );
  const [channel, ...deviceSnapshots] = await Promise.all([
    db.collection("displayChannels").doc(channelId).get(),
    ...deviceIds.map((deviceId) =>
      db.collection("displayDevices").doc(deviceId).get(),
    ),
  ]);
  if (!channel.exists || channel.data()?.status !== "Active")
    throw httpError(409, "Channel tidak aktif atau tidak ditemukan.");
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
      "Semua device harus Approved dan berada di station schedule.",
    );
  const activeSchedules = await db
    .collection("displaySchedules")
    .where("station", "==", station)
    .get();
  const conflict = activeSchedules.docs.find((snapshot) => {
    if (snapshot.id === id) return false;
    const row = snapshot.data();
    return (
      row.status === "Active" &&
      row.startDate <= range.endDate &&
      row.endDate >= range.startDate &&
      row.startTime < range.endTime &&
      row.endTime > range.startTime &&
      (row.daysOfWeek || []).some((day) => range.daysOfWeek.includes(day)) &&
      (row.deviceIds || []).some((deviceId) => deviceIds.includes(deviceId))
    );
  });
  if (conflict)
    throw httpError(
      409,
      `Schedule bentrok dengan ${conflict.data().title || conflict.id}.`,
      "DISPLAY_SCHEDULE_CONFLICT",
    );
  const ref = db.collection("displaySchedules").doc(id);
  const existing = await ref.get();
  const batch = db.batch();
  batch.set(
    ref,
    {
      id,
      station,
      title,
      channelId,
      channelName: channel.data().name,
      deviceIds,
      ...range,
      overlayEnabled: input.overlayEnabled === true,
      overlayText: text(input.overlayText, 500),
      priority: ["Normal", "High", "Emergency"].includes(input.priority)
        ? input.priority
        : "Normal",
      status: input.status === "Inactive" ? "Inactive" : "Active",
      updatedAt: new Date(),
      updatedBy: actor.decoded.uid,
      ...(existing.exists
        ? {}
        : { createdAt: new Date(), createdBy: actor.decoded.uid }),
    },
    { merge: true },
  );
  logBatch(batch, db, actor, {
    action: existing.exists
      ? "DISPLAY_SCHEDULE_UPDATED"
      : "DISPLAY_SCHEDULE_CREATED",
    station,
    scheduleId: id,
  });
  await batch.commit();
  return { id, status: "Saved" };
}

async function remove(db, actor, input) {
  const kind = text(input.kind, 30);
  const id = text(input.id, 160);
  if (!id) throw httpError(400, "ID wajib tersedia.");
  if (kind === "schedule") {
    requireSchedule(actor);
    const ref = db.collection("displaySchedules").doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) return { id, status: "Deleted" };
    requireStation(actor, snapshot.data().station);
    await ref.delete();
    return { id, status: "Deleted" };
  }
  requireConfig(actor);
  if (kind === "channel") {
    const used = await db
      .collection("displaySchedules")
      .where("channelId", "==", id)
      .get();
    if (used.docs.some((row) => row.data().status === "Active"))
      throw httpError(409, "Channel masih digunakan schedule aktif.");
    await db.collection("displayChannels").doc(id).delete();
    return { id, status: "Deleted" };
  }
  if (kind === "content") {
    const channels = await db.collection("displayChannels").get();
    if (channels.docs.some((row) => (row.data().contentIds || []).includes(id)))
      throw httpError(409, "Content masih digunakan oleh channel.");
    await db.collection("displayContents").doc(id).delete();
    return { id, status: "Deleted" };
  }
  throw httpError(400, "Jenis data display tidak valid.");
}

const handler = async (request) => {
  try {
    if (request.method !== "POST")
      return json(405, { error: "Method not allowed." });
    const actor = await requireUser(request);
    requireFacilityUser(actor);
    const input = await request.json();
    const action = text(input.action, 40).toLowerCase();
    const db = targetDb();
    if (action === "savecontent")
      return json(200, await saveContent(db, actor, input));
    if (action === "savechannel")
      return json(200, await saveChannel(db, actor, input));
    if (action === "saveschedule")
      return json(200, await saveSchedule(db, actor, input));
    if (action === "delete") return json(200, await remove(db, actor, input));
    throw httpError(400, "Display action tidak valid.");
  } catch (error) {
    return failure(error);
  }
};

export default handler;
