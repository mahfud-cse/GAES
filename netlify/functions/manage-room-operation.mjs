import { createHash } from "node:crypto";
import { failure, httpError, json, requireUser, targetDb } from "./_firebase-admin.mjs";
import { buildSlots } from "./manage-room-booking.mjs";

const USER_ROLES = new Set([
  "Super Admin",
  "Admin",
  "BO Admin",
  "Lounge Officer",
  "Lounge Manager",
]);
const GLOBAL_ROLES = new Set(["Super Admin", "Admin", "HO Admin"]);
const SUPERVISOR_ROLES = new Set([
  "Super Admin",
  "Admin",
  "BO Admin",
  "Lounge Manager",
]);
const text = (value, max = 500) => String(value || "").trim().slice(0, max);

function requireOperator(actor) {
  if (!USER_ROLES.has(actor.profile.role))
    throw httpError(403, "Role tidak memiliki akses Room Operations.");
}

function requireSupervisor(actor) {
  if (!SUPERVISOR_ROLES.has(actor.profile.role))
    throw httpError(403, "Action memerlukan Lounge Manager, BO Admin, atau Admin.");
}

function requireStation(actor, station) {
  if (!GLOBAL_ROLES.has(actor.profile.role) && actor.profile.station !== station)
    throw httpError(403, "Room berada di luar scope station akun.");
}

function activity(transaction, db, actor, data) {
  transaction.create(db.collection("roomActivityLogs").doc(), {
    ...data,
    actorId: actor.decoded.uid,
    actorName: text(actor.profile.name || actor.decoded.email, 120),
    createdAt: new Date(),
  });
}

async function bookingOperation(db, actor, action, input) {
  const bookingId = text(input.bookingId, 160);
  if (!bookingId) throw httpError(400, "Booking ID wajib tersedia.");
  const bookingRef = db.collection("roomBookings").doc(bookingId);
  const initial = await bookingRef.get();
  if (!initial.exists) throw httpError(404, "Room booking tidak ditemukan.");
  const booking = { id: initial.id, ...initial.data() };
  requireStation(actor, booking.station);
  const roomRef = db.collection("rooms").doc(booking.roomId);
  const operationRef = db.collection("roomOperations").doc(bookingId);

  return db.runTransaction(async (transaction) => {
    const [bookingSnapshot, roomSnapshot, operationSnapshot] = await Promise.all([
      transaction.get(bookingRef),
      transaction.get(roomRef),
      transaction.get(operationRef),
    ]);
    if (!bookingSnapshot.exists || !roomSnapshot.exists)
      throw httpError(404, "Booking atau room tidak ditemukan.");
    const latest = bookingSnapshot.data();
    const room = roomSnapshot.data();
    const operation = operationSnapshot.data();
    const now = Date.now();

    if (action === "checkin") {
      if (latest.status === "Checked-in" && operation?.status === "Checked-in")
        return { id: bookingId, status: "Checked-in", replayed: true };
      if (latest.status !== "Approved")
        throw httpError(409, `Booking berstatus ${latest.status}; hanya Approved yang dapat check-in.`);
      if (!["Available", "Reserved"].includes(room.operationalState))
        throw httpError(409, `Room sedang ${room.operationalState} dan tidak dapat digunakan.`);
      const checklist = input.checklist || {};
      const checklistReady = ["clean", "avReady", "amenitiesReady", "safetyChecked", "tvReady"]
        .every((key) => checklist[key] === true);
      const overrideReason = text(input.overrideReason, 500);
      if (!checklistReady && (!SUPERVISOR_ROLES.has(actor.profile.role) || !overrideReason))
        throw httpError(409, "Seluruh readiness checklist wajib siap atau memerlukan supervisor override.");
      const start = Date.parse(latest.startAt);
      const end = Date.parse(latest.endAt);
      const inWindow = now >= start - 2 * 60 * 60 * 1000 && now <= end + 2 * 60 * 60 * 1000;
      if (!inWindow && (!SUPERVISOR_ROLES.has(actor.profile.role) || !overrideReason))
        throw httpError(409, "Check-in berada di luar operational window. Supervisor override diperlukan.");

      transaction.set(operationRef, {
        id: bookingId,
        bookingId,
        station: latest.station,
        roomId: latest.roomId,
        roomName: latest.roomName,
        status: "Checked-in",
        checklist,
        readinessNote: text(input.readinessNote, 1000),
        overrideReason,
        checkedInAt: new Date(),
        checkedInBy: actor.decoded.uid,
        checkedInByName: text(actor.profile.name, 120),
        updatedAt: new Date(),
      }, { merge: true });
      transaction.update(bookingRef, { status: "Checked-in", checkedInAt: new Date(), updatedAt: new Date() });
      transaction.update(roomRef, { operationalState: "Occupied", activeBookingId: bookingId, updatedAt: new Date() });
      activity(transaction, db, actor, { action: "ROOM_CHECK_IN", bookingId, station: latest.station, roomId: latest.roomId });
      return { id: bookingId, status: "Checked-in", replayed: false };
    }

    if (action === "checkout") {
      if (latest.status === "Completed" && operation?.status === "Cleaning")
        return { id: bookingId, status: "Cleaning", replayed: true };
      if (latest.status !== "Checked-in" || operation?.status !== "Checked-in")
        throw httpError(409, "Hanya booking Checked-in yang dapat check-out.");
      transaction.update(bookingRef, { status: "Completed", checkedOutAt: new Date(), updatedAt: new Date() });
      transaction.update(operationRef, {
        status: "Cleaning",
        handoverTo: text(input.handoverTo, 120),
        handoverNote: text(input.handoverNote, 1000),
        issueSummary: text(input.issueSummary, 1000),
        checkedOutAt: new Date(),
        checkedOutBy: actor.decoded.uid,
        updatedAt: new Date(),
      });
      transaction.update(roomRef, { operationalState: "Cleaning", activeBookingId: "", updatedAt: new Date() });
      activity(transaction, db, actor, { action: "ROOM_CHECK_OUT", bookingId, station: latest.station, roomId: latest.roomId });
      return { id: bookingId, status: "Cleaning", replayed: false };
    }

    if (action === "completecleaning") {
      if (operation?.status === "Completed" && room.operationalState === "Available")
        return { id: bookingId, status: "Available", replayed: true };
      if (operation?.status !== "Cleaning" || room.operationalState !== "Cleaning")
        throw httpError(409, "Room tidak berada dalam status Cleaning.");
      const cleaningChecklist = input.cleaningChecklist || {};
      const cleaningComplete = ["clean", "amenities", "damageChecked"]
        .every((key) => cleaningChecklist[key] === true);
      if (!cleaningComplete)
        throw httpError(409, "Seluruh cleaning completion checklist wajib diselesaikan.");
      (latest.slotIds || []).forEach((id) => transaction.delete(db.collection("roomBookingSlots").doc(id)));
      transaction.update(operationRef, {
        status: "Completed",
        cleaningChecklist,
        cleaningNote: text(input.cleaningNote, 1000),
        cleaningCompletedAt: new Date(),
        cleaningCompletedBy: actor.decoded.uid,
        updatedAt: new Date(),
      });
      transaction.update(roomRef, { operationalState: "Available", activeBookingId: "", updatedAt: new Date() });
      activity(transaction, db, actor, { action: "ROOM_CLEANING_COMPLETED", bookingId, station: latest.station, roomId: latest.roomId });
      return { id: bookingId, status: "Available", replayed: false };
    }

    if (action === "noshow") {
      requireSupervisor(actor);
      if (latest.status !== "Approved")
        throw httpError(409, "Hanya booking Approved yang dapat ditandai No Show.");
      const reason = text(input.reason, 500);
      if (!reason) throw httpError(400, "Alasan No Show wajib diisi.");
      (latest.slotIds || []).forEach((id) => transaction.delete(db.collection("roomBookingSlots").doc(id)));
      transaction.update(bookingRef, { status: "No Show", noShowReason: reason, noShowAt: new Date(), updatedAt: new Date() });
      transaction.set(operationRef, {
        id: bookingId,
        bookingId,
        station: latest.station,
        roomId: latest.roomId,
        roomName: latest.roomName,
        status: "No Show",
        reason,
        updatedAt: new Date(),
      }, { merge: true });
      if (room.activeBookingId === bookingId || room.operationalState === "Reserved")
        transaction.update(roomRef, { operationalState: "Available", activeBookingId: "", updatedAt: new Date() });
      activity(transaction, db, actor, { action: "ROOM_BOOKING_NO_SHOW", bookingId, station: latest.station, roomId: latest.roomId, reason });
      return { id: bookingId, status: "No Show", replayed: false };
    }

    throw httpError(400, "Room operation action tidak valid.");
  });
}

async function moveRoom(db, actor, input) {
  requireSupervisor(actor);
  const bookingId = text(input.bookingId, 160);
  const targetRoomId = text(input.targetRoomId, 160);
  const reason = text(input.reason, 500);
  if (!bookingId || !targetRoomId || !reason)
    throw httpError(400, "Booking, target room, dan alasan perpindahan wajib diisi.");
  const bookingRef = db.collection("roomBookings").doc(bookingId);
  const initial = await bookingRef.get();
  if (!initial.exists) throw httpError(404, "Room booking tidak ditemukan.");
  const booking = initial.data();
  requireStation(actor, booking.station);
  if (booking.roomId === targetRoomId) throw httpError(400, "Target room harus berbeda.");
  const oldRoomRef = db.collection("rooms").doc(booking.roomId);
  const targetRoomRef = db.collection("rooms").doc(targetRoomId);
  const startAt = new Date(booking.startAt);
  const endAt = new Date(booking.endAt);
  const targetSlots = buildSlots(
    targetRoomId,
    startAt,
    endAt,
    Number(booking.bufferBeforeMinutes) || 0,
    Number(booking.bufferAfterMinutes) || 0,
  );

  return db.runTransaction(async (transaction) => {
    const targetSlotRefs = targetSlots.map((slot) => db.collection("roomBookingSlots").doc(slot.id));
    const [latestSnapshot, oldRoomSnapshot, targetRoomSnapshot, ...targetSlotSnapshots] = await Promise.all([
      transaction.get(bookingRef),
      transaction.get(oldRoomRef),
      transaction.get(targetRoomRef),
      ...targetSlotRefs.map((ref) => transaction.get(ref)),
    ]);
    if (!latestSnapshot.exists || !targetRoomSnapshot.exists || !oldRoomSnapshot.exists)
      throw httpError(404, "Booking atau room tidak ditemukan.");
    const latest = latestSnapshot.data();
    const targetRoom = targetRoomSnapshot.data();
    if (latest.status !== "Approved")
      throw httpError(409, "Room movement hanya tersedia sebelum check-in pada booking Approved.");
    if (targetRoom.station !== latest.station || targetRoom.status !== "Active")
      throw httpError(409, "Target room tidak aktif atau berada di station berbeda.");
    if (targetRoom.operationalState === "Maintenance" || targetRoom.operationalState === "Occupied")
      throw httpError(409, `Target room sedang ${targetRoom.operationalState}.`);
    if (Number(targetRoom.capacity || 0) < Number(latest.attendees || 0))
      throw httpError(409, "Kapasitas target room tidak mencukupi.");
    if (targetSlotSnapshots.some((snapshot) => snapshot.exists))
      throw httpError(409, "Target room berbenturan dengan booking lain.", "ROOM_BOOKING_CONFLICT");

    (latest.slotIds || []).forEach((id) => transaction.delete(db.collection("roomBookingSlots").doc(id)));
    targetSlots.forEach((slot) => transaction.create(db.collection("roomBookingSlots").doc(slot.id), {
      bookingId,
      roomId: targetRoomId,
      station: latest.station,
      startsAt: slot.startsAt,
      createdAt: new Date(),
    }));
    transaction.update(bookingRef, {
      roomId: targetRoomId,
      roomName: targetRoom.name,
      slotIds: targetSlots.map((slot) => slot.id),
      previousRoomId: latest.roomId,
      roomMovementReason: reason,
      movedAt: new Date(),
      movedBy: actor.decoded.uid,
      updatedAt: new Date(),
    });
    activity(transaction, db, actor, {
      action: "ROOM_MOVED",
      bookingId,
      station: latest.station,
      roomId: targetRoomId,
      previousRoomId: latest.roomId,
      reason,
    });
    return { id: bookingId, status: "Approved", roomId: targetRoomId };
  });
}

async function maintenance(db, actor, action, input) {
  requireSupervisor(actor);
  if (action === "startmaintenance") {
    const roomId = text(input.roomId, 160);
    const reason = text(input.reason, 1000);
    const category = text(input.category, 120);
    const requestId = text(input.requestId, 120);
    if (!roomId || !reason || !category || !/^[a-zA-Z0-9-]{12,120}$/.test(requestId))
      throw httpError(400, "Room, category, reason, dan request ID wajib valid.");
    const maintenanceId = createHash("sha256")
      .update(`${actor.decoded.uid}|${requestId}`)
      .digest("hex");
    const roomRef = db.collection("rooms").doc(roomId);
    const maintenanceRef = db.collection("roomMaintenance").doc(maintenanceId);
    return db.runTransaction(async (transaction) => {
      const [roomSnapshot, maintenanceSnapshot] = await Promise.all([
        transaction.get(roomRef),
        transaction.get(maintenanceRef),
      ]);
      if (maintenanceSnapshot.exists) return { id: maintenanceId, status: maintenanceSnapshot.data().status, replayed: true };
      if (!roomSnapshot.exists) throw httpError(404, "Room tidak ditemukan.");
      const room = roomSnapshot.data();
      requireStation(actor, room.station);
      if (["Occupied", "Maintenance"].includes(room.operationalState))
        throw httpError(409, `Room yang sedang ${room.operationalState} tidak dapat masuk maintenance baru.`);
      transaction.create(maintenanceRef, {
        id: maintenanceId,
        station: room.station,
        roomId,
        roomName: room.name,
        category,
        reason,
        status: "Open",
        startedAt: new Date(),
        startedBy: actor.decoded.uid,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      transaction.update(roomRef, { operationalState: "Maintenance", activeMaintenanceId: maintenanceId, updatedAt: new Date() });
      activity(transaction, db, actor, { action: "ROOM_MAINTENANCE_STARTED", station: room.station, roomId, maintenanceId, reason });
      return { id: maintenanceId, status: "Open", replayed: false };
    });
  }

  const maintenanceId = text(input.maintenanceId, 160);
  const resolution = text(input.resolution, 1000);
  if (!maintenanceId || !resolution) throw httpError(400, "Maintenance ID dan resolution wajib diisi.");
  const maintenanceRef = db.collection("roomMaintenance").doc(maintenanceId);
  const initial = await maintenanceRef.get();
  if (!initial.exists) throw httpError(404, "Maintenance record tidak ditemukan.");
  const current = initial.data();
  requireStation(actor, current.station);
  const roomRef = db.collection("rooms").doc(current.roomId);
  return db.runTransaction(async (transaction) => {
    const [maintenanceSnapshot, roomSnapshot] = await Promise.all([
      transaction.get(maintenanceRef),
      transaction.get(roomRef),
    ]);
    if (!maintenanceSnapshot.exists || !roomSnapshot.exists)
      throw httpError(404, "Maintenance atau room tidak ditemukan.");
    if (maintenanceSnapshot.data().status !== "Open")
      return { id: maintenanceId, status: maintenanceSnapshot.data().status, replayed: true };
    transaction.update(maintenanceRef, {
      status: "Completed",
      resolution,
      completedAt: new Date(),
      completedBy: actor.decoded.uid,
      updatedAt: new Date(),
    });
    transaction.update(roomRef, { operationalState: "Available", activeMaintenanceId: "", updatedAt: new Date() });
    activity(transaction, db, actor, { action: "ROOM_MAINTENANCE_COMPLETED", station: current.station, roomId: current.roomId, maintenanceId, resolution });
    return { id: maintenanceId, status: "Completed", replayed: false };
  });
}

async function reportIncident(db, actor, input) {
  const roomId = text(input.roomId, 160);
  const category = text(input.category, 120);
  const severity = text(input.severity, 40);
  const description = text(input.description, 1500);
  const requestId = text(input.requestId, 120);
  if (!roomId || !category || !["Low", "Medium", "High", "Critical"].includes(severity) || !description || !/^[a-zA-Z0-9-]{12,120}$/.test(requestId))
    throw httpError(400, "Data incident belum lengkap atau tidak valid.");
  const roomSnapshot = await db.collection("rooms").doc(roomId).get();
  if (!roomSnapshot.exists) throw httpError(404, "Room tidak ditemukan.");
  const room = roomSnapshot.data();
  requireStation(actor, room.station);
  const incidentId = createHash("sha256")
    .update(`${actor.decoded.uid}|${requestId}`)
    .digest("hex");
  const incidentRef = db.collection("roomIncidents").doc(incidentId);
  const activityRef = db.collection("roomActivityLogs").doc();
  const batch = db.batch();
  batch.create(incidentRef, {
    id: incidentId,
    station: room.station,
    roomId,
    roomName: room.name,
    bookingId: text(input.bookingId, 160),
    category,
    severity,
    description,
    status: "Open",
    reportedAt: new Date(),
    reportedBy: actor.decoded.uid,
    reportedByName: text(actor.profile.name, 120),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  batch.create(activityRef, {
    action: "ROOM_INCIDENT_REPORTED",
    station: room.station,
    roomId,
    bookingId: text(input.bookingId, 160),
    incidentId,
    severity,
    actorId: actor.decoded.uid,
    actorName: text(actor.profile.name, 120),
    createdAt: new Date(),
  });
  try {
    await batch.commit();
  } catch (error) {
    if (error?.code !== 6 && error?.code !== "already-exists") throw error;
  }
  return { id: incidentId, status: "Open" };
}

const handler = async (request) => {
  try {
    if (request.method !== "POST") return json(405, { error: "Method not allowed." });
    const actor = await requireUser(request);
    requireOperator(actor);
    const input = await request.json();
    const action = text(input.action, 40).toLowerCase();
    const db = targetDb();
    if (["checkin", "checkout", "completecleaning", "noshow"].includes(action))
      return json(200, await bookingOperation(db, actor, action, input));
    if (action === "moveroom") return json(200, await moveRoom(db, actor, input));
    if (["startmaintenance", "endmaintenance"].includes(action))
      return json(200, await maintenance(db, actor, action, input));
    if (action === "reportincident") return json(201, await reportIncident(db, actor, input));
    throw httpError(400, "Room operation action tidak valid.");
  } catch (error) {
    return failure(error);
  }
};

export default handler;
