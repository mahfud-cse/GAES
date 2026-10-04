"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  removeRecord,
  saveRecord,
  subscribeStationCollection,
} from "../lib/firebase/repository";

type FacilityRole =
  | "Super Admin"
  | "Admin"
  | "HO Admin"
  | "BO Admin"
  | "Lounge Officer"
  | "Lounge Manager"
  | "HO Ancillary Coordinator"
  | "HO Ancillary Verifier"
  | "Airline Coordinator"
  | "Airline Verifier"
  | "Report Viewer";

type FacilityAccount = {
  id: string;
  name: string;
  role: FacilityRole;
  station: string;
};

type StationOption = { code: string; name: string };

type RoomState = "Available" | "Reserved" | "Occupied" | "Cleaning" | "Maintenance";
type RoomRecord = {
  id: string;
  station: string;
  name: string;
  area: string;
  roomType: string;
  capacity: number;
  facilities: string[];
  operationalState: RoomState;
  status: "Active" | "Inactive";
};

type DeviceRecord = {
  id: string;
  station: string;
  roomId: string;
  name: string;
  platform: "Smart TV Browser" | "Android Signage Player" | "Mini PC";
  connectionType: "LAN" | "Wi-Fi";
  approvalStatus: "Pending" | "Approved" | "Rejected";
  status: "Online" | "Offline" | "Degraded" | "Disabled" | "Unregistered";
  nowPlaying: string;
  overlayText: string;
  lastHeartbeat: string;
  playerVersion: string;
  screenshotUrl?: string;
  approvedBy?: string;
  approvedAt?: string;
};

type Notice = { kind: "ok" | "warn" | "error"; text: string };
type ModuleTab =
  | "Overview"
  | "Room Booking"
  | "Room Operations"
  | "TV & Digital Signage"
  | "Master & Configuration"
  | "Activity Log";

const GLOBAL_ROLES: FacilityRole[] = [
  "Super Admin",
  "Admin",
  "HO Admin",
  "HO Ancillary Coordinator",
  "HO Ancillary Verifier",
];
const CONFIG_ROLES: FacilityRole[] = ["Super Admin", "Admin", "HO Admin"];
const CONTROL_ROLES: FacilityRole[] = [
  "Super Admin",
  "Admin",
  "HO Admin",
  "BO Admin",
  "Lounge Manager",
  "Lounge Officer",
];

const EMPTY_ROOM: Omit<RoomRecord, "id"> = {
  station: "CGK",
  name: "",
  area: "",
  roomType: "Meeting Room",
  capacity: 1,
  facilities: [],
  operationalState: "Available",
  status: "Active",
};

const EMPTY_DEVICE: Omit<DeviceRecord, "id"> = {
  station: "CGK",
  roomId: "",
  name: "",
  platform: "Smart TV Browser",
  connectionType: "LAN",
  approvalStatus: "Pending",
  status: "Unregistered",
  nowPlaying: "",
  overlayText: "",
  lastHeartbeat: "",
  playerVersion: "",
};

function recordId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isOnline(device: DeviceRecord) {
  if (device.status === "Disabled" || device.approvalStatus !== "Approved") return false;
  if (!device.lastHeartbeat) return device.status === "Online";
  const heartbeat = Date.parse(device.lastHeartbeat);
  return Number.isFinite(heartbeat) && Date.now() - heartbeat < 120_000;
}

function readableHeartbeat(value: string) {
  if (!value) return "Belum pernah terhubung";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export default function FacilityOperations({
  account,
  stations,
}: {
  account: FacilityAccount;
  stations: StationOption[];
}) {
  const [activeTab, setActiveTab] = useState<ModuleTab>("Overview");
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [stationFilter, setStationFilter] = useState(
    GLOBAL_ROLES.includes(account.role) ? "ALL" : account.station,
  );
  const [roomDraft, setRoomDraft] = useState(EMPTY_ROOM);
  const [deviceDraft, setDeviceDraft] = useState(EMPTY_DEVICE);
  const [editingRoom, setEditingRoom] = useState<string | null>(null);
  const [editingDevice, setEditingDevice] = useState<string | null>(null);
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const globalScope = GLOBAL_ROLES.includes(account.role);
  const canConfigure = CONFIG_ROLES.includes(account.role);
  const canControl = CONTROL_ROLES.includes(account.role);
  const permittedStation = useCallback(
    (value: string) => globalScope || value === account.station,
    [account.station, globalScope],
  );

  useEffect(() => {
    const onError = (error: Error) =>
      setNotice({ kind: "error", text: `Data fasilitas tidak dapat dimuat: ${error.message}` });
    const stops = [
      subscribeStationCollection<RoomRecord>(
        "rooms",
        globalScope ? "ALL" : account.station,
        setRooms,
        onError,
      ),
      subscribeStationCollection<DeviceRecord>(
        "displayDevices",
        globalScope ? "ALL" : account.station,
        setDevices,
        onError,
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [account.station, globalScope]);

  const scopedRooms = useMemo(
    () =>
      rooms.filter(
        (room) => permittedStation(room.station) && (stationFilter === "ALL" || room.station === stationFilter),
      ),
    [rooms, stationFilter, permittedStation],
  );
  const scopedDevices = useMemo(
    () =>
      devices.filter(
        (device) =>
          permittedStation(device.station) &&
          (stationFilter === "ALL" || device.station === stationFilter),
      ),
    [devices, stationFilter, permittedStation],
  );

  const activeStations = stations.filter((station) => permittedStation(station.code));
  const roomName = (id: string) => rooms.find((room) => room.id === id)?.name || "Belum dipetakan";

  async function saveRoom(event: FormEvent) {
    event.preventDefault();
    if (!canConfigure || !permittedStation(roomDraft.station)) return;
    if (!roomDraft.name.trim() || !roomDraft.area.trim()) {
      setNotice({ kind: "warn", text: "Nama room dan area wajib diisi." });
      return;
    }
    const id = editingRoom || recordId("room");
    await saveRecord("rooms", { id, ...roomDraft, capacity: Math.max(1, Number(roomDraft.capacity) || 1) });
    setNotice({ kind: "ok", text: `Room ${roomDraft.name} berhasil disimpan.` });
    setRoomDraft({ ...EMPTY_ROOM, station: globalScope ? "CGK" : account.station });
    setEditingRoom(null);
    setShowRoomForm(false);
  }

  async function saveDevice(event: FormEvent) {
    event.preventDefault();
    if (!canConfigure || !permittedStation(deviceDraft.station)) return;
    if (!deviceDraft.name.trim()) {
      setNotice({ kind: "warn", text: "Nama device wajib diisi." });
      return;
    }
    const id = editingDevice || recordId("display");
    await saveRecord("displayDevices", { id, ...deviceDraft });
    setNotice({ kind: "ok", text: `Device ${deviceDraft.name} berhasil disimpan sebagai inventory.` });
    setDeviceDraft({ ...EMPTY_DEVICE, station: globalScope ? "CGK" : account.station });
    setEditingDevice(null);
    setShowDeviceForm(false);
  }

  async function approveDevice(device: DeviceRecord) {
    if (!canConfigure || !permittedStation(device.station)) return;
    await saveRecord("displayDevices", {
      ...device,
      approvalStatus: "Approved",
      status: device.status === "Unregistered" ? "Offline" : device.status,
      approvedBy: account.name,
      approvedAt: new Date().toISOString(),
    });
    setNotice({ kind: "ok", text: `${device.name} disetujui. Aktivasi player dilakukan pada tahap integrasi device.` });
  }

  const tabs: ModuleTab[] = [
    "Overview",
    "Room Booking",
    "Room Operations",
    "TV & Digital Signage",
    "Master & Configuration",
    "Activity Log",
  ];
  const roomStates: RoomState[] = ["Available", "Reserved", "Occupied", "Cleaning", "Maintenance"];

  return (
    <div className="facilityModule">
      <div className="title facilityTitle">
        <div>
          <small>FACILITY &amp; ROOM OPERATIONS</small>
          <h1>Facility &amp; Room Operations</h1>
          <p>Kesiapan ruangan, fondasi pemesanan, serta monitoring TV dan digital signage sesuai scope akun.</p>
        </div>
        <label className="facilityStationFilter">
          <span>Station</span>
          <select value={stationFilter} onChange={(event) => setStationFilter(event.target.value)} disabled={!globalScope}>
            {globalScope && <option value="ALL">All Stations</option>}
            {activeStations.map((station) => (
              <option key={station.code} value={station.code}>{station.code} — {station.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="subTabs facilityTabs" role="tablist" aria-label="Facility operations navigation">
        {tabs.map((item) => (
          <button key={item} type="button" className={activeTab === item ? "active" : ""} onClick={() => setActiveTab(item)}>
            {item}
          </button>
        ))}
      </div>

      {notice && (
        <div className={`notice ${notice.kind}`}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Tutup notifikasi">×</button>
        </div>
      )}

      {activeTab === "Overview" && (
        <>
          <div className="facilityKpis">
            <article><span>Total Room</span><strong>{scopedRooms.length}</strong><small>{scopedRooms.filter((room) => room.status === "Active").length} active</small></article>
            <article><span>Available</span><strong>{scopedRooms.filter((room) => room.operationalState === "Available").length}</strong><small>Ready to use</small></article>
            <article><span>Occupied</span><strong>{scopedRooms.filter((room) => room.operationalState === "Occupied").length}</strong><small>In operation</small></article>
            <article><span>Cleaning / Maintenance</span><strong>{scopedRooms.filter((room) => ["Cleaning", "Maintenance"].includes(room.operationalState)).length}</strong><small>Need attention</small></article>
            <article><span>Display Online</span><strong>{scopedDevices.filter(isOnline).length}/{scopedDevices.length}</strong><small>{scopedDevices.filter((device) => device.approvalStatus === "Pending").length} pending approval</small></article>
          </div>
          <div className="facilityOverviewGrid">
            <article className="card">
              <div className="cardHeading"><div><small>ROOM READINESS</small><h2>Current Room Status</h2></div></div>
              {!scopedRooms.length ? <EmptyState text="Belum ada room pada station ini. Tambahkan melalui Master & Configuration." /> : (
                <div className="facilityRoomGrid">
                  {scopedRooms.map((room) => (
                    <div className="facilityRoomCard" key={room.id}>
                      <div><span className={`statusDot state-${room.operationalState.toLowerCase()}`} /> <b>{room.name}</b></div>
                      <small>{room.station} · {room.area} · Capacity {room.capacity}</small>
                      <strong>{room.operationalState}</strong>
                      <span>{room.facilities.length ? room.facilities.join(" · ") : "Facility list belum diisi"}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>
            <article className="card">
              <div className="cardHeading"><div><small>DISPLAY MONITOR</small><h2>Now Playing</h2></div></div>
              {!scopedDevices.length ? <EmptyState text="Belum ada display device yang terdaftar." /> : (
                <div className="facilityDeviceList">
                  {scopedDevices.map((device) => (
                    <div key={device.id}>
                      <span className={`deviceStatus ${isOnline(device) ? "online" : "offline"}`}>{isOnline(device) ? "Online" : device.status}</span>
                      <b>{device.name}</b>
                      <small>{device.station} · {roomName(device.roomId)}</small>
                      <span>{device.nowPlaying || "Belum ada tayangan"}</span>
                      {device.overlayText && <em>Running text: {device.overlayText}</em>}
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>
        </>
      )}

      {activeTab === "TV & Digital Signage" && (
        <article className="card">
          <div className="cardHeading facilityActionHeading">
            <div><small>DEVICE CONTROL CENTER</small><h2>Display Monitoring</h2><p>Monitoring tersedia sekarang. Remote command diaktifkan setelah command service dan player tervalidasi.</p></div>
            {canConfigure && <button type="button" onClick={() => { setEditingDevice(null); setDeviceDraft({ ...EMPTY_DEVICE, station: globalScope ? "CGK" : account.station }); setShowDeviceForm(true); }}>+ Add Device Inventory</button>}
          </div>
          {!scopedDevices.length ? <EmptyState text="Belum ada device. Tambahkan inventory device atau lakukan enrollment pada tahap integrasi player." /> : (
            <div className="tableWrap">
              <table className="facilityTable">
                <thead><tr><th>Device</th><th>Location</th><th>Status</th><th>Now Playing</th><th>Running Text</th><th>Last Heartbeat</th><th>Action</th></tr></thead>
                <tbody>{scopedDevices.map((device) => (
                  <tr key={device.id}>
                    <td><b>{device.name}</b><small>{device.platform} · {device.connectionType}</small></td>
                    <td>{device.station}<small>{roomName(device.roomId)}</small></td>
                    <td><span className={`deviceStatus ${isOnline(device) ? "online" : "offline"}`}>{device.approvalStatus === "Pending" ? "Pending Approval" : isOnline(device) ? "Online" : device.status}</span></td>
                    <td>{device.nowPlaying || "—"}</td><td>{device.overlayText || "—"}</td><td>{readableHeartbeat(device.lastHeartbeat)}</td>
                    <td><div className="tableActions">
                      {canConfigure && device.approvalStatus === "Pending" && <button type="button" onClick={() => void approveDevice(device)}>Approve</button>}
                      {canConfigure && <button type="button" onClick={() => { setEditingDevice(device.id); setDeviceDraft(device); setShowDeviceForm(true); }}>Edit</button>}
                      <button type="button" disabled title="Tersedia setelah command service aktif">Play Now</button>
                      {canControl && <button type="button" disabled title="Tersedia setelah command service aktif">Request Screenshot</button>}
                    </div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </article>
      )}

      {activeTab === "Master & Configuration" && (
        <article className="card">
          <div className="cardHeading facilityActionHeading">
            <div><small>ROOM &amp; DEVICE INVENTORY</small><h2>Master Configuration</h2><p>Configuration changes are limited to authorized HO administrators.</p></div>
            {canConfigure && <div><button type="button" onClick={() => { setEditingRoom(null); setRoomDraft({ ...EMPTY_ROOM, station: globalScope ? "CGK" : account.station }); setShowRoomForm(true); }}>+ Add Room</button><button type="button" onClick={() => { setEditingDevice(null); setDeviceDraft({ ...EMPTY_DEVICE, station: globalScope ? "CGK" : account.station }); setShowDeviceForm(true); }}>+ Add Device</button></div>}
          </div>
          <div className="tableWrap">
            <table className="facilityTable"><thead><tr><th>Room</th><th>Station / Area</th><th>Type</th><th>Capacity</th><th>Facilities</th><th>Operational State</th><th>Action</th></tr></thead>
              <tbody>{scopedRooms.length ? scopedRooms.map((room) => <tr key={room.id}><td><b>{room.name}</b><small>{room.status}</small></td><td>{room.station}<small>{room.area}</small></td><td>{room.roomType}</td><td>{room.capacity}</td><td>{room.facilities.join(", ") || "—"}</td><td>{room.operationalState}</td><td><div className="tableActions">{canConfigure && <><button type="button" onClick={() => { setEditingRoom(room.id); setRoomDraft(room); setShowRoomForm(true); }}>Edit</button><button type="button" onClick={() => { if (window.confirm(`Hapus room ${room.name}?`)) void removeRecord("rooms", room.id); }}>Delete</button></>}</div></td></tr>) : <tr><td colSpan={7}>Belum ada room pada scope ini.</td></tr>}</tbody>
            </table>
          </div>
        </article>
      )}

      {["Room Booking", "Room Operations", "Activity Log"].includes(activeTab) && (
        <article className="card phasePlaceholder">
          <span className="phaseBadge">NEXT PHASE</span>
          <h2>{activeTab}</h2>
          <p>{activeTab === "Room Booking" ? "Calendar, conflict prevention, approval, recurring booking, dan cleaning buffer akan dibangun pada Tahap 2." : activeTab === "Room Operations" ? "Check-in/out, readiness checklist, cleaning, handover, dan maintenance akan dibangun pada Tahap 3." : "Activity log akan mulai terisi setelah backend command service dan room workflow diaktifkan."}</p>
        </article>
      )}

      {showRoomForm && (
        <div className="back" onMouseDown={(event) => event.target === event.currentTarget && setShowRoomForm(false)}>
          <div className="modal facilityModal"><div className="modalHead"><div><small>MASTER CONFIGURATION</small><h2>{editingRoom ? "Edit Room" : "Add Room"}</h2></div><button type="button" onClick={() => setShowRoomForm(false)}>×</button></div>
            <form className="form" onSubmit={(event) => void saveRoom(event)}>
              <label><span>Station</span><select value={roomDraft.station} onChange={(event) => setRoomDraft({ ...roomDraft, station: event.target.value })}>{activeStations.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.name}</option>)}</select></label>
              <label><span>Room Name</span><input value={roomDraft.name} onChange={(event) => setRoomDraft({ ...roomDraft, name: event.target.value })} required /></label>
              <label><span>Area / Location</span><input value={roomDraft.area} onChange={(event) => setRoomDraft({ ...roomDraft, area: event.target.value })} required /></label>
              <label><span>Room Type</span><select value={roomDraft.roomType} onChange={(event) => setRoomDraft({ ...roomDraft, roomType: event.target.value })}><option>Meeting Room</option><option>VIP Room</option><option>Private Room</option><option>Prayer Room</option><option>Other</option></select></label>
              <label><span>Capacity</span><input type="number" min="1" value={roomDraft.capacity} onChange={(event) => setRoomDraft({ ...roomDraft, capacity: Number(event.target.value) })} /></label>
              <label><span>Operational State</span><select value={roomDraft.operationalState} onChange={(event) => setRoomDraft({ ...roomDraft, operationalState: event.target.value as RoomState })}>{roomStates.map((state) => <option key={state}>{state}</option>)}</select></label>
              <label className="full"><span>Facilities (comma separated)</span><input value={roomDraft.facilities.join(", ")} onChange={(event) => setRoomDraft({ ...roomDraft, facilities: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="TV, HDMI, Conference Table" /></label>
              <div className="modalActions full"><button type="button" onClick={() => setShowRoomForm(false)}>Cancel</button><button className="primary" type="submit">Save Room</button></div>
            </form>
          </div>
        </div>
      )}

      {showDeviceForm && (
        <div className="back" onMouseDown={(event) => event.target === event.currentTarget && setShowDeviceForm(false)}>
          <div className="modal facilityModal"><div className="modalHead"><div><small>DISPLAY INVENTORY</small><h2>{editingDevice ? "Edit Device" : "Add Device"}</h2></div><button type="button" onClick={() => setShowDeviceForm(false)}>×</button></div>
            <form className="form" onSubmit={(event) => void saveDevice(event)}>
              <label><span>Station</span><select value={deviceDraft.station} onChange={(event) => setDeviceDraft({ ...deviceDraft, station: event.target.value, roomId: "" })}>{activeStations.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.name}</option>)}</select></label>
              <label><span>Device Name</span><input value={deviceDraft.name} onChange={(event) => setDeviceDraft({ ...deviceDraft, name: event.target.value })} placeholder="CGK-T3-DOM-TV-01" required /></label>
              <label><span>Mapped Room</span><select value={deviceDraft.roomId} onChange={(event) => setDeviceDraft({ ...deviceDraft, roomId: event.target.value })}><option value="">Belum dipetakan</option>{rooms.filter((room) => room.station === deviceDraft.station).map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
              <label><span>Platform</span><select value={deviceDraft.platform} onChange={(event) => setDeviceDraft({ ...deviceDraft, platform: event.target.value as DeviceRecord["platform"] })}><option>Smart TV Browser</option><option>Android Signage Player</option><option>Mini PC</option></select></label>
              <label><span>Connection</span><select value={deviceDraft.connectionType} onChange={(event) => setDeviceDraft({ ...deviceDraft, connectionType: event.target.value as DeviceRecord["connectionType"] })}><option>LAN</option><option>Wi-Fi</option></select></label>
              <label><span>Approval</span><select value={deviceDraft.approvalStatus} onChange={(event) => setDeviceDraft({ ...deviceDraft, approvalStatus: event.target.value as DeviceRecord["approvalStatus"] })}><option>Pending</option><option>Approved</option><option>Rejected</option></select></label>
              <div className="notice warn full"><span>Inventory belum berarti device sudah terhubung. Credential dan heartbeat akan dibuat melalui enrollment service pada tahap integrasi player.</span></div>
              <div className="modalActions full"><button type="button" onClick={() => setShowDeviceForm(false)}>Cancel</button><button className="primary" type="submit">Save Device</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="facilityEmpty"><strong>No operational data</strong><span>{text}</span></div>;
}
