import { createHash } from "node:crypto";
import { failure, httpError, json, requireUser, targetDb } from "./_firebase-admin.mjs";
import { writeAudit } from "./_audit.mjs";

const normalize = (value) => String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
const text = (value, max = 500) => String(value || "").trim().slice(0, max);
const CREATE_ROLES = new Set([
  "Super Admin",
  "Admin",
  "BO Admin",
  "Lounge Officer",
  "Lounge Manager",
]);
const GLOBAL_ROLES = new Set(["Super Admin", "Admin"]);

function visitorPayload(source) {
  return {
    date: text(source.date, 20),
    time: text(source.time, 12),
    travelDate: text(source.travelDate, 20),
    scanTimestamp: text(source.scanTimestamp, 40),
    dateSource: text(source.dateSource, 20),
    airport: normalize(source.airport).slice(0, 3),
    lounge: text(source.lounge, 180),
    loungeId: text(source.loungeId, 160),
    name: text(source.name, 160),
    flight: normalize(source.flight).replace(/\s/g, "").slice(0, 24),
    route: normalize(source.route).slice(0, 20),
    finalDestination: normalize(source.finalDestination).slice(0, 3),
    cabin: normalize(source.cabin).slice(0, 4),
    seat: normalize(source.seat).slice(0, 12),
    seq: text(source.seq, 30),
    ticket: text(source.ticket, 40),
    eligible: source.eligible === "Y" ? "Y" : "N",
    category: text(source.category, 100),
    reference: text(source.reference, 180),
    currency: normalize(source.currency).slice(0, 3) || "IDR",
    price: Math.max(0, Number(source.price) || 0),
    agreementId: text(source.agreementId, 160),
    pricePeriodId: text(source.pricePeriodId, 160),
    priceSource: source.priceSource === "SYNC" ? "SYNC" : "MANUAL",
    pricingDate: text(source.pricingDate, 20),
    source: text(source.source, 80),
    boReason: text(source.boReason, 500),
    companionCount: Math.max(0, Math.min(20, Number(source.companionCount) || 0)),
    companionCategory: text(source.companionCategory, 100),
    companionMembership: text(source.companionMembership, 120),
    verifier: text(source.verifier, 160),
    verifierOrganization: text(source.verifierOrganization, 180),
    rawScan: text(source.rawScan, 4000),
    normalizedScan: text(source.normalizedScan, 4000),
    reportRevision: 1,
    boStatus: "Pending",
    vendorStatus: "Pending",
    reconciliationStatus: "Open",
    exceptionalStatus: "Not Requested",
  };
}

export default async (request) => {
  try {
    if (request.method !== "POST") return json(405, { error: "Method not allowed." });
    const actor = await requireUser(request);
    if (!CREATE_ROLES.has(actor.profile.role))
      throw httpError(403, "Role tidak memiliki kewenangan menambahkan visitor.");
    const visitor = visitorPayload((await request.json()).visitor || {});
    if (!/^[A-Z]{3}$/.test(visitor.airport))
      throw httpError(400, "Airport visitor wajib berupa kode IATA 3 huruf.");
    if (
      !GLOBAL_ROLES.has(actor.profile.role) &&
      actor.profile.station !== visitor.airport
    )
      throw httpError(403, "Data visitor berada di luar scope station akun.");
    if (
      ["Lounge Officer", "Lounge Manager"].includes(actor.profile.role) &&
      actor.profile.loungeId &&
      actor.profile.loungeId !== visitor.loungeId
    )
      throw httpError(403, "Lounge visitor berada di luar penugasan akun.");
    const identity = [visitor.name, visitor.flight, visitor.seq, visitor.travelDate].map(normalize);
    if (identity.some((value) => !value)) {
      return json(400, { error: "Nama, flight, sequence, dan Date of Travel wajib diisi." });
    }
    if (visitor.eligible !== "Y") {
      return json(422, {
        code: "INELIGIBLE",
        error:
          "Berdasarkan hasil validasi dan ketentuan layanan yang berlaku, akses lounge belum dapat diberikan. Silakan periksa kembali data perjalanan atau lakukan verifikasi manual sesuai kewenangan petugas.",
      });
    }

    const duplicateKey = createHash("sha256").update(identity.join("|")).digest("hex");
    const db = targetDb();
    if (!visitor.loungeId)
      throw httpError(400, "Lounge/Tenant wajib dipilih dari master data.");
    const loungeSnapshot = await db.collection("lounges").doc(visitor.loungeId).get();
    if (!loungeSnapshot.exists || loungeSnapshot.data()?.airport !== visitor.airport)
      throw httpError(409, "Lounge/Tenant tidak tersedia pada station yang dipilih.");
    const duplicateRef = db.collection("uniquePassengers").doc(duplicateKey);
    const visitorRef = db.collection("visitors").doc();
    const users = await db.collection("users").where("active", "==", true).get();
    const category = String(visitor.category || "");
    const targetRoles = ["Business Class", "VIP/CIP/VVIP"].includes(category)
      ? new Set(["BO Admin", "Lounge Manager"])
      : ["Partner Airline / SkyTeam", "Kerjasama MPA"].includes(category)
        ? new Set(["Airline Verifier"])
        : new Set(["HO Ancillary Verifier"]);
    const recipients = users.docs.filter((user) => {
      const profile = user.data();
      if (user.id === actor.decoded.uid || !targetRoles.has(profile.role)) return false;
      return profile.station === "ALL" || profile.station === visitor.airport;
    });
    await db.runTransaction(async (transaction) => {
      if ((await transaction.get(duplicateRef)).exists) {
        throw httpError(409, "Penumpang sudah ditambahkan sebagai pengguna layanan lounge.", "DUPLICATE");
      }
      transaction.create(duplicateRef, { visitorId: visitorRef.id, identity, createdAt: new Date() });
      transaction.create(visitorRef, {
        ...visitor,
        id: visitorRef.id,
        duplicateKey,
        createdBy: actor.decoded.uid,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      recipients.forEach((recipient) => {
        const notification = db.collection("notifications").doc();
        transaction.create(notification, {
          id: notification.id,
          userId: recipient.id,
          type: "VISITOR_VERIFICATION",
          title: "Visitor Verification",
          text: `${visitor.name} · ${visitor.flight} · ${visitor.category}`,
          targetId: visitorRef.id,
          active: true,
          createdAt: new Date(),
        });
      });
      writeAudit(transaction, db, actor, {
        action: "CREATE_VISITOR",
        module: "Lounge/Tenant Access",
        station: visitor.airport,
        loungeId: visitor.loungeId,
        loungeName: visitor.lounge,
        targetType: "Visitor",
        targetId: visitorRef.id,
        targetName: `${visitor.name} · ${visitor.flight}`,
        result: "Pending Verification",
        detail: `${visitor.source || "Access entry"} · ${visitor.category || "Unspecified category"}`,
      });
    });
    return json(201, { id: visitorRef.id, lateScan: visitor.boReason === "Melewati STD/ETD" });
  } catch (error) {
    return failure(error);
  }
};
