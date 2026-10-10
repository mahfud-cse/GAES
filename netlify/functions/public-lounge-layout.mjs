import { failure, json, targetDb } from "./_firebase-admin.mjs";

const text = (value, max = 500) => String(value || "").trim().slice(0, max);

const handler = async (request) => {
  try {
    if (request.method !== "GET") return json(405, { error: "Method not allowed." });
    const url = new URL(request.url);
    const id = text(url.searchParams.get("id"), 160);
    if (!id) return json(400, { error: "Layout ID is required." });
    const snapshot = await targetDb().collection("loungeLayouts").doc(id).get();
    if (!snapshot.exists || snapshot.data()?.status !== "Published")
      return json(404, { error: "Published lounge layout was not found." });
    const source = snapshot.data();
    return json(200, {
      id: snapshot.id,
      station: text(source.station, 12),
      loungeName: text(source.loungeName, 180),
      title: text(source.title, 180),
      floorName: text(source.floorName, 120),
      layoutUrl: text(source.layoutUrl, 2000),
      areas: (Array.isArray(source.areas) ? source.areas : [])
        .filter((area) => area?.publicVisible === true)
        .map((area) => ({
          id: text(area.id, 160),
          name: text(area.name, 160),
          category: text(area.category, 100),
          description: text(area.description, 1000),
          services: (Array.isArray(area.services) ? area.services : [])
            .map((service) => text(service, 100))
            .filter(Boolean),
          x: Math.max(0, Math.min(100, Number(area.x) || 0)),
          y: Math.max(0, Math.min(100, Number(area.y) || 0)),
          status: ["Available", "In Use", "Temporarily Closed"].includes(area.status)
            ? area.status
            : "Available",
          photoUrls: (Array.isArray(area.photoUrls) ? area.photoUrls : [])
            .map((photo) => text(photo, 2000))
            .filter(Boolean)
            .slice(0, 12),
        })),
    });
  } catch (error) {
    return failure(error);
  }
};

export default handler;
