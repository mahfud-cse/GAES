import { createHash } from "node:crypto";
import {
  failure,
  httpError,
  json,
  requireUser,
  targetDb,
} from "./_firebase-admin.mjs";

const OPERATOR_ROLES = new Set([
  "Super Admin",
  "Admin",
  "BO Admin",
  "Lounge Officer",
  "Lounge Manager",
]);
const GLOBAL_ROLES = new Set(["Super Admin", "Admin"]);
const ADMIN_ROLES = new Set(["Super Admin", "Admin"]);
const CHECKS = [
  "roomsReviewed",
  "incidentsReviewed",
  "devicesReviewed",
  "announcementsReviewed",
  "offlinePlanConfirmed",
  "emergencyContactsConfirmed",
];
const text = (value, maximum = 500) =>
  String(value ?? "").trim().slice(0, maximum);

function requireOperator(actor) {
  if (!OPERATOR_ROLES.has(actor.profile.role))
    throw httpError(403, "Role tidak memiliki akses Shift Handover.");
}

function requireStation(actor, station) {
  if (!/^[A-Z]{3}$/.test(station))
    throw httpError(400, "Station handover wajib berupa kode tiga huruf.");
  if (!GLOBAL_ROLES.has(actor.profile.role) && actor.profile.station !== station)
    throw httpError(403, "Station handover berada di luar scope akun.");
}

async function continuitySnapshot(db, station) {
  const now = new Date();
  const [
    rooms,
    maintenance,
    incidents,
    devices,
    announcements,
    commands,
  ] = await Promise.all([
    db.collection("rooms").where("station", "==", station).get(),
    db.collection("roomMaintenance").where("station", "==", station).get(),
    db.collection("roomIncidents").where("station", "==", station).get(),
    db.collection("displayDevices").where("station", "==", station).get(),
    db.collection("displayAnnouncements").where("station", "==", station).get(),
    db.collection("displayCommands").where("station", "==", station).get(),
  ]);
  const enrolledDeviceRows = devices.docs.filter(
    (row) => row.data().enrollmentStatus === "Enrolled",
  );
  const offlineDevices = enrolledDeviceRows.filter((row) => {
    const data = row.data();
    const heartbeat = data.lastHeartbeat?.toDate?.() || new Date(data.lastHeartbeat || 0);
    return !Number.isFinite(heartbeat.getTime()) || now.getTime() - heartbeat.getTime() > 60_000;
  }).length;

  return {
    capturedAt: now,
    occupiedRooms: rooms.docs.filter(
      (row) => row.data().operationalState === "Occupied",
    ).length,
    cleaningRooms: rooms.docs.filter(
      (row) => row.data().operationalState === "Cleaning",
    ).length,
    maintenanceRooms: maintenance.docs.filter(
      (row) => row.data().status === "Open",
    ).length,
    openIncidents: incidents.docs.filter((row) => row.data().status === "Open")
      .length,
    enrolledDevices: enrolledDeviceRows.length,
    offlineDevices,
    activeAnnouncements: announcements.docs.filter(
      (row) => row.data().status === "Active",
    ).length,
    pendingCommands: commands.docs.filter((row) => row.data().status === "Pending")
      .length,
  };
}

async function createHandover(db, actor, input) {
  const station = text(input.station, 3).toUpperCase();
  requireStation(actor, station);
  const shiftName = text(input.shiftName, 80);
  const handoverTo = text(input.handoverTo, 120);
  const summary = text(input.summary, 2000);
  const priorityNote = text(input.priorityNote, 1000);
  const requestId = text(input.requestId, 120);
  const checklist = input.checklist || {};
  if (!shiftName || !handoverTo || !summary)
    throw httpError(400, "Shift, penerima handover, dan ringkasan wajib diisi.");
  if (!/^[a-zA-Z0-9-]{12,120}$/.test(requestId))
    throw httpError(400, "Request ID handover tidak valid.");
  if (!CHECKS.every((key) => checklist[key] === true))
    throw httpError(409, "Seluruh continuity checklist wajib dikonfirmasi sebelum handover.");

  const id = createHash("sha256")
    .update(`${actor.decoded.uid}|${requestId}`)
    .digest("hex");
  const ref = db.collection("shiftHandovers").doc(id);
  const lockRef = db.collection("shiftHandoverLocks").doc(station);
  const snapshot = await continuitySnapshot(db, station);
  const now = new Date();
  return db.runTransaction(async (transaction) => {
    const [existing, lock] = await Promise.all([
      transaction.get(ref),
      transaction.get(lockRef),
    ]);
    if (existing.exists)
      return { id, status: existing.data().status, replayed: true };
    if (lock.exists && lock.data().status === "Pending")
      throw httpError(409, "Masih ada shift handover yang menunggu acknowledgment.");
    transaction.create(ref, {
      id,
      station,
      shiftDate: text(input.shiftDate, 10) || now.toISOString().slice(0, 10),
      shiftName,
      handoverTo,
      summary,
      priorityNote,
      checklist: Object.fromEntries(CHECKS.map((key) => [key, true])),
      snapshot,
      status: "Pending",
      outgoingUserId: actor.decoded.uid,
      outgoingName: text(actor.profile.name || actor.decoded.email, 120),
      createdAt: now,
      updatedAt: now,
    });
    transaction.set(lockRef, {
      station,
      handoverId: id,
      status: "Pending",
      updatedAt: now,
    });
    transaction.create(db.collection("roomActivityLogs").doc(), {
      action: "SHIFT_HANDOVER_SUBMITTED",
      station,
      roomId: "",
      shiftHandoverId: id,
      actorId: actor.decoded.uid,
      actorName: text(actor.profile.name || actor.decoded.email, 120),
      reason: `${shiftName} → ${handoverTo}`,
      createdAt: now,
    });
    return { id, status: "Pending", replayed: false };
  });
}

async function acknowledgeHandover(db, actor, input) {
  const id = text(input.id, 160);
  const acknowledgmentNote = text(input.acknowledgmentNote, 1000);
  if (!id) throw httpError(400, "Shift handover ID wajib tersedia.");
  const ref = db.collection("shiftHandovers").doc(id);
  return db.runTransaction(async (transaction) => {
    const document = await transaction.get(ref);
    if (!document.exists) throw httpError(404, "Shift handover tidak ditemukan.");
    const data = document.data();
    requireStation(actor, data.station);
    if (data.status === "Acknowledged")
      return { id, status: "Acknowledged", replayed: true };
    if (data.status !== "Pending")
      throw httpError(409, `Shift handover berstatus ${data.status}.`);
    if (data.outgoingUserId === actor.decoded.uid && !ADMIN_ROLES.has(actor.profile.role))
      throw httpError(409, "Shift penerima harus menggunakan akun berbeda untuk acknowledgment.");
    const lockRef = db.collection("shiftHandoverLocks").doc(data.station);
    const lock = await transaction.get(lockRef);
    const now = new Date();
    transaction.update(ref, {
      status: "Acknowledged",
      acknowledgedBy: actor.decoded.uid,
      acknowledgedByName: text(actor.profile.name || actor.decoded.email, 120),
      acknowledgmentNote,
      acknowledgedAt: now,
      updatedAt: now,
    });
    if (lock.exists && lock.data().handoverId === id)
      transaction.update(lockRef, { status: "Acknowledged", updatedAt: now });
    transaction.create(db.collection("roomActivityLogs").doc(), {
      action: "SHIFT_HANDOVER_ACKNOWLEDGED",
      station: data.station,
      roomId: "",
      shiftHandoverId: id,
      actorId: actor.decoded.uid,
      actorName: text(actor.profile.name || actor.decoded.email, 120),
      reason: acknowledgmentNote || `${data.shiftName} accepted`,
      createdAt: now,
    });
    return { id, status: "Acknowledged", replayed: false };
  });
}

const handler = async (request) => {
  try {
    if (request.method !== "POST")
      return json(405, { error: "Method not allowed." });
    const actor = await requireUser(request);
    requireOperator(actor);
    const input = await request.json();
    const action = text(input.action, 40).toLowerCase();
    const db = targetDb();
    if (action === "create")
      return json(201, await createHandover(db, actor, input));
    if (action === "acknowledge")
      return json(200, await acknowledgeHandover(db, actor, input));
    throw httpError(400, "Shift handover action tidak valid.");
  } catch (error) {
    return failure(error);
  }
};

export default handler;
