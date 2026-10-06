import {
  failure,
  httpError,
  json,
  requireUser,
  targetDb,
} from "./_firebase-admin.mjs";

const MANAGER_ROLES = new Set([
  "Super Admin",
  "Admin",
  "BO Admin",
  "Lounge Manager",
]);
const GLOBAL_ROLES = new Set(["Super Admin", "Admin"]);
const text = (value, max = 1000) => String(value || "").trim().slice(0, max);

const handler = async (request) => {
  try {
    if (request.method !== "POST")
      return json(405, { error: "Method not allowed." });
    const actor = await requireUser(request);
    if (!MANAGER_ROLES.has(actor.profile.role))
      throw httpError(403, "Data submitted hanya dapat dikelola Lounge Manager, BO Admin, atau Admin.");
    const input = await request.json();
    const action = text(input.action, 20).toLowerCase();
    const id = text(input.id || input.visitor?.id, 160);
    if (!id) throw httpError(400, "Visitor ID wajib tersedia.");
    const db = targetDb();
    const reference = db.collection("visitors").doc(id);
    const snapshot = await reference.get();
    if (!snapshot.exists) throw httpError(404, "Data visitor tidak ditemukan.");
    const current = snapshot.data();
    if (
      !GLOBAL_ROLES.has(actor.profile.role) &&
      actor.profile.station !== current.airport
    )
      throw httpError(403, "Data visitor berada di luar scope station akun.");
    const batch = db.batch();
    const audit = db.collection("auditLogs").doc();
    if (action === "update") {
      const visitor = input.visitor || {};
      if (!text(visitor.name, 160) || !text(visitor.flight, 24))
        throw httpError(400, "Nama dan flight wajib tersedia.");
      batch.set(
        reference,
        {
          ...visitor,
          id,
          duplicateKey: current.duplicateKey || "",
          createdBy: current.createdBy || "",
          createdAt: current.createdAt || new Date(),
          updatedAt: new Date(),
          updatedBy: actor.decoded.uid,
        },
        { merge: true },
      );
      batch.set(audit, {
        id: audit.id,
        action: "UPDATE_VISITOR",
        targetId: id,
        station: current.airport,
        actorId: actor.decoded.uid,
        actorName: text(actor.profile.name || actor.decoded.email, 120),
        beforeStatus: current.boStatus || "",
        afterStatus: visitor.boStatus || current.boStatus || "",
        createdAt: new Date(),
      });
      if (
        current.createdBy &&
        current.createdBy !== actor.decoded.uid &&
        visitor.boStatus &&
        visitor.boStatus !== current.boStatus
      ) {
        const notification = db.collection("notifications").doc();
        batch.set(notification, {
          id: notification.id,
          userId: current.createdBy,
          type:
            visitor.boStatus === "Rejected"
              ? "VISITOR_DISPUTE"
              : "VISITOR_STATUS",
          title: `Visitor ${visitor.boStatus}`,
          text: `${visitor.name || current.name} · ${visitor.flight || current.flight}`,
          targetId: id,
          active: true,
          createdAt: new Date(),
        });
      }
      await batch.commit();
      return json(200, { id, status: "Updated" });
    }
    if (action === "delete") {
      batch.delete(reference);
      if (current.duplicateKey)
        batch.delete(db.collection("uniquePassengers").doc(current.duplicateKey));
      batch.set(audit, {
        id: audit.id,
        action: "DELETE_VISITOR",
        targetId: id,
        station: current.airport,
        actorId: actor.decoded.uid,
        actorName: text(actor.profile.name || actor.decoded.email, 120),
        visitorName: text(current.name, 160),
        flight: text(current.flight, 24),
        createdAt: new Date(),
      });
      await batch.commit();
      return json(200, { id, status: "Deleted" });
    }
    throw httpError(400, "Visitor action tidak valid.");
  } catch (error) {
    return failure(error);
  }
};

export default handler;
