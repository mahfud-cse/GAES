"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { User } from "firebase/auth";
import { seamlessAccessRequest } from "../lib/firebase/api";
import fixtures from "../public/demo-media/manifest.json";

type Lounge = { id: string; name: string; airport: string; status: string };
type Staff = {
  uid: string;
  name: string;
  role: string;
  station: string;
  active: boolean;
  enrollment: {
    enrollmentStatus: string;
    active: boolean;
    loungeIds: string[];
    enrolledAt?: string;
    enrolledBy?: string;
    updatedAt?: string;
  } | null;
};
type Result = {
  id: string;
  mode: string;
  category: string;
  maskedIdentifier: string;
  identity: string;
  authorization: string;
  decision: string;
  reason: string;
  createdAt: string;
  location: string;
  states: string[];
  gate: {
    state: string;
    commandIssued: boolean;
    physicalOpenConfirmed: boolean;
    simulated: boolean;
    resetState?: string;
  };
};
const reasons: Record<string, string> = {
  FACE_NOT_RECOGNIZED: "Wajah tidak dikenali.",
  ENTITLEMENT_INVALID: "Entitlement passenger tidak berlaku.",
  PASSENGER_RECORD_UNAVAILABLE: "Data passenger tidak tersedia.",
  PASSENGER_SERVICE_UNAVAILABLE: "Layanan passenger tidak tersedia.",
  VERIFICATION_SERVICE_UNAVAILABLE: "Layanan verifikasi tidak tersedia.",
  INVALID_PROVIDER_RESPONSE:
    "Respons verifikasi tidak lengkap; perlu pemeriksaan manual.",
  STAFF_INACTIVE: "Staff atau akses staff nonaktif.",
  STAFF_AUTHORIZATION_INVALID:
    "Otorisasi role/station/lounge staff tidak sesuai.",
  ENROLLMENT_INCOMPLETE: "Enrollment staff belum lengkap.",
  LIVE_NOT_CONFIGURED:
    "Live belum tersedia: provider biometrik, passenger dan gate belum dikonfigurasi.",
};
export default function SeamlessAccess({
  user,
  role,
  lounges,
  initialLoungeId,
}: {
  user: User;
  role: string;
  lounges: Lounge[];
  initialLoungeId: string;
}) {
  const canManage = ["Super Admin", "Admin"].includes(role);
  const allowed = [
    "Super Admin",
    "Admin",
    "BO Admin",
    "Lounge Officer",
    "Lounge Manager",
  ].includes(role);
  const [loungeId, setLoungeId] = useState(
    lounges.some((l) => l.id === initialLoungeId) ? initialLoungeId : "",
  );
  const [mode, setMode] = useState("DEMO");
  const [scenario, setScenario] = useState(fixtures[0].id);
  const [gateBehavior, setGateBehavior] = useState("confirmed");
  const [result, setResult] = useState<Result | null>(null);
  const [activity, setActivity] = useState<Result[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [staffCursor, setStaffCursor] = useState<string | null>(null);
  const [staffId, setStaffId] = useState("");
  const [managedSubject, setManagedSubject] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [operation, setOperation] = useState("enroll");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const [query, setQuery] = useState("");
  const [decisionFilter, setDecisionFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const pending = useRef<{ key: string; requestId: string } | null>(null);
  const inflight = useRef(false);
  const currentLocation = useRef(loungeId);
  useEffect(() => {
    currentLocation.current = loungeId;
  }, [loungeId]);
  const api = useCallback(
    (payload: Record<string, unknown>) => seamlessAccessRequest(user, payload),
    [user],
  );
  const loadActivity = useCallback(
    async (next?: string) => {
      if (!loungeId || !allowed) return;
      const data = await api({ action: "activity", loungeId, cursor: next });
      if (currentLocation.current !== loungeId) return;
      const rows = data.activity as Result[];
      setActivity((previous) => (next ? [...previous, ...rows] : rows));
      setCursor(data.nextCursor as string | null);
    },
    [api, loungeId, allowed],
  );
  const loadStaff = useCallback(
    async (next?: string) => {
      if (!canManage) return;
      const data = await api({ action: "staff-list", cursor: next });
      setStaff((previous) =>
        next
          ? [...previous, ...(data.staff as Staff[])]
          : (data.staff as Staff[]),
      );
      setStaffCursor(data.nextCursor as string | null);
    },
    [api, canManage],
  );
  useEffect(() => {
    setActivity([]);
    setCursor(null);
    setResult(null);
    setNotice("");
    pending.current = null;
    setRetryPending(false);
    void loadActivity().catch(() =>
      setNotice(
        "Aktivitas belum dapat dimuat dari server. Periksa sesi dan deployment Functions.",
      ),
    );
  }, [loadActivity]);
  useEffect(() => {
    void loadStaff().catch(() => setNotice("Daftar staff belum dapat dimuat."));
  }, [loadStaff]);
  async function verify() {
    if (inflight.current || !loungeId || mode !== "DEMO") return;
    inflight.current = true;
    setBusy(true);
    setNotice("");
    setResult(null);
    const payload = {
      action: "verify",
      loungeId,
      mode,
      scenarioId: scenario,
      gateBehavior,
      ...(managedSubject ? { subjectUid: managedSubject } : {}),
    };
    const key = JSON.stringify(payload);
    if (pending.current?.key !== key)
      pending.current = { key, requestId: crypto.randomUUID() };
    try {
      const data = await api({
        ...payload,
        requestId: pending.current.requestId,
      });
      if (data.status === "PENDING") {
        setRetryPending(true);
        setNotice(
          "Permintaan sebelumnya masih PENDING. Periksa aktivitas; tidak ada perintah gate tambahan.",
        );
        return;
      }
      setResult(data as unknown as Result);
      pending.current = null;
      setRetryPending(false);
      await loadActivity().catch(() =>
        setNotice(
          "Hasil verifikasi tersimpan; aktivitas belum dapat dimuat. Gunakan Refresh activity.",
        ),
      );
    } catch {
      setRetryPending(true);
      setNotice(
        "Verifikasi belum terkonfirmasi. Coba ulang permintaan yang sama untuk memeriksa hasil tanpa menggandakan perintah, atau gunakan Access Verification.",
      );
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  async function saveStaff(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await api({
        action: "staff-save",
        uid: staffId,
        operation,
        loungeIds: loungeId ? [loungeId] : [],
        privacyConfirmed: privacy,
        identityConfirmed,
      });
      setNotice(
        "Data enrollment DEMO tersimpan. Tidak ada enrollment biometrik live.",
      );
      setPrivacy(false);
      setIdentityConfirmed(false);
      await loadStaff();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Staff gagal disimpan.",
      );
    } finally {
      setBusy(false);
    }
  }
  const fixture = fixtures.find((x) => x.id === scenario)!;
  const selected = staff.find((x) => x.uid === staffId);
  const filtered = activity.filter(
    (x) =>
      (decisionFilter === "ALL" || x.decision === decisionFilter) &&
      (categoryFilter === "ALL" || x.category === categoryFilter) &&
      `${x.maskedIdentifier} ${x.location} ${x.reason} ${x.gate.state}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  if (!allowed)
    return (
      <div className="notice warn" role="status">
        Akun ini tidak memiliki izin Seamless Access. Gunakan menu sesuai
        kewenangan.
      </div>
    );
  return (
    <>
      <div className="title">
        <p>OPERASIONAL AKSES</p>
        <h1>Seamless Access</h1>
        <span>
          Face verification → entitlement / otorisasi → keputusan akses → gate
          acknowledgement.
        </span>
      </div>
      <div className="notice warn" role="status">
        <b>DEMO / SIMULATED</b> · Identitas fiktif, tanpa pencocokan wajah live
        dan tanpa kontrol gate fisik. Data aktivitas tersimpan di Firebase
        server terpisah dari visitor produksi.
      </div>
      {notice && (
        <div className="notice warn" role="status">
          {notice}
          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="Tutup notifikasi"
          >
            ×
          </button>
        </div>
      )}
      <div className="accessGrid">
        <article className="card">
          <h2>Live/Simulated Face Verification</h2>
          <div className="form">
            <label>
              Access location
              <select
                value={loungeId}
                disabled={busy}
                onChange={(e) => setLoungeId(e.target.value)}
              >
                <option value="">Pilih lounge aktif</option>
                {lounges
                  .filter((l) => l.status === "Aktif")
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.airport} · {l.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Verification mode
              <select
                value={mode}
                disabled={busy}
                onChange={(e) => {
                  setMode(e.target.value);
                  setResult(null);
                }}
              >
                <option>DEMO</option>
                <option>LIVE</option>
              </select>
            </label>
            <label>
              Skenario sintetis
              <select
                value={scenario}
                disabled={busy || mode === "LIVE" || !!managedSubject}
                onChange={(e) => {
                  setScenario(e.target.value);
                  setResult(null);
                }}
              >
                {fixtures.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.displayName}
                  </option>
                ))}
              </select>
            </label>
            {canManage && (
              <label>
                Staff DEMO tersimpan
                <select
                  disabled={busy || mode === "LIVE"}
                  value={managedSubject}
                  onChange={(e) => {
                    setManagedSubject(e.target.value);
                    setResult(null);
                  }}
                >
                  <option value="">Gunakan skenario sintetis</option>
                  {staff
                    .filter((s) => s.enrollment)
                    .map((s) => (
                      <option key={s.uid} value={s.uid}>
                        {s.name} · {s.enrollment?.enrollmentStatus}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              Gate simulator
              <select
                value={gateBehavior}
                disabled={busy || mode === "LIVE"}
                onChange={(e) => setGateBehavior(e.target.value)}
              >
                <option value="confirmed">Simulated open + closed</option>
                <option value="accepted">
                  Command accepted · no open acknowledgement
                </option>
                <option value="timeout">Command timeout</option>
                <option value="offline">Device unavailable</option>
                <option value="fault">Gate fault</option>
                <option value="wrong-device">
                  Wrong device acknowledgement
                </option>
              </select>
            </label>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={
              mode === "LIVE"
                ? "/demo-media/camera/illustration.svg"
                : fixture.image
            }
            alt="Ilustrasi DEMO sintetis; bukan kamera atau pencocokan biometrik live"
            width={640}
            height={400}
            style={{ width: "100%", height: "auto", borderRadius: 12 }}
          />
          <p>
            Capture status:{" "}
            {busy
              ? "CAPTURED / SIMULATED"
              : result
                ? "CAPTURED / SIMULATED"
                : "IDLE"}{" "}
            · Device: {mode === "DEMO" ? "SIMULATED" : "NOT CONNECTED"}
          </p>
          {mode === "LIVE" && (
            <p className="notice warn">{reasons.LIVE_NOT_CONFIGURED}</p>
          )}
          <button
            type="button"
            disabled={busy || !loungeId || mode === "LIVE"}
            onClick={() => void verify()}
          >
            {busy
              ? "Memverifikasi…"
              : retryPending
                ? "Periksa / ulangi permintaan"
                : "Simulasikan verifikasi"}
          </button>
        </article>
        <article className="card" aria-live="polite">
          <h2>Access Result</h2>
          {!result ? (
            <p>Belum ada hasil. Pilih lokasi dan skenario DEMO.</p>
          ) : (
            <>
              <div
                className={`notice ${result.decision === "ELIGIBLE" ? "ok" : "error"}`}
              >
                <b>{result.decision}</b> ·{" "}
                {reasons[result.reason] || "Access authorized (DEMO)."}
              </div>
              <dl>
                <dt>Identifier</dt>
                <dd>{result.maskedIdentifier}</dd>
                <dt>Person category</dt>
                <dd>{result.category}</dd>
                <dt>Identity</dt>
                <dd>{result.identity}</dd>
                <dt>Entitlement / authorization</dt>
                <dd>{result.authorization}</dd>
                <dt>Location</dt>
                <dd>{result.location}</dd>
                <dt>Timestamp</dt>
                <dd>{result.createdAt}</dd>
                <dt>Gate acknowledgement</dt>
                <dd>{result.gate.state} · SIMULATED</dd>
                <dt>Gate reset</dt>
                <dd>{result.gate.resetState || "—"}</dd>
                <dt>Physical open confirmed</dt>
                <dd>{result.gate.physicalOpenConfirmed ? "Yes" : "No"}</dd>
              </dl>
              {result.decision === "ELIGIBLE" &&
                result.gate.state !== "SIMULATED_OPEN_CONFIRMED" && (
                  <div className="notice warn">
                    Keputusan aplikasi eligible; gate belum mengonfirmasi
                    pembukaan.
                  </div>
                )}
              <ol>
                {result.states.map((state, i) => (
                  <li key={`${i}-${state}`}>{state}</li>
                ))}
              </ol>
            </>
          )}
          <h3>Conceptual access point</h3>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/demo-media/layout/access-point.svg"
            alt="Denah konseptual access point DEMO"
            width={900}
            height={420}
            style={{ width: "100%", height: "auto" }}
          />
        </article>
      </div>
      {canManage && (
        <article className="card">
          <h2>Staff Registration &amp; Enrollment · DEMO</h2>
          <p>
            Buat identitas staff melalui Master Data → User & Role yang
            sudah ada. Di sini administrator dapat mengaktifkan, memperbarui
            scope, melakukan enrollment ulang, atau menonaktifkan akses DEMO
            pada profil tersebut. Foto tidak dianggap enrollment live.
          </p>
          <form onSubmit={saveStaff}>
            <div className="form">
              <label>
                Staff ID / nama / role / home station
                <select
                  value={staffId}
                  required
                  onChange={(e) => {
                    setStaffId(e.target.value);
                    setPrivacy(false);
                    setIdentityConfirmed(false);
                  }}
                >
                  <option value="">Pilih existing staff</option>
                  {staff
                    .filter((s) =>
                      ["BO Admin", "Lounge Officer", "Lounge Manager"].includes(
                        s.role,
                      ),
                    )
                    .map((s) => (
                      <option key={s.uid} value={s.uid}>
                        {s.name} · {s.uid} · {s.role} · {s.station}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Operation
                <select
                  value={operation}
                  onChange={(e) => setOperation(e.target.value)}
                >
                  <option value="enroll">
                    Enroll / replace DEMO reference
                  </option>
                  <option value="update">Update authorized location</option>
                  <option value="deactivate">Deactivate DEMO access</option>
                </select>
              </label>
            </div>
            {selected && (
              <p>
                Account: {selected.active ? "Active" : "Inactive"} · Enrollment:{" "}
                {selected.enrollment?.enrollmentStatus || "Not enrolled"} ·
                Scope: {selected.enrollment?.loungeIds.join(", ") || "—"} ·
                Enrolled at: {selected.enrollment?.enrolledAt || "—"} ·
                Enrolling admin: {selected.enrollment?.enrolledBy || "—"} ·
                Updated: {selected.enrollment?.updatedAt || "—"}
              </p>
            )}
            <label>
              <input
                type="checkbox"
                checked={identityConfirmed}
                onChange={(e) => setIdentityConfirmed(e.target.checked)}
              />{" "}
              Identitas staff telah diverifikasi oleh administrator.
            </label>
            <label>
              <input
                type="checkbox"
                checked={privacy}
                onChange={(e) => setPrivacy(e.target.checked)}
              />{" "}
              Pemberitahuan privasi dan otorisasi pemrosesan telah dikonfirmasi.
              Enrollment ini hanya DEMO.
            </label>
            <p>
              Scope tujuan:{" "}
              {lounges.find((l) => l.id === loungeId)?.name ||
                "Pilih access location di atas"}
              .
            </p>
            <button
              type="submit"
              disabled={
                busy ||
                !staffId ||
                (!loungeId && operation !== "deactivate") ||
                !privacy ||
                !identityConfirmed
              }
            >
              Simpan staff DEMO
            </button>
          </form>
          {staffCursor && (
            <button
              type="button"
              onClick={() =>
                void loadStaff(staffCursor).catch(() =>
                  setNotice("Staff gagal dimuat."),
                )
              }
            >
              Muat staff berikutnya
            </button>
          )}
        </article>
      )}
      <article className="card">
        <h2>Recent Access Activity</h2>
        <div className="form">
          <label>
            Cari aktivitas
            <input
              value={query}
              placeholder="Masked ID, lokasi, reason, gate"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            Decision
            <select
              value={decisionFilter}
              onChange={(e) => setDecisionFilter(e.target.value)}
            >
              <option value="ALL">All decisions</option>
              <option>ELIGIBLE</option>
              <option>NOT_ELIGIBLE</option>
            </select>
          </label>
          <label>
            Person category
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="ALL">All categories</option>
              <option>Passenger</option>
              <option>Staff</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          onClick={() =>
            void loadActivity().catch(() =>
              setNotice("Aktivitas gagal dimuat."),
            )
          }
        >
          Refresh activity
        </button>
        <p>
          Urutan terbaru. Filter berlaku pada {activity.length} baris yang
          dimuat untuk lokasi aktif.
        </p>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                {[
                  "Timestamp",
                  "Location",
                  "Category",
                  "Masked ID",
                  "Identity",
                  "Entitlement / authorization",
                  "Decision",
                  "Gate ack",
                  "Reason",
                  "Mode",
                ].map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length ? (
                filtered.map((x) => (
                  <tr key={x.id}>
                    <td>{x.createdAt}</td>
                    <td>{x.location}</td>
                    <td>{x.category}</td>
                    <td>{x.maskedIdentifier}</td>
                    <td>{x.identity}</td>
                    <td>{x.authorization}</td>
                    <td>{x.decision}</td>
                    <td>{x.gate.state}</td>
                    <td>{reasons[x.reason] || x.reason || "—"}</td>
                    <td>{x.mode}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10}>Belum ada aktivitas sesuai filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {cursor && (
          <button
            type="button"
            onClick={() =>
              void loadActivity(cursor).catch(() =>
                setNotice("Halaman aktivitas gagal dimuat."),
              )
            }
          >
            Muat 50 berikutnya
          </button>
        )}
      </article>
    </>
  );
}
