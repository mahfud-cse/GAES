import { createHash, randomBytes, randomUUID } from "node:crypto";
import { failure, httpError, json, requireUser, targetDb } from "./_firebase-admin.mjs";

const CONTROL_ROLES = new Set(["Super Admin", "Admin", "HO Admin", "BO Admin", "Lounge Officer", "Lounge Manager"]);
const GLOBAL_ROLES = new Set(["Super Admin", "Admin", "HO Admin"]);
const COMMANDS = new Set(["PLAY_CHANNEL", "SET_OVERLAY", "CLEAR_OVERLAY", "PAUSE", "RESUME", "REFRESH", "REQUEST_SCREENSHOT"]);
const text = (value, max = 500) => String(value || "").trim().slice(0, max);
const sha = (value) => createHash("sha256").update(value).digest("hex");

function requireController(actor) {
  if (!CONTROL_ROLES.has(actor.profile.role)) throw httpError(403, "Role tidak memiliki akses remote display.");
}

function requireStation(actor, station) {
  if (!GLOBAL_ROLES.has(actor.profile.role) && actor.profile.station !== station)
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
  if (device.approvalStatus !== "Approved" || device.status === "Disabled")
    throw httpError(409, "Device harus Approved dan tidak Disabled sebelum enrollment.");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  const code = Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("").slice(0, 8);
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
  return { deviceId, code, expiresAt: expiresAt.toISOString(), status: "Pending" };
}

async function sendCommand(db, actor, input) {
  const deviceId = text(input.deviceId, 160);
  const type = text(input.type, 40).toUpperCase();
  if (!COMMANDS.has(type)) throw httpError(400, "Jenis remote command tidak valid.");
  const device = await loadDevice(db, actor, deviceId);
  if (device.enrollmentStatus !== "Enrolled") throw httpError(409, "Device belum ter-enroll pada player.");
  const commandId = randomUUID();
  const expiresAt = new Date(Date.now() + (type === "REFRESH" ? 5 : 15) * 60 * 1000);
  const payload = {
    channelId: text(input.channelId, 160),
    overlayText: text(input.overlayText, 500),
    overrideUntil: new Date(Date.now() + Math.max(5, Math.min(480, Number(input.durationMinutes) || 60)) * 60 * 1000).toISOString(),
  };
  if (type === "PLAY_CHANNEL") {
    const channel = await db.collection("displayChannels").doc(payload.channelId).get();
    if (!channel.exists || channel.data()?.status !== "Active") throw httpError(409, "Channel aktif tidak ditemukan.");
  }
  if (type === "SET_OVERLAY" && !payload.overlayText) throw httpError(400, "Running text wajib diisi.");
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
  return { id: commandId, status: "Pending", expiresAt: expiresAt.toISOString() };
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
  batch.create(db.collection("displayActivityLogs").doc(), { action: "DISPLAY_ENROLLMENT_REVOKED", station: device.station, deviceId, actorId: actor.decoded.uid, actorName: text(actor.profile.name, 120), createdAt: new Date() });
  await batch.commit();
  return { id: deviceId, status: "Revoked" };
}

const handler = async (request) => {
  try {
    if (request.method !== "POST") return json(405, { error: "Method not allowed." });
    const actor = await requireUser(request);
    requireController(actor);
    const input = await request.json();
    const action = text(input.action, 40).toLowerCase();
    const db = targetDb();
    if (action === "createenrollment") return json(200, await createEnrollment(db, actor, input));
    if (action === "command") return json(200, await sendCommand(db, actor, input));
    if (action === "revoke") return json(200, await revoke(db, actor, input));
    throw httpError(400, "Device management action tidak valid.");
  } catch (error) {
    return failure(error);
  }
};

export default handler;
