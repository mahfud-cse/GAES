import type { User } from "firebase/auth";

async function call<T>(path: string, user: User | null, body: unknown): Promise<T> {
  const token = user ? await user.getIdToken() : "";
  const response = await fetch(`/.netlify/functions/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Permintaan tidak dapat diproses.");
  return payload as T;
}

export const resolveUsername = (username: string) =>
  call<{ email: string }>("resolve-username", null, { username });

export const createManagedUser = (user: User, payload: unknown) =>
  call<{ uid: string; email: string; username: string }>("create-user", user, payload);

export const updateManagedUser = (user: User, payload: unknown) =>
  call<{ uid: string }>("manage-user", user, payload);

export const importManagedUsers = (user: User, users: unknown[]) =>
  call<{ created: number; errors: Array<{ row: number; error: string }> }>("import-users", user, { users });

export const syncSourceLounges = (user: User) =>
  call<{ imported: number }>("sync-source-lounges", user, {});

export const createVisitor = (user: User, visitor: unknown) =>
  call<{ id: string; lateScan: boolean }>("create-visitor", user, { visitor });
