import { createHash } from "node:crypto";
import { failure, httpError, json, requireUser, targetDb } from "./_firebase-admin.mjs";
import { writeAudit } from "./_audit.mjs";

const normalize = (value) => String(value || "").trim().toUpperCase().replace(/\s+/g, " ");

export default async (request) => {
  try {
    if (request.method !== "POST") return json(405, { error: "Method not allowed." });
    const actor = await requireUser(request);
    const visitor = (await request.json()).visitor || {};
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
