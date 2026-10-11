import {
  failure,
  httpError,
  json,
  requireUser,
  targetDb,
} from "./_firebase-admin.mjs";
import { writeAudit } from "./_audit.mjs";
import { createHash } from "node:crypto";

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
const EDITABLE_TEXT_FIELDS = new Map([
  ["date", 20], ["time", 12], ["travelDate", 20], ["scanTimestamp", 40],
  ["dateSource", 20], ["lounge", 180], ["loungeId", 160], ["name", 160],
  ["flight", 24], ["route", 20], ["finalDestination", 3], ["cabin", 4],
  ["seat", 12], ["seq", 30], ["ticket", 40], ["eligible", 1],
  ["category", 100], ["reference", 180], ["currency", 3], ["agreementId", 160],
  ["pricePeriodId", 160], ["priceSource", 20], ["pricingDate", 20], ["source", 80],
  ["companionCategory", 100], ["companionMembership", 120], ["verifier", 160],
  ["verifierOrganization", 180], ["rawScan", 4000], ["normalizedScan", 4000],
  ["evidenceName", 240], ["evidenceUrl", 1500], ["evidenceType", 40],
  ["evidenceStoragePath", 500], ["evidenceUploadedAt", 40], ["membership", 120], ["notes", 800],
  ["firstName", 80], ["lastName", 80], ["confirmationNumber", 120],
  ["sourceIssuingConfirmation", 160], ["accessGrantedBy", 160],
  ["ffpAirlineCode", 3], ["guestName", 240], ["paymentId", 160],
]);

function editableVisitorPayload(source) {
  const result = {};
  EDITABLE_TEXT_FIELDS.forEach((max, field) => {
    if (Object.hasOwn(source, field)) result[field] = text(source[field], max);
  });
  if (Object.hasOwn(source, "price")) result.price = Math.max(0, Number(source.price) || 0);
  if (Object.hasOwn(source, "companionCount"))
    result.companionCount = Math.max(0, Math.min(20, Number(source.companionCount) || 0));
  return result;
}

const duplicateHash = (row) =>
  createHash("sha256")
    .update(
      [row.name, row.flight, row.seq, row.travelDate || row.date]
        .map((value) => text(value, 180).toUpperCase().replace(/\s+/g, " "))
        .join("|"),
    )
    .digest("hex");

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
      const visitor = editableVisitorPayload(input.visitor || {});
      if (!text(visitor.name, 160))
        throw httpError(400, "Nama visitor wajib tersedia.");
      if (visitor.loungeId && visitor.loungeId !== current.loungeId) {
        const lounge = await db.collection("lounges").doc(visitor.loungeId).get();
        if (!lounge.exists || lounge.data()?.airport !== current.airport)
          throw httpError(409, "Lounge/Tenant tidak tersedia pada station visitor.");
      }
      const missingFields = [
        !text(visitor.travelDate || visitor.date, 20) && "Date of Travel",
        !text(visitor.flight, 24) && "Flight Number",
        !text(visitor.seq, 30) && "Check-in Sequence",
        !text(visitor.lounge, 180) && "Lounge/Tenant",
        visitor.eligible !== "Y" && "Eligibility Indicator",
      ].filter(Boolean);
      const nextIdentity = { ...current, ...visitor };
      const identityComplete = Boolean(
        nextIdentity.name &&
          nextIdentity.flight &&
          nextIdentity.seq &&
          (nextIdentity.travelDate || nextIdentity.date),
      );
      const nextDuplicateKey = identityComplete ? duplicateHash(nextIdentity) : "";
      if (nextDuplicateKey && nextDuplicateKey !== current.duplicateKey) {
        const duplicateReference = db.collection("uniquePassengers").doc(nextDuplicateKey);
        if ((await duplicateReference.get()).exists)
          throw httpError(409, "Penumpang sudah terdaftar pada penerbangan dan tanggal tersebut.");
        batch.create(duplicateReference, {
          visitorId: id,
          identity: [
            nextIdentity.name,
            nextIdentity.flight,
            nextIdentity.seq,
            nextIdentity.travelDate || nextIdentity.date,
          ],
          createdAt: new Date(),
        });
        if (current.duplicateKey)
          batch.delete(db.collection("uniquePassengers").doc(current.duplicateKey));
      }
      const evidenceResubmitted = Boolean(
        (visitor.evidenceStoragePath &&
          visitor.evidenceStoragePath !== current.evidenceStoragePath) ||
          (visitor.evidenceUrl && visitor.evidenceUrl !== current.evidenceUrl),
      );
      batch.set(
        reference,
        {
          ...visitor,
          id,
          airport: current.airport,
          importStatus: current.importBatchId
            ? missingFields.length
              ? "Needs Data Completion"
              : "Ready for Verification"
            : visitor.importStatus || current.importStatus || "",
          missingFields,
          duplicateKey: nextDuplicateKey || current.duplicateKey || "",
          boStatus: evidenceResubmitted ? "Pending" : current.boStatus,
          boReason: current.boReason || "",
          vendorStatus: evidenceResubmitted ? "Pending" : current.vendorStatus,
          reconciliationStatus: evidenceResubmitted
            ? "Open"
            : current.reconciliationStatus,
          exceptionalStatus: current.exceptionalStatus || "Not Requested",
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
