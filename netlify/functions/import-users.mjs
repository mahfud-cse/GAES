import { failure, json, requireUser } from "./_firebase-admin.mjs";
import { handler as createUser } from "./create-user.mjs";

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
    await requireUser(event, ["Super Admin"]);
    const users = JSON.parse(event.body || "{}").users;
    if (!Array.isArray(users) || users.length > 200) return json(400, { error: "Maksimal 200 akun per upload." });
    let created = 0;
    const errors = [];
    for (let index = 0; index < users.length; index += 1) {
      const result = await createUser({ ...event, body: JSON.stringify(users[index]) });
      if (result.statusCode === 201) created += 1;
      else errors.push({ row: index + 2, error: JSON.parse(result.body).error });
    }
    return json(200, { created, errors });
  } catch (error) { return failure(error); }
}
