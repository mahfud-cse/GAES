import {
  failure,
  httpError,
  json,
  requireUser,
  targetDb,
} from "./_firebase-admin.mjs";
import { writeAudit } from "./_audit.mjs";

const MANAGER_ROLES = new Set([
  "Super Admin",
  "Admin",
  "BO Admin",
  "Lounge Manager",
]);
const GLOBAL_ROLES = new Set(["Super Admin", "Admin"]);
const DECISION_ROLES = new Set([
  "Super Admin",
  "Admin",
  "BO Admin",
  "HO Ancillary Verifier",
  "Airline Verifier",
]);
const DISPUTE_ROLES = new Set(["Super Admin", "Admin", "Lounge Officer", "Lounge Manager"]);
const text = (value, max = 1000) => String(value || "").trim().slice(0, max);

const handler = async (request) => {
  try {
    if (request.method !== "POST")
      return json(405, { error: "Method not allowed." });
    const actor = await requireUser(request);
    const input = await request.json();
    const action = text(input.action, 20).toLowerCase();
    if (action === "decision") {
      if (!DECISION_ROLES.has(actor.profile.role))
        throw httpError(403, "Role tidak memiliki kewenangan keputusan verifikasi visitor.");
    } else if (action === "acceptrejection") {
      if (!DISPUTE_ROLES.has(actor.profile.role))
        throw httpError(403, "Role tidak memiliki kewenangan menerima hasil penolakan.");
    } else if (!MANAGER_ROLES.has(actor.profile.role)) {
      throw httpError(403, "Data submitted hanya dapat dikelola Lounge Manager, BO Admin, atau Admin.");
    }
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
    if (action === "acceptrejection") {
      if (current.boStatus !== "Rejected")
        throw httpError(409, "Visitor tidak berada pada status Rejected.");
      batch.update(reference, {
        vendorStatus: "Confirmed",
        reconciliationStatus: "Final",
        rejectionAcceptedAt: new Date(),
        rejectionAcceptedBy: actor.decoded.uid,
        updatedAt: new Date(),
      });
      writeAudit(batch, db, actor, {
        action: "ACCEPT_VISITOR_REJECTION",
        module: "Dispute & Correction",
        station: current.airport,
        loungeId: current.loungeId,
        loungeName: current.lounge,
        targetType: "Visitor",
        targetId: id,
        targetName: `${current.name} · ${current.flight || "Flight pending"}`,
        result: "Final",
        reasonCode: current.disputeCode || "",
        detail: current.boReason || "Rejection accepted by lounge.",
      });
      await batch.commit();
      return json(200, { id, status: "Final" });
    }
    if (action === "decision") {
      if (current.importStatus === "Needs Data Completion")
        throw httpError(409, "Data visitor harus dilengkapi sebelum keputusan verifikasi.");
      const decision = text(input.decision, 20).toLowerCase();
      if (!["accept", "reject"].includes(decision))
        throw httpError(400, "Keputusan verifikasi tidak valid.");
      const boStatus = decision === "accept" ? "Accepted" : "Rejected";
      const reason = decision === "reject" ? text(input.reason, 300) : "";
      if (decision === "reject" && !reason)
        throw httpError(400, "Alasan penolakan wajib diisi.");
      const businessCategories = new Set(["Business Class", "VIP/CIP/VVIP"]);
      const ancillaryCategories = new Set([
        "Platinum", "Elite Plus", "Gold Privilege", "Elite", "GPS", "EMD", "Paid Access",
      ]);
      if (actor.profile.role === "BO Admin" && !businessCategories.has(current.category))
        throw httpError(403, "Kategori visitor berada di luar kewenangan Branch Office.");
      if (actor.profile.role === "HO Ancillary Verifier" && !ancillaryCategories.has(current.category))
        throw httpError(403, "Kategori visitor berada di luar kewenangan HO Ancillary.");
      if (actor.profile.role === "Airline Verifier" && (businessCategories.has(current.category) || ancillaryCategories.has(current.category)))
        throw httpError(403, "Kategori visitor berada di luar kewenangan Airline Verifier.");
      batch.update(reference, {
        boStatus,
        boReason: reason,
        disputeCode: decision === "reject" ? reason.split(" — ")[0] : "",
        vendorStatus: "Pending",
        reconciliationStatus: decision === "accept" ? "Final" : "Open",
        verifiedAt: new Date(),
        verifiedBy: actor.decoded.uid,
        updatedAt: new Date(),
        updatedBy: actor.decoded.uid,
      });
      writeAudit(batch, db, actor, {
        action: decision === "accept" ? "ACCEPT_VISITOR" : "REJECT_VISITOR",
        module: "Visitor Verification",
        station: current.airport,
        loungeId: current.loungeId,
        loungeName: current.lounge,
        targetType: "Visitor",
        targetId: id,
        targetName: `${current.name} · ${current.flight || "Flight pending"}`,
        result: boStatus,
        reasonCode: decision === "reject" ? reason.split(" — ")[0] : "",
        detail: reason,
      });
      if (current.createdBy && current.createdBy !== actor.decoded.uid) {
        const notification = db.collection("notifications").doc();
        batch.set(notification, {
          id: notification.id,
          userId: current.createdBy,
          type: decision === "reject" ? "VISITOR_DISPUTE" : "VISITOR_STATUS",
          title: `Visitor ${boStatus}`,
          text: `${current.name} · ${current.flight || "Flight pending"}`,
          targetId: id,
          active: true,
          createdAt: new Date(),
        });
      }
      await batch.commit();
      return json(200, { id, status: boStatus });
    }
    if (action === "update") {
      const visitor = input.visitor || {};
      if (!text(visitor.name, 160))
        throw httpError(400, "Nama visitor wajib tersedia.");
      const missingFields = [
        !text(visitor.travelDate || visitor.date, 20) && "Date of Travel",
        !text(visitor.flight, 24) && "Flight Number",
        !text(visitor.seq, 30) && "Check-in Sequence",
        !text(visitor.lounge, 180) && "Lounge/Tenant",
        visitor.eligible !== "Y" && "Eligibility Indicator",
      ].filter(Boolean);
      batch.set(
        reference,
        {
          ...visitor,
          id,
          importStatus: current.importBatchId
            ? missingFields.length
              ? "Needs Data Completion"
              : "Ready for Verification"
            : visitor.importStatus || current.importStatus || "",
          missingFields,
          duplicateKey: current.duplicateKey || "",
          createdBy: current.createdBy || "",
          createdAt: current.createdAt || new Date(),
          updatedAt: new Date(),
          updatedBy: actor.decoded.uid,
        },
        { merge: true },
      );
      writeAudit(batch, db, actor, {
        action: "UPDATE_VISITOR",
        module: "Visitor & Reconciliation",
        targetId: id,
        station: current.airport,
        loungeId: current.loungeId,
        loungeName: current.lounge,
        targetType: "Visitor",
        targetName: `${visitor.name || current.name} · ${visitor.flight || current.flight || "Flight pending"}`,
        detail: missingFields.length
          ? `Data updated; still missing: ${missingFields.join(", ")}`
          : "Visitor data updated.",
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
      writeAudit(batch, db, actor, {
        action: "DELETE_VISITOR",
        module: "Visitor & Reconciliation",
        targetId: id,
        station: current.airport,
        loungeId: current.loungeId,
        loungeName: current.lounge,
        targetType: "Visitor",
        targetName: `${text(current.name, 160)} · ${text(current.flight, 24) || "Flight pending"}`,
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
