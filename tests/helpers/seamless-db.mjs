import assert from "node:assert/strict";
const admin = {
  profile: {
    name: "HO Administrator",
    active: true,
    role: "Admin",
    station: "ALL",
  },
};
const officer = {
  profile: {
    name: "Ayu Pratiwi",
    organization: "Lounge Operations",
    active: true,
    role: "Lounge Officer",
    station: "CGK",
    loungeId: "lounge-1",
  },
};
const lounge = {
  airport: "CGK",
  name: "Garuda Executive Lounge",
  status: "Aktif",
};
class MemoryDB {
  rows = new Map();
  queue = Promise.resolve();
  constructor() {
    this.rows.set("users/admin-1", structuredClone(admin.profile));
    this.rows.set("users/officer-1", structuredClone(officer.profile));
    this.rows.set("lounges/lounge-1", lounge);
  }
  collection(path) {
    return this.query(path);
  }
  query(path, filters = [], order = "", after = null, max = Infinity) {
    return {
      doc: (key = crypto.randomUUID()) => ({
        path: `${path}/${key}`,
        id: key,
        get: async () => this.snap(`${path}/${key}`),
        collection: (name) => this.query(`${path}/${key}/${name}`),
      }),
      where: (key, _, value) =>
        this.query(path, [...filters, [key, value]], order, after, max),
      orderBy: (key) => this.query(path, filters, key, after, max),
      startAfter: (value) => this.query(path, filters, order, value, max),
      limit: (n) => this.query(path, filters, order, after, n),
      get: async () => {
        let docs = [...this.rows.keys()]
          .filter(
            (k) =>
              k.startsWith(`${path}/`) &&
              k.slice(path.length + 1).split("/").length === 1,
          )
          .map((k) => this.snap(k))
          .filter((s) => filters.every(([k, v]) => s.data()[k] === v));
        docs.sort((a, b) =>
          order === "createdAt"
            ? String(b.data().createdAt).localeCompare(
                String(a.data().createdAt),
              ) || b.id.localeCompare(a.id)
            : a.id.localeCompare(b.id),
        );
        if (after) {
          const key = typeof after === "string" ? after : after.id;
          docs = docs.slice(docs.findIndex((d) => d.id === key) + 1);
        }
        return { docs: docs.slice(0, max) };
      },
    };
  }
  snap(path) {
    return {
      id: path.split("/").at(-1),
      exists: this.rows.has(path),
      data: () => structuredClone(this.rows.get(path)),
    };
  }
  runTransaction(fn) {
    const task = this.queue.then(async () => {
      const staged = [];
      const tx = {
        get: async (ref) => this.snap(ref.path),
        create: (ref, data) => {
          assert.equal(this.rows.has(ref.path), false);
          staged.push([ref.path, data]);
        },
        set: (ref, data) => staged.push([ref.path, data]),
        update: (ref, data) =>
          staged.push([ref.path, { ...this.rows.get(ref.path), ...data }]),
      };
      const r = await fn(tx);
      for (const [path, data] of staged)
        this.rows.set(path, structuredClone(data));
      return r;
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
export { MemoryDB };
