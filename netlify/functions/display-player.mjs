import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { failure, httpError, targetDb } from "./_firebase-admin.mjs";

const text = (value, max = 500) => String(value || "").trim().slice(0, max);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const noStoreJson = (status, value) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function secretMatches(secret, expectedHash) {
  const actual = Buffer.from(sha(secret));
  const expected = Buffer.from(String(expectedHash || ""));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function authenticateDevice(db, input) {
  const deviceId = text(input.deviceId, 160);
  const secret = text(input.deviceSecret, 200);
  if (!deviceId || !secret) throw httpError(401, "Device credential wajib tersedia.");
  const [snapshot, credential] = await Promise.all([
    db.collection("displayDevices").doc(deviceId).get(),
    db.collection("displayDeviceCredentials").doc(deviceId).get(),
  ]);
  if (!snapshot.exists || !credential.exists || !secretMatches(secret, credential.data()?.secretHash))
    throw httpError(401, "Device credential tidak valid.");
  const device = { id: snapshot.id, ...snapshot.data() };
  if (device.status === "Disabled" || device.enrollmentStatus !== "Enrolled")
    throw httpError(403, "Device tidak aktif atau enrollment telah dicabut.");
  return device;
}

async function claim(db, input) {
  const code = text(input.code, 16).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 8) throw httpError(400, "Kode enrollment harus 8 karakter.");
  const enrollmentRef = db.collection("displayEnrollments").doc(sha(code));
  const secret = randomBytes(32).toString("base64url");
  const result = await db.runTransaction(async (transaction) => {
    const enrollment = await transaction.get(enrollmentRef);
    if (!enrollment.exists) throw httpError(404, "Kode enrollment tidak ditemukan.");
    const data = enrollment.data();
    if (data.status !== "Pending" || data.expiresAt.toDate().getTime() < Date.now())
      throw httpError(409, "Kode enrollment sudah digunakan atau kedaluwarsa.");
    const deviceRef = db.collection("displayDevices").doc(data.deviceId);
    const credentialRef = db.collection("displayDeviceCredentials").doc(data.deviceId);
    const deviceSnapshot = await transaction.get(deviceRef);
    if (!deviceSnapshot.exists || deviceSnapshot.data()?.approvalStatus !== "Approved")
      throw httpError(409, "Device tidak ditemukan atau belum Approved.");
    transaction.update(enrollmentRef, { status: "Used", usedAt: new Date() });
    transaction.set(credentialRef, { deviceId: data.deviceId, secretHash: sha(secret), createdAt: new Date(), rotatedAt: new Date() });
    transaction.update(deviceRef, {
      enrollmentStatus: "Enrolled",
      status: "Online",
      playerVersion: text(input.playerVersion, 40),
      enrolledAt: new Date(),
      lastHeartbeat: new Date(),
      updatedAt: new Date(),
    });
    return { id: deviceSnapshot.id, ...deviceSnapshot.data() };
  });
  await db.collection("displayActivityLogs").add({ action: "DISPLAY_PLAYER_ENROLLED", station: result.station, deviceId: result.id, actorId: result.id, actorName: result.name, createdAt: new Date() });
  return { deviceId: result.id, deviceSecret: secret, name: result.name, station: result.station, roomId: result.roomId, status: "Enrolled" };
}

function localClock(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const day = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[value.weekday];
  return { date: `${value.year}-${value.month}-${value.day}`, time: `${value.hour}:${value.minute}`, day };
}

async function channelPlan(db, channelId) {
  const channel = await db.collection("displayChannels").doc(channelId).get();
  if (!channel.exists || channel.data()?.status !== "Active") return null;
  const data = channel.data();
  const snapshots = await Promise.all((data.contentIds || []).map((id) => db.collection("displayContents").doc(id).get()));
  const items = snapshots.filter((item) => item.exists && item.data()?.status === "Active").map((item) => ({ id: item.id, ...item.data() }));
  if (!items.length) return null;
  return { channelId: channel.id, channelName: data.name, items };
}

async function schedulePlan(db, device) {
  const station = await db.collection("stations").doc(device.station).get();
  const timeZone = text(station.data()?.timeZone, 80) || "Asia/Jakarta";
  const clock = localClock(new Date(), timeZone);
  const schedules = await db.collection("displaySchedules").where("station", "==", device.station).get();
  const matches = schedules.docs
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
    .filter((row) => row.status === "Active" && row.deviceIds?.includes(device.id)
      && row.startDate <= clock.date && row.endDate >= clock.date
      && row.startTime <= clock.time && row.endTime > clock.time
      && row.daysOfWeek?.includes(clock.day))
    .sort((a, b) => {
      const priority = ({ Emergency: 3, High: 2, Normal: 1 }[b.priority] || 0) - ({ Emergency: 3, High: 2, Normal: 1 }[a.priority] || 0);
      if (priority) return priority;
      const aTime = a.updatedAt?.toDate?.().getTime() || a.createdAt?.toDate?.().getTime() || 0;
      const bTime = b.updatedAt?.toDate?.().getTime() || b.createdAt?.toDate?.().getTime() || 0;
      return bTime - aTime;
    });
  const selected = matches[0];
  if (!selected) return null;
  const channel = await channelPlan(db, selected.channelId);
  return channel ? { source: "Schedule", scheduleId: selected.id, scheduleTitle: selected.title, overlayEnabled: selected.overlayEnabled === true, overlayText: text(selected.overlayText, 500), ...channel } : null;
}

async function acknowledge(db, device, acknowledgments) {
  const rows = Array.isArray(acknowledgments) ? acknowledgments.slice(0, 20) : [];
  if (!rows.length) return;
  const refs = rows.map((row) => db.collection("displayCommands").doc(text(row.commandId, 160)));
  const snapshots = await Promise.all(refs.map((ref) => ref.get()));
  const batch = db.batch();
  snapshots.forEach((snapshot, index) => {
    const row = rows[index];
    if (!snapshot.exists || snapshot.data()?.deviceId !== device.id || snapshot.data()?.status !== "Pending") return;
    const status = row.status === "Failed" ? "Failed" : "Executed";
    batch.update(snapshot.ref, { status, message: text(row.message, 500), acknowledgedAt: new Date(), updatedAt: new Date() });
    batch.create(db.collection("displayActivityLogs").doc(), { action: `DISPLAY_COMMAND_${status.toUpperCase()}`, station: device.station, deviceId: device.id, commandId: snapshot.id, actorId: device.id, actorName: device.name, detail: text(row.message, 500), createdAt: new Date() });
  });
  await batch.commit();
}

async function heartbeat(db, input) {
  const device = await authenticateDevice(db, input);
  await acknowledge(db, device, input.acknowledgments);
  const state = input.state || {};
  const capabilities = input.capabilities || {};
  await db.collection("displayDevices").doc(device.id).update({
    status: state.status === "Degraded" ? "Degraded" : "Online",
    nowPlaying: text(state.nowPlaying, 160),
    overlayText: text(state.overlayText, 500),
    playerVersion: text(input.playerVersion, 40),
    capabilities,
    lastError: text(state.lastError, 500),
    lastHeartbeat: new Date(),
    updatedAt: new Date(),
  });
  const commandSnapshots = await db.collection("displayCommands").where("deviceId", "==", device.id).get();
  const commandRows = commandSnapshots.docs
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
  const expired = commandRows.filter((row) => row.status === "Pending" && row.expiresAt?.toDate?.().getTime() <= Date.now());
  if (expired.length) {
    const batch = db.batch();
    expired.forEach((row) => batch.update(db.collection("displayCommands").doc(row.id), { status: "Expired", updatedAt: new Date() }));
    await batch.commit();
  }
  const commands = commandRows
    .filter((row) => row.status === "Pending" && row.expiresAt?.toDate?.().getTime() > Date.now())
    .sort((a, b) => a.createdAt.toDate().getTime() - b.createdAt.toDate().getTime())
    .slice(0, 10);
  for (const command of commands) {
    if (command.type === "PLAY_CHANNEL") command.playback = await channelPlan(db, command.payload?.channelId);
  }
  return { serverTime: new Date().toISOString(), device: { id: device.id, name: device.name, station: device.station, roomId: device.roomId }, schedule: await schedulePlan(db, device), commands };
}

const handler = async (request) => {
  try {
    if (request.method !== "POST") return noStoreJson(405, { error: "Method not allowed." });
    const input = await request.json();
    const action = text(input.action, 30).toLowerCase();
    const db = targetDb();
    if (action === "claim") return noStoreJson(200, await claim(db, input));
    if (action === "heartbeat") return noStoreJson(200, await heartbeat(db, input));
    throw httpError(400, "Player action tidak valid.");
  } catch (error) {
    const response = failure(error);
    return new Response(response.body, { status: response.status, headers: { ...Object.fromEntries(response.headers), "cache-control": "no-store" } });
  }
};

export default handler;
