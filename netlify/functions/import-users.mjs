import { failure, json, requireUser } from "./_firebase-admin.mjs";
import { createUserRecord } from "./create-user.mjs";

export default async (request) => {
  try {
    if (request.method !== "POST") return json(405, { error: "Method not allowed." });
    const actor = await requireUser(request, ["Super Admin", "Admin"]);
    const users = (await request.json()).users;
    if (!Array.isArray(users) || users.length > 200) {
      return json(400, { error: "Maksimal 200 akun per upload." });
    }

    let created = 0;
    const errors = [];
    for (let index = 0; index < users.length; index += 1) {
      try {
        await createUserRecord(users[index], actor);
        created += 1;
      } catch (error) {
        errors.push({ row: index + 2, error: error.message || "Gagal membuat akun." });
      }
    }
    return json(200, { created, errors });
  } catch (error) {
    return failure(error);
  }
};

