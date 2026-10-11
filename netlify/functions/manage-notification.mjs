import {
  failure,
  httpError,
  json,
  requireUser,
  targetDb,
} from "./_firebase-admin.mjs";

const text = (value, max = 500) => String(value || "").trim().slice(0, max);

const handler = async (request) => {
  try {
    if (request.method !== "POST")
      return json(405, { error: "Method not allowed." });
    const actor = await requireUser(request);
    const input = await request.json();
    if (text(input.action, 30).toLowerCase() !== "read")
      throw httpError(400, "Notification action tidak valid.");
    const id = text(input.id, 160);
    if (!id) throw httpError(400, "Notification ID wajib tersedia.");
    const db = targetDb();
    const reference = db.collection("notifications").doc(id);
    const snapshot = await reference.get();
    if (!snapshot.exists) throw httpError(404, "Notification tidak ditemukan.");
    const notification = snapshot.data();
    if (notification.userId !== actor.decoded.uid)
      throw httpError(403, "Notification bukan milik akun ini.");
    if (notification.active === false)
      return json(200, { id, status: "Read", replayed: true });
    const batch = db.batch();
    batch.update(reference, {
      active: false,
      readAt: new Date(),
      updatedAt: new Date(),
    });
    const audit = db.collection("auditLogs").doc();
    batch.set(audit, {
      id: audit.id,
      action: "NOTIFICATION_OPENED",
      notificationId: id,
      notificationType: text(notification.type, 80),
      targetId: text(notification.targetId || notification.targetUid, 160),
      actorId: actor.decoded.uid,
      actorName: text(actor.profile.name || actor.decoded.email, 120),
      createdAt: new Date(),
    });
    await batch.commit();
    return json(200, { id, status: "Read", replayed: false });
  } catch (error) {
    return failure(error);
  }
};

export default handler;
