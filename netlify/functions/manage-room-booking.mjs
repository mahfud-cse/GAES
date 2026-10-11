import { createHash, randomUUID } from "node:crypto";
import { failure, httpError, json, requireUser, targetDb } from "./_firebase-admin.mjs";

const USER_ROLES = new Set([
  "Super Admin",
  "Admin",
  "HO Admin",
  "BO Admin",
  "Lounge Officer",
  "Lounge Manager",
]);
const GLOBAL_ROLES = new Set(["Super Admin", "Admin", "HO Admin"]);
const APPROVER_ROLES = new Set([
  "Super Admin",
  "Admin",
  "BO Admin",
  "Lounge Manager",
]);
const DETAIL_ROLES = new Set([
  "Super Admin",
  "Admin",
  "BO Admin",
  "Lounge Manager",
]);
const TERMINAL_STATUSES = new Set(["Rejected", "Cancelled", "Completed", "No Show"]);
const SLOT_MS = 15 * 60 * 1000;

const text = (value, max = 160) => String(value || "").trim().slice(0, max);
const integer = (value, minimum, maximum, fallback = minimum) => {
  const number = Number.parseInt(String(value), 10);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};
const slotId = (roomId, timestamp) =>
  createHash("sha256").update(`${roomId}|${timestamp}`).digest("hex");

function requireFacilityUser(actor) {
  if (!USER_ROLES.has(actor.profile.role))
    throw httpError(403, "Role tidak memiliki akses Room Booking.");
}

function requireStation(actor, station) {
  if (!GLOBAL_ROLES.has(actor.profile.role) && actor.profile.station !== station)
    throw httpError(403, "Station booking berada di luar scope akun.");
}

function sanitizedBooking(id, booking, actor) {
  const canSeeDetail =
    DETAIL_ROLES.has(actor.profile.role) ||
    booking.createdBy === actor.decoded.uid;
  if (canSeeDetail) return { id, ...booking, privacy: "Detail" };
  return {
    id,
    station: booking.station,
    roomId: booking.roomId,
    roomName: booking.roomName,
    title: "Room in use",
    purpose: "Operational room usage",
    organizer: "Restricted",
    contact: "",
    attendees: Number(booking.attendees) || 0,
    startAt: booking.startAt,
    endAt: booking.endAt,
    localDate: booking.localDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    stationTimeZone: booking.stationTimeZone,
    bufferBeforeMinutes: Number(booking.bufferBeforeMinutes) || 0,
    bufferAfterMinutes: Number(booking.bufferAfterMinutes) || 0,
    notes: "",
    visitorReference: "",
    status: booking.status,
    recurrenceGroupId: booking.recurrenceGroupId || "",
    createdBy: "",
    createdByName: "Restricted",
    checkedInAt: booking.checkedInAt || null,
    checkedOutAt: booking.checkedOutAt || null,
    privacy: "Masked",
  };
}

async function listBookings(db, actor, input) {
  const requestedStation = text(input.station, 12).toUpperCase();
  let query = db.collection("roomBookings");
  if (!GLOBAL_ROLES.has(actor.profile.role))
    query = query.where("station", "==", actor.profile.station);
  else if (requestedStation && requestedStation !== "ALL")
    query = query.where("station", "==", requestedStation);
  const snapshot = await query.limit(1000).get();
  return {
    bookings: snapshot.docs.map((row) =>
      sanitizedBooking(row.id, row.data(), actor),
    ),
  };
}

export function parseRange(input) {
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()))
    throw httpError(400, "Tanggal dan waktu booking tidak valid.");
  const duration = endAt.getTime() - startAt.getTime();
  if (duration < 15 * 60 * 1000 || duration > 8 * 60 * 60 * 1000)
    throw httpError(400, "Durasi booking minimal 15 menit dan maksimal 8 jam.");
  return { startAt, endAt };
}

export function buildSlots(roomId, startAt, endAt, beforeMinutes, afterMinutes) {
  const first = Math.floor((startAt.getTime() - beforeMinutes * 60_000) / SLOT_MS) * SLOT_MS;
  const limit = Math.ceil((endAt.getTime() + afterMinutes * 60_000) / SLOT_MS) * SLOT_MS;
  const slots = [];
  for (let cursor = first; cursor < limit; cursor += SLOT_MS) {
    slots.push({ id: slotId(roomId, cursor), startsAt: new Date(cursor).toISOString() });
  }
  return slots;
}

export function addRecurrence(date, type, index) {
  const next = new Date(date);
  if (type === "Daily") next.setUTCDate(next.getUTCDate() + index);
  if (type === "Weekly") next.setUTCDate(next.getUTCDate() + index * 7);
  if (type === "Monthly") next.setUTCMonth(next.getUTCMonth() + index);
  return next;
}

export function localDateInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function localTimeInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.hour}:${value.minute}`;
}

function validateLocalRange(input, range, stationTimeZone) {
  if (
    localDateInZone(range.startAt, stationTimeZone) !== input.localDate ||
    localDateInZone(range.endAt, stationTimeZone) !== input.localDate ||
    localTimeInZone(range.startAt, stationTimeZone) !== input.startTime ||
    localTimeInZone(range.endAt, stationTimeZone) !== input.endTime
  ) {
    throw httpError(400, "Waktu booking tidak sesuai timezone station.");
  }
}

function bookingPayload(input, actor, room, startAt, endAt, status, recurrenceGroupId = "") {
  return {
    station: room.station,
    roomId: room.id,
    roomName: room.name,
    title: text(input.title, 120),
    purpose: text(input.purpose, 240),
    organizer: text(input.organizer || actor.profile.name, 120),
    contact: text(input.contact, 120),
    attendees: integer(input.attendees, 1, Math.max(1, Number(room.capacity) || 500), 1),
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    localDate: text(input.localDate, 10),
    startTime: text(input.startTime, 5),
    endTime: text(input.endTime, 5),
    stationTimeZone: text(input.stationTimeZone, 80),
    bufferBeforeMinutes: integer(input.bufferBeforeMinutes, 0, 240, 0),
    bufferAfterMinutes: integer(input.bufferAfterMinutes, 0, 240, 0),
    notes: text(input.notes, 1000),
    visitorReference: text(input.visitorReference, 120),
    status,
    recurrenceGroupId,
    createdBy: actor.decoded.uid,
    createdByName: text(actor.profile.name || actor.decoded.email, 120),
  };
}

async function notifyApprovers(db, booking, bookingId, actorId) {
  const users = await db.collection("users").where("active", "==", true).get();
  const batch = db.batch();
  let notificationCount = 0;
  users.docs.forEach((user) => {
    const profile = user.data();
    if (
      user.id !== actorId &&
      ["BO Admin", "Lounge Manager"].includes(profile.role) &&
      profile.station === booking.station
    ) {
      const notification = db.collection("notifications").doc();
      batch.set(notification, {
        id: notification.id,
        userId: user.id,
        type: "ROOM_BOOKING_APPROVAL",
        title: "Room Booking Approval",
        text: `${booking.roomName} · ${booking.title}`,
        targetId: bookingId,
        active: true,
        createdAt: new Date(),
      });
      notificationCount += 1;
    }
  });
  if (notificationCount) {
    const activity = db.collection("roomActivityLogs").doc();
    batch.set(activity, {
      id: activity.id,
      action: "ROOM_BOOKING_NOTIFICATIONS_CREATED",
      station: booking.station,
      bookingId,
      actorId,
      recipientCount: notificationCount,
      createdAt: new Date(),
    });
    await batch.commit();
  }
}

async function notifyRequester(db, booking, bookingId, status) {
  if (!booking.createdBy) return;
  const notification = db.collection("notifications").doc();
  await notification.set({
    id: notification.id,
    userId: booking.createdBy,
    type: "ROOM_BOOKING_STATUS",
    title: `Room Booking ${status}`,
    text: `${booking.roomName} · ${booking.title}`,
    targetId: bookingId,
    active: true,
    createdAt: new Date(),
  });
}

async function createBookings(db, actor, input) {
  const requestId = text(input.requestId, 120);
  if (!/^[a-zA-Z0-9-]{12,120}$/.test(requestId))
    throw httpError(400, "Booking request ID tidak valid.");
  const requestHash = createHash("sha256")
    .update(`${actor.decoded.uid}|${requestId}`)
    .digest("hex");
  const requestRef = db.collection("roomBookingRequests").doc(requestHash);
  const roomId = text(input.roomId, 160);
  const roomSnapshot = await db.collection("rooms").doc(roomId).get();
  if (!roomSnapshot.exists || roomSnapshot.data()?.status !== "Active")
    throw httpError(404, "Room aktif tidak ditemukan.");
  const room = { id: roomSnapshot.id, ...roomSnapshot.data() };
  requireStation(actor, room.station);
  if (!text(input.title, 120)) throw httpError(400, "Judul booking wajib diisi.");
  const stationSnapshot = await db.collection("stations").doc(room.station).get();
  const stationTimeZone = text(stationSnapshot.data()?.timeZone, 80);
  if (!stationTimeZone) throw httpError(409, "Timezone station belum dikonfigurasi.");

  const requestedStatus = input.submit === true ? "Requested" : "Draft";
  const recurrenceType = ["Daily", "Weekly", "Monthly"].includes(input.recurrenceType)
    ? input.recurrenceType
    : "None";
  const recurrenceCount = recurrenceType === "None"
    ? 1
    : integer(input.recurrenceCount, 1, 12, 1);
  const recurrenceGroupId = recurrenceCount > 1 ? randomUUID() : "";
  const base = parseRange(input);
  validateLocalRange(input, base, stationTimeZone);
  const before = integer(input.bufferBeforeMinutes, 0, 240, 0);
  const after = integer(input.bufferAfterMinutes, 0, 240, 0);
  const occurrences = Array.from({ length: recurrenceCount }, (_, index) => {
    const startAt = addRecurrence(base.startAt, recurrenceType, index);
    const endAt = addRecurrence(base.endAt, recurrenceType, index);
    const ref = db.collection("roomBookings").doc(`${requestHash}-${index + 1}`);
    const booking = bookingPayload(
      {
        ...input,
        stationTimeZone,
        localDate: localDateInZone(startAt, stationTimeZone),
      },
      actor,
      room,
      startAt,
      endAt,
      requestedStatus,
      recurrenceGroupId,
    );
    const slots = requestedStatus === "Requested"
      ? buildSlots(room.id, startAt, endAt, before, after)
      : [];
    return { ref, booking, slots };
  });

  const writeCount = occurrences.reduce((total, occurrence) => total + occurrence.slots.length + 1, 2);
  if (writeCount > 440)
    throw httpError(400, "Kombinasi durasi, buffer, dan recurrence terlalu besar. Kurangi jumlah pengulangan.");

  const transactionResult = await db.runTransaction(async (transaction) => {
    const slotRefs = occurrences.flatMap((occurrence) =>
      occurrence.slots.map((slot) => db.collection("roomBookingSlots").doc(slot.id)),
    );
    const [requestSnapshot, ...slotSnapshots] = await Promise.all([
      transaction.get(requestRef),
      ...slotRefs.map((ref) => transaction.get(ref)),
    ]);
    if (requestSnapshot.exists) return { ...requestSnapshot.data(), replayed: true };
    const conflict = slotSnapshots.find((snapshot) => snapshot.exists);
    if (conflict) {
      const data = conflict.data();
      throw httpError(
        409,
        `Room berbenturan dengan booking lain${data?.startsAt ? ` pada ${data.startsAt}` : ""}.`,
        "ROOM_BOOKING_CONFLICT",
      );
    }

    occurrences.forEach((occurrence) => {
      transaction.create(occurrence.ref, {
        ...occurrence.booking,
        id: occurrence.ref.id,
        slotIds: occurrence.slots.map((slot) => slot.id),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      occurrence.slots.forEach((slot) =>
        transaction.create(db.collection("roomBookingSlots").doc(slot.id), {
          bookingId: occurrence.ref.id,
          roomId: room.id,
          station: room.station,
          startsAt: slot.startsAt,
          createdAt: new Date(),
        }),
      );
    });
    transaction.create(db.collection("auditLogs").doc(), {
      action: "CREATE_ROOM_BOOKING",
      targetIds: occurrences.map((occurrence) => occurrence.ref.id),
      actorId: actor.decoded.uid,
      status: requestedStatus,
      createdAt: new Date(),
    });
    transaction.create(requestRef, {
      actorId: actor.decoded.uid,
      ids: occurrences.map((occurrence) => occurrence.ref.id),
      status: requestedStatus,
      createdAt: new Date(),
    });
    return {
      ids: occurrences.map((occurrence) => occurrence.ref.id),
      status: requestedStatus,
      replayed: false,
    };
  });

  if (requestedStatus === "Requested" && !transactionResult.replayed) {
    await notifyApprovers(db, occurrences[0].booking, occurrences[0].ref.id, actor.decoded.uid).catch(() => undefined);
  }
  return { ids: transactionResult.ids, status: transactionResult.status };
}

async function updateDraft(db, actor, input, current, reference) {
  if (!["Draft", "Requested", "Approved"].includes(current.status))
    throw httpError(409, `Booking berstatus ${current.status} tidak dapat diubah.`);
  const isManager = DETAIL_ROLES.has(actor.profile.role);
  if (current.status === "Draft") {
    if (current.createdBy !== actor.decoded.uid && !isManager)
      throw httpError(403, "Draft hanya dapat diubah oleh pembuat, Lounge Manager, BO Admin, atau Admin.");
  } else if (!isManager) {
    throw httpError(403, "Booking submitted hanya dapat diubah Lounge Manager, BO Admin, atau Admin.");
  }
  const roomSnapshot = await db.collection("rooms").doc(text(input.roomId || current.roomId)).get();
  if (!roomSnapshot.exists) throw httpError(404, "Room tidak ditemukan.");
  const room = { id: roomSnapshot.id, ...roomSnapshot.data() };
  requireStation(actor, room.station);
  const range = parseRange(input);
  const stationSnapshot = await db.collection("stations").doc(room.station).get();
  const stationTimeZone = text(stationSnapshot.data()?.timeZone, 80);
  if (!stationTimeZone) throw httpError(409, "Timezone station belum dikonfigurasi.");
  validateLocalRange(input, range, stationTimeZone);
  const booking = {
    ...bookingPayload(
      { ...input, stationTimeZone },
      actor,
      room,
      range.startAt,
      range.endAt,
      current.status,
      current.recurrenceGroupId || "",
    ),
    createdBy: current.createdBy,
    createdByName: current.createdByName,
  };
  if (current.status === "Draft") {
    await reference.set(
      { ...booking, updatedAt: new Date(), updatedBy: actor.decoded.uid },
      { merge: true },
    );
  } else {
    const slots = buildSlots(
      room.id,
      range.startAt,
      range.endAt,
      integer(input.bufferBeforeMinutes, 0, 240, 0),
      integer(input.bufferAfterMinutes, 0, 240, 0),
    );
    await db.runTransaction(async (transaction) => {
      const slotRefs = slots.map((slot) =>
        db.collection("roomBookingSlots").doc(slot.id),
      );
      const [latest, ...slotSnapshots] = await Promise.all([
        transaction.get(reference),
        ...slotRefs.map((ref) => transaction.get(ref)),
      ]);
      if (!latest.exists || latest.data()?.status !== current.status)
        throw httpError(409, "Status booking berubah. Muat ulang sebelum mengedit.");
      if (
        slotSnapshots.some(
          (snapshot) =>
            snapshot.exists && snapshot.data()?.bookingId !== reference.id,
        )
      )
        throw httpError(409, "Perubahan berbenturan dengan booking lain.", "ROOM_BOOKING_CONFLICT");
      const nextSlotIds = new Set(slots.map((slot) => slot.id));
      (latest.data()?.slotIds || [])
        .filter((id) => !nextSlotIds.has(id))
        .forEach((id) =>
          transaction.delete(db.collection("roomBookingSlots").doc(id)),
        );
      slots.forEach((slot, index) => {
        if (!slotSnapshots[index].exists)
          transaction.create(slotRefs[index], {
            bookingId: reference.id,
            roomId: room.id,
            station: room.station,
            startsAt: slot.startsAt,
            createdAt: new Date(),
          });
      });
      transaction.set(
        reference,
        {
          ...booking,
          slotIds: slots.map((slot) => slot.id),
          updatedAt: new Date(),
          updatedBy: actor.decoded.uid,
        },
        { merge: true },
      );
    });
  }
  await db.collection("auditLogs").add({
    action: current.status === "Draft" ? "UPDATE_ROOM_BOOKING_DRAFT" : "UPDATE_SUBMITTED_ROOM_BOOKING",
    targetId: reference.id,
    actorId: actor.decoded.uid,
    fromStatus: current.status,
    createdAt: new Date(),
  });
  return { id: reference.id, status: current.status };
}

async function changeStatus(db, actor, action, current, reference) {
  requireStation(actor, current.station);
  const isOwner = current.createdBy === actor.decoded.uid;
  const isApprover = APPROVER_ROLES.has(actor.profile.role);
  const transitions = {
    submit: ["Draft", "Requested"],
    approve: ["Requested", "Approved"],
    reject: ["Requested", "Rejected"],
    cancel: [current.status, "Cancelled"],
  };
  if (!transitions[action]) throw httpError(400, "Action booking tidak valid.");
  const [from, to] = transitions[action];
  if (current.status !== from || TERMINAL_STATUSES.has(current.status))
    throw httpError(409, `Booking berstatus ${current.status} tidak dapat diproses dengan action ${action}.`);
  if (["approve", "reject"].includes(action) && !isApprover)
    throw httpError(403, "Role tidak memiliki kewenangan approval.");
  if (
    action === "cancel" &&
    !isApprover &&
    !(isOwner && actor.profile.role !== "Lounge Officer")
  )
    throw httpError(403, "Booking yang sudah disubmit hanya dapat dibatalkan Lounge Manager, BO Admin, atau Admin.");
  if (["reject", "cancel"].includes(action) && !text(current.closeReason, 500))
    throw httpError(400, "Alasan penolakan atau pembatalan wajib diisi.");

  let slots = [];
  if (action === "submit") {
    const range = parseRange(current);
    slots = buildSlots(
      current.roomId,
      range.startAt,
      range.endAt,
      integer(current.bufferBeforeMinutes, 0, 240, 0),
      integer(current.bufferAfterMinutes, 0, 240, 0),
    );
  }
  await db.runTransaction(async (transaction) => {
    const slotRefs = action === "submit"
      ? slots.map((slot) => db.collection("roomBookingSlots").doc(slot.id))
      : [];
    const [latestSnapshot, ...slotSnapshots] = await Promise.all([
      transaction.get(reference),
      ...slotRefs.map((ref) => transaction.get(ref)),
    ]);
    if (!latestSnapshot.exists || latestSnapshot.data()?.status !== from)
      throw httpError(409, "Status booking sudah berubah. Muat ulang data sebelum melanjutkan.");
    const latest = latestSnapshot.data();
    if (action === "submit") {
      if (slotSnapshots.some((snapshot) => snapshot.exists))
        throw httpError(409, "Room berbenturan dengan booking lain.", "ROOM_BOOKING_CONFLICT");
      slots.forEach((slot) =>
        transaction.create(db.collection("roomBookingSlots").doc(slot.id), {
          bookingId: reference.id,
          roomId: current.roomId,
          station: current.station,
          startsAt: slot.startsAt,
          createdAt: new Date(),
        }),
      );
    }
    if (["reject", "cancel"].includes(action)) {
      (latest.slotIds || []).forEach((id) =>
        transaction.delete(db.collection("roomBookingSlots").doc(id)),
      );
    }
    transaction.update(reference, {
      status: to,
      ...(action === "submit" ? { slotIds: slots.map((slot) => slot.id) } : {}),
      ...(action === "approve" ? { approvedBy: actor.decoded.uid, approvedByName: actor.profile.name || "", approvedAt: new Date() } : {}),
      ...(["reject", "cancel"].includes(action) ? { closedBy: actor.decoded.uid, closedAt: new Date(), closeReason: text(current.closeReason, 500) } : {}),
      updatedAt: new Date(),
      updatedBy: actor.decoded.uid,
    });
    transaction.create(db.collection("auditLogs").doc(), {
      action: `${action.toUpperCase()}_ROOM_BOOKING`,
      targetId: reference.id,
      actorId: actor.decoded.uid,
      from,
      to,
      createdAt: new Date(),
    });
  });

  if (action === "submit")
    await notifyApprovers(db, current, reference.id, actor.decoded.uid).catch(() => undefined);
  if (["approve", "reject", "cancel"].includes(action))
    await notifyRequester(db, current, reference.id, to).catch(() => undefined);
  return { id: reference.id, status: to };
}

const handler = async (request) => {
  try {
    if (request.method !== "POST") return json(405, { error: "Method not allowed." });
    const actor = await requireUser(request);
    requireFacilityUser(actor);
    const input = await request.json();
    const action = text(input.action || "create", 20).toLowerCase();
    const db = targetDb();
    if (action === "list") return json(200, await listBookings(db, actor, input));
    if (action === "create") return json(201, await createBookings(db, actor, input.booking || {}));

    const id = text(input.id, 160);
    if (!id) throw httpError(400, "Booking ID wajib tersedia.");
    const reference = db.collection("roomBookings").doc(id);
    const snapshot = await reference.get();
    if (!snapshot.exists) throw httpError(404, "Room booking tidak ditemukan.");
    const current = { id: snapshot.id, ...snapshot.data(), closeReason: input.reason || "" };
    requireStation(actor, current.station);
    if (action === "update")
      return json(200, await updateDraft(db, actor, input.booking || {}, current, reference));
    return json(200, await changeStatus(db, actor, action, current, reference));
  } catch (error) {
    return failure(error);
  }
};

export default handler;
