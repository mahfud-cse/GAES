import { failure, json, requireUser, sourceDb, targetDb } from "./_firebase-admin.mjs";

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
    const actor = await requireUser(event, ["Super Admin", "Admin"]);
    const source = await sourceDb().collection("portalData").doc("lounges").collection("records").get();
    const db = targetDb();
    const writer = db.bulkWriter();
    let imported = 0;
    source.docs.forEach((item) => {
      const row = item.data();
      const id = String(row.id || item.id);
      writer.set(db.collection("lounges").doc(id), {
        id, airport: row.airport || "", name: row.name || "", type: row.serviceType || row.serviceCategory || "Lounge",
        currency: row.currency || "IDR", price: Number(row.pricePerPax || 0), start: row.startDate || "", end: row.endDate || "",
        status: row.documentStatus === "Valid" ? "Aktif" : "Nonaktif", region: row.region || "", pic: row.pic || "",
        sourceProject: "ground-experience-portal", sourcePath: `portalData/lounges/records/${item.id}`,
        sourceUpdatedAt: new Date(), syncedBy: actor.decoded.uid,
      }, { merge: true });
      imported += 1;
    });
    await writer.close();
    await db.collection("integrationRuns").add({ integration: "source-lounges", imported, status: "SUCCESS", createdAt: new Date(), actorId: actor.decoded.uid });
    return json(200, { imported });
  } catch (error) { return failure(error); }
}
