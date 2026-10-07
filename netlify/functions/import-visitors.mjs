import { createHash, randomUUID } from "node:crypto";
import { failure, httpError, json, requireUser, targetDb } from "./_firebase-admin.mjs";
import { writeAudit } from "./_audit.mjs";

const ALLOWED_ROLES = new Set(["Super Admin", "Admin", "Lounge Manager"]);
const GLOBAL_ROLES = new Set(["Super Admin", "Admin"]);
const text = (value, max = 500) => String(value || "").trim().slice(0, max);
const upper = (value, max = 500) => text(value, max).toUpperCase();
const isoDate = (value) => {
  const normalized = text(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
};
const duplicateHash = (row) =>
  createHash("sha256")
    .update([row.name, row.flight, row.seq, row.travelDate].map((value) => upper(value)).join("|"))
    .digest("hex");

const handler = async (request) => {
  try {
    if (request.method !== "POST") return json(405, { error: "Method not allowed." });
    const actor = await requireUser(request);
    if (!ALLOWED_ROLES.has(actor.profile.role))
      throw httpError(403, "Visitor bundle hanya dapat diunggah oleh Lounge Manager, Admin, atau Super Admin.");
    const input = await request.json();
    if (!Array.isArray(input.visitors) || !input.visitors.length)
      throw httpError(400, "File tidak memiliki data visitor.");
    if (input.visitors.length > 150)
      throw httpError(400, "Maksimal 150 visitor dalam satu upload. Pisahkan file menjadi beberapa batch.");

    const today = new Date().toISOString().slice(0, 10);
    const errors = [];
    const prepared = [];
    input.visitors.forEach((source, index) => {
      const rowNumber = index + 2;
      const name = text(source.name, 160);
      const airport = upper(source.airport || actor.profile.station, 3);
      if (!name) {
        errors.push({ row: rowNumber, error: "Passenger Name wajib diisi." });
        return;
      }
      if (!/^[A-Z]{3}$/.test(airport)) {
        errors.push({ row: rowNumber, error: "Airport wajib berupa kode IATA 3 huruf." });
        return;
      }
      if (!GLOBAL_ROLES.has(actor.profile.role) && airport !== actor.profile.station) {
        errors.push({ row: rowNumber, error: "Airport berada di luar scope station akun." });
        return;
      }
      const travelDate = isoDate(source.travelDate);
      const flight = upper(source.flight, 24).replace(/\s/g, "");
      const seq = text(source.seq, 30);
      const lounge = text(source.lounge, 180);
      const eligible = upper(source.eligible, 1) === "Y" ? "Y" : "";
      const missingFields = [
        !travelDate && "Date of Travel",
        !flight && "Flight Number",
        !seq && "Check-in Sequence",
        !lounge && "Lounge/Tenant",
        eligible !== "Y" && "Eligibility Indicator",
      ].filter(Boolean);
      prepared.push({
        id: randomUUID(),
        rowNumber,
        date: isoDate(source.date) || today,
        time: text(source.time, 8) || "00:00",
        travelDate,
        airport,
        lounge,
        loungeId: text(source.loungeId, 160),
        name,
        flight,
        route: upper(source.route, 20),
        cabin: upper(source.cabin, 4),
        seat: upper(source.seat, 12),
        seq,
        ticket: text(source.ticket, 40),
        category: text(source.category, 100) || "Lainnya",
        reference: text(source.reference, 180),
        membership: text(source.membership, 120),
        eligible,
        notes: text(source.notes, 800),
        currency: "IDR",
        price: 0,
        source: "Visitor Bundle Upload",
        importStatus: missingFields.length ? "Needs Data Completion" : "Ready for Verification",
        missingFields,
        boStatus: "Pending",
        boReason: "",
        vendorStatus: "Pending",
        reconciliationStatus: "Open",
      });
    });

    if (!prepared.length)
      return json(400, { error: "Tidak ada baris visitor yang dapat diproses.", errors });

    const completeIdentity = prepared.filter(
      (row) => row.name && row.flight && row.seq && row.travelDate,
    );
    const db = targetDb();
    const uniqueReferences = completeIdentity.map((row) =>
      db.collection("uniquePassengers").doc(duplicateHash(row)),
    );
    const existing = uniqueReferences.length ? await db.getAll(...uniqueReferences) : [];
    const duplicateKeys = new Set(
      existing.filter((snapshot) => snapshot.exists).map((snapshot) => snapshot.id),
    );
    const accepted = prepared.filter((row) => {
      if (!(row.name && row.flight && row.seq && row.travelDate)) return true;
      const key = duplicateHash(row);
      if (!duplicateKeys.has(key)) return true;
      errors.push({ row: row.rowNumber, error: "Visitor terindikasi duplikat dan tidak diimpor." });
      return false;
    });
    if (!accepted.length)
      return json(409, { error: "Seluruh baris terindikasi duplikat atau tidak valid.", errors });

    const batchId = randomUUID();
    const batch = db.batch();
    accepted.forEach((row) => {
      const visitor = Object.fromEntries(
        Object.entries(row).filter(([key]) => key !== "rowNumber"),
      );
      const visitorRef = db.collection("visitors").doc(visitor.id);
      const duplicateKey = visitor.name && visitor.flight && visitor.seq && visitor.travelDate
        ? duplicateHash(visitor)
        : "";
      batch.create(visitorRef, {
        ...visitor,
        importBatchId: batchId,
        duplicateKey,
        createdBy: actor.decoded.uid,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      if (duplicateKey) {
        const uniqueRef = db.collection("uniquePassengers").doc(duplicateKey);
        batch.create(uniqueRef, {
          visitorId: visitor.id,
          identity: [visitor.name, visitor.flight, visitor.seq, visitor.travelDate],
          createdAt: new Date(),
        });
      }
      writeAudit(batch, db, actor, {
        action: "IMPORT_VISITOR",
        module: "Visitor & Reconciliation",
        station: visitor.airport,
        loungeId: visitor.loungeId,
        loungeName: visitor.lounge,
        targetType: "Visitor",
        targetId: visitor.id,
        targetName: `${visitor.name}${visitor.flight ? ` · ${visitor.flight}` : ""}`,
        result: visitor.importStatus,
        detail: visitor.missingFields.length
          ? `Imported from bundle; missing: ${visitor.missingFields.join(", ")}`
          : "Imported from visitor bundle and ready for verification.",
      });
    });
    writeAudit(batch, db, actor, {
      action: "IMPORT_VISITOR_BUNDLE",
      module: "Visitor & Reconciliation",
      station: actor.profile.station,
      targetType: "Import Batch",
      targetId: batchId,
      targetName: `${accepted.length} visitor`,
      detail: `${accepted.length} imported; ${accepted.filter((row) => row.importStatus === "Needs Data Completion").length} need data completion; ${errors.length} skipped.`,
    });
    await batch.commit();
    return json(201, {
      batchId,
      imported: accepted.length,
      needsCompletion: accepted.filter((row) => row.importStatus === "Needs Data Completion").length,
      duplicates: errors.filter((item) => item.error.includes("duplikat")).length,
      errors,
    });
  } catch (error) {
    return failure(error);
  }
};

export default handler;
