"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { manageRoomBooking } from "../lib/firebase/api";
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

type StationOption = { code: string; name: string; timeZone: string };

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

type BookingStatus =
  | "Draft"
  | "Requested"
  | "Approved"
  | "Rejected"
  | "Cancelled"
  | "Checked-in"
  | "Completed"
  | "No Show";
type RoomBooking = {
  id: string;
  station: string;
  roomId: string;
  roomName: string;
  title: string;
  purpose: string;
  organizer: string;
  contact: string;
  attendees: number;
  startAt: string;
  endAt: string;
  localDate: string;
  startTime: string;
  endTime: string;
  stationTimeZone: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  notes: string;
  visitorReference: string;
  status: BookingStatus;
  recurrenceGroupId?: string;
  createdBy: string;
  createdByName: string;
};
type BookingDraft = {
  station: string;
  roomId: string;
  title: string;
  purpose: string;
  organizer: string;
  contact: string;
  attendees: number;
  localDate: string;
  startTime: string;
  endTime: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  recurrenceType: "None" | "Daily" | "Weekly" | "Monthly";
  recurrenceCount: number;
  visitorReference: string;
  notes: string;
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
const APPROVER_ROLES: FacilityRole[] = [
  "Super Admin",
  "Admin",
  "HO Admin",
  "BO Admin",
  "Lounge Manager",
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

function localToday() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

const EMPTY_BOOKING: BookingDraft = {
  station: "CGK",
  roomId: "",
  title: "",
  purpose: "",
  organizer: "",
  contact: "",
  attendees: 1,
  localDate: localToday(),
  startTime: "09:00",
  endTime: "10:00",
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 15,
  recurrenceType: "None",
  recurrenceCount: 1,
  visitorReference: "",
  notes: "",
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

function localDateTimeToIso(dateValue: string, timeValue: string, timeZone: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(guess));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const displayedAsUtc = Date.UTC(
    Number(value.year),
    Number(value.month) - 1,
    Number(value.day),
    Number(value.hour),
    Number(value.minute),
    Number(value.second),
  );
  return new Date(guess - (displayedAsUtc - guess)).toISOString();
}

export default function FacilityOperations({
  account,
  stations,
  user,
}: {
  account: FacilityAccount;
  stations: StationOption[];
  user: User;
}) {
  const [activeTab, setActiveTab] = useState<ModuleTab>("Overview");
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [bookings, setBookings] = useState<RoomBooking[]>([]);
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
  const [bookingView, setBookingView] = useState<"Day" | "Week" | "Month" | "List">("Month");
  const [bookingAnchor, setBookingAnchor] = useState(localToday());
  const [bookingRoomFilter, setBookingRoomFilter] = useState("ALL");
  const [bookingStatusFilter, setBookingStatusFilter] = useState("ALL");
  const [bookingDraft, setBookingDraft] = useState<BookingDraft>(EMPTY_BOOKING);
  const [bookingRequestId, setBookingRequestId] = useState("");
  const [editingBooking, setEditingBooking] = useState<string | null>(null);
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [savingBooking, setSavingBooking] = useState(false);

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
      subscribeStationCollection<RoomBooking>(
        "roomBookings",
        globalScope ? "ALL" : account.station,
        setBookings,
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
  const scopedBookings = useMemo(
    () =>
      bookings
        .filter(
          (booking) =>
            permittedStation(booking.station) &&
            (stationFilter === "ALL" || booking.station === stationFilter) &&
            (bookingRoomFilter === "ALL" || booking.roomId === bookingRoomFilter) &&
            (bookingStatusFilter === "ALL" || booking.status === bookingStatusFilter),
        )
        .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [bookings, bookingRoomFilter, bookingStatusFilter, permittedStation, stationFilter],
  );

  const activeStations = stations.filter((station) => permittedStation(station.code));
  const roomName = (id: string) => rooms.find((room) => room.id === id)?.name || "Belum dipetakan";
  const canApproveBooking = APPROVER_ROLES.includes(account.role);

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

  function openNewBooking() {
    const defaultStation = stationFilter !== "ALL" ? stationFilter : activeStations[0]?.code || account.station;
    const firstRoom = rooms.find((room) => room.station === defaultStation && room.status === "Active");
    setEditingBooking(null);
    setBookingRequestId(globalThis.crypto?.randomUUID?.() || recordId("booking-request"));
    setBookingDraft({
      ...EMPTY_BOOKING,
      station: defaultStation,
      roomId: firstRoom?.id || "",
      organizer: account.name,
      localDate: bookingAnchor,
    });
    setShowBookingForm(true);
  }

  function editDraft(booking: RoomBooking) {
    setEditingBooking(booking.id);
    setBookingDraft({
      station: booking.station,
      roomId: booking.roomId,
      title: booking.title,
      purpose: booking.purpose || "",
      organizer: booking.organizer || account.name,
      contact: booking.contact || "",
      attendees: booking.attendees || 1,
      localDate: booking.localDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      bufferBeforeMinutes: booking.bufferBeforeMinutes || 0,
      bufferAfterMinutes: booking.bufferAfterMinutes || 0,
      recurrenceType: "None",
      recurrenceCount: 1,
      visitorReference: booking.visitorReference || "",
      notes: booking.notes || "",
    });
    setShowBookingForm(true);
  }

  async function saveBooking(submit: boolean) {
    const stationData = stations.find((item) => item.code === bookingDraft.station);
    if (!bookingDraft.roomId || !bookingDraft.title.trim() || !stationData?.timeZone) {
      setNotice({ kind: "warn", text: "Room, judul, dan timezone station wajib tersedia." });
      return;
    }
    setSavingBooking(true);
    try {
      const booking = {
        ...bookingDraft,
        stationTimeZone: stationData.timeZone,
        startAt: localDateTimeToIso(bookingDraft.localDate, bookingDraft.startTime, stationData.timeZone),
        endAt: localDateTimeToIso(bookingDraft.localDate, bookingDraft.endTime, stationData.timeZone),
        submit,
        requestId: bookingRequestId,
      };
      let result = await manageRoomBooking(user, editingBooking
        ? { action: "update", id: editingBooking, booking }
        : { action: "create", booking });
      if (editingBooking && submit) {
        result = await manageRoomBooking(user, { action: "submit", id: editingBooking });
      }
      setNotice({
        kind: "ok",
        text: submit
          ? `Booking berhasil dikirim untuk approval (${result.status}).`
          : "Booking berhasil disimpan sebagai Draft.",
      });
      setShowBookingForm(false);
      setEditingBooking(null);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Room booking tidak dapat disimpan." });
    } finally {
      setSavingBooking(false);
    }
  }

  async function bookingAction(booking: RoomBooking, action: "submit" | "approve" | "reject" | "cancel") {
    const reason = ["reject", "cancel"].includes(action)
      ? window.prompt(action === "reject" ? "Alasan penolakan:" : "Alasan pembatalan:")
      : "";
    if (["reject", "cancel"].includes(action) && reason === null) return;
    if (["reject", "cancel"].includes(action) && !reason?.trim()) {
      setNotice({ kind: "warn", text: "Alasan penolakan atau pembatalan wajib diisi." });
      return;
    }
    try {
      const result = await manageRoomBooking(user, { action, id: booking.id, reason: reason || "" });
      setNotice({ kind: "ok", text: `Booking ${booking.title} berubah menjadi ${result.status}.` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Status booking tidak dapat diubah." });
    }
  }

  function moveBookingAnchor(direction: -1 | 1) {
    const date = new Date(`${bookingAnchor}T00:00:00`);
    if (bookingView === "Day") date.setDate(date.getDate() + direction);
    else if (bookingView === "Week") date.setDate(date.getDate() + direction * 7);
    else date.setMonth(date.getMonth() + direction);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    setBookingAnchor(local.toISOString().slice(0, 10));
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
            <article><span>{"Today's Booking"}</span><strong>{scopedBookings.filter((booking) => booking.localDate === localToday() && !["Rejected", "Cancelled"].includes(booking.status)).length}</strong><small>Across visible rooms</small></article>
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

      {activeTab === "Room Booking" && (
        <article className="card roomBookingCard">
          <div className="cardHeading facilityActionHeading">
            <div>
              <small>ROOM BOOKING</small>
              <h2>Booking Calendar</h2>
              <p>Booking yang diajukan langsung mengunci waktu room termasuk preparation dan cleaning buffer.</p>
            </div>
            <button className="primary" type="button" onClick={openNewBooking}>+ New Booking</button>
          </div>

          <div className="bookingToolbar">
            <div className="bookingViewSwitch" aria-label="Calendar view">
              {(["Day", "Week", "Month", "List"] as const).map((view) => (
                <button key={view} type="button" className={bookingView === view ? "active" : ""} onClick={() => setBookingView(view)}>{view}</button>
              ))}
            </div>
            <div className="bookingPeriodNav">
              <button type="button" onClick={() => moveBookingAnchor(-1)} aria-label="Previous period">‹</button>
              <input type="date" value={bookingAnchor} onChange={(event) => setBookingAnchor(event.target.value)} />
              <button type="button" onClick={() => moveBookingAnchor(1)} aria-label="Next period">›</button>
              <button type="button" onClick={() => setBookingAnchor(localToday())}>Today</button>
            </div>
            <label><span>Room</span><select value={bookingRoomFilter} onChange={(event) => setBookingRoomFilter(event.target.value)}><option value="ALL">All Rooms</option>{scopedRooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
            <label><span>Status</span><select value={bookingStatusFilter} onChange={(event) => setBookingStatusFilter(event.target.value)}><option value="ALL">All Status</option>{["Draft", "Requested", "Approved", "Rejected", "Cancelled", "Checked-in", "Completed", "No Show"].map((status) => <option key={status}>{status}</option>)}</select></label>
          </div>

          <BookingCalendar
            view={bookingView}
            anchor={bookingAnchor}
            bookings={scopedBookings}
            currentUserId={account.id}
            canApprove={canApproveBooking}
            onEdit={editDraft}
            onAction={(booking, action) => void bookingAction(booking, action)}
          />
        </article>
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

      {["Room Operations", "Activity Log"].includes(activeTab) && (
        <article className="card phasePlaceholder">
          <span className="phaseBadge">NEXT PHASE</span>
          <h2>{activeTab}</h2>
          <p>{activeTab === "Room Booking" ? "Calendar, conflict prevention, approval, recurring booking, dan cleaning buffer akan dibangun pada Tahap 2." : activeTab === "Room Operations" ? "Check-in/out, readiness checklist, cleaning, handover, dan maintenance akan dibangun pada Tahap 3." : "Activity log akan mulai terisi setelah backend command service dan room workflow diaktifkan."}</p>
        </article>
      )}

      {showBookingForm && (
        <div className="back" onMouseDown={(event) => event.target === event.currentTarget && setShowBookingForm(false)}>
          <div className="modal facilityModal bookingModal">
            <div className="modalHead"><div><small>ROOM BOOKING</small><h2>{editingBooking ? "Edit Draft Booking" : "New Room Booking"}</h2></div><button type="button" onClick={() => setShowBookingForm(false)}>×</button></div>
            <form className="form" onSubmit={(event) => { event.preventDefault(); void saveBooking(false); }}>
              <label><span>Station</span><select value={bookingDraft.station} onChange={(event) => { const nextStation = event.target.value; setBookingDraft({ ...bookingDraft, station: nextStation, roomId: rooms.find((room) => room.station === nextStation && room.status === "Active")?.id || "" }); }} disabled={Boolean(editingBooking)}>{activeStations.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.name}</option>)}</select></label>
              <label><span>Room</span><select value={bookingDraft.roomId} onChange={(event) => setBookingDraft({ ...bookingDraft, roomId: event.target.value })} required><option value="">Select room</option>{rooms.filter((room) => room.station === bookingDraft.station && room.status === "Active").map((room) => <option key={room.id} value={room.id}>{room.name} · Capacity {room.capacity}</option>)}</select></label>
              <label className="full"><span>Booking Title</span><input value={bookingDraft.title} onChange={(event) => setBookingDraft({ ...bookingDraft, title: event.target.value })} required /></label>
              <label className="full"><span>Purpose</span><input value={bookingDraft.purpose} onChange={(event) => setBookingDraft({ ...bookingDraft, purpose: event.target.value })} /></label>
              <label><span>Organizer</span><input value={bookingDraft.organizer} onChange={(event) => setBookingDraft({ ...bookingDraft, organizer: event.target.value })} /></label>
              <label><span>Contact</span><input value={bookingDraft.contact} onChange={(event) => setBookingDraft({ ...bookingDraft, contact: event.target.value })} /></label>
              <label><span>Date</span><input type="date" value={bookingDraft.localDate} onChange={(event) => setBookingDraft({ ...bookingDraft, localDate: event.target.value })} required /></label>
              <label><span>Attendees</span><input type="number" min="1" value={bookingDraft.attendees} onChange={(event) => setBookingDraft({ ...bookingDraft, attendees: Number(event.target.value) })} /></label>
              <label><span>Start Time</span><input type="time" step="900" value={bookingDraft.startTime} onChange={(event) => setBookingDraft({ ...bookingDraft, startTime: event.target.value })} required /></label>
              <label><span>End Time</span><input type="time" step="900" value={bookingDraft.endTime} onChange={(event) => setBookingDraft({ ...bookingDraft, endTime: event.target.value })} required /></label>
              <label><span>Preparation Buffer</span><select value={bookingDraft.bufferBeforeMinutes} onChange={(event) => setBookingDraft({ ...bookingDraft, bufferBeforeMinutes: Number(event.target.value) })}>{[0, 15, 30, 45, 60].map((value) => <option key={value} value={value}>{value} minutes</option>)}</select></label>
              <label><span>Cleaning Buffer</span><select value={bookingDraft.bufferAfterMinutes} onChange={(event) => setBookingDraft({ ...bookingDraft, bufferAfterMinutes: Number(event.target.value) })}>{[0, 15, 30, 45, 60, 90, 120].map((value) => <option key={value} value={value}>{value} minutes</option>)}</select></label>
              {!editingBooking && <><label><span>Recurrence</span><select value={bookingDraft.recurrenceType} onChange={(event) => setBookingDraft({ ...bookingDraft, recurrenceType: event.target.value as BookingDraft["recurrenceType"], recurrenceCount: event.target.value === "None" ? 1 : bookingDraft.recurrenceCount })}><option>None</option><option>Daily</option><option>Weekly</option><option>Monthly</option></select></label><label><span>Occurrences</span><input type="number" min="1" max="12" disabled={bookingDraft.recurrenceType === "None"} value={bookingDraft.recurrenceCount} onChange={(event) => setBookingDraft({ ...bookingDraft, recurrenceCount: Number(event.target.value) })} /></label></>}
              <label className="full"><span>Visitor / Flight Reference (optional)</span><input value={bookingDraft.visitorReference} onChange={(event) => setBookingDraft({ ...bookingDraft, visitorReference: event.target.value })} /></label>
              <label className="full"><span>Notes</span><textarea value={bookingDraft.notes} onChange={(event) => setBookingDraft({ ...bookingDraft, notes: event.target.value })} /></label>
              <div className="notice warn full"><span>Booking yang diajukan akan menahan seluruh slot waktu termasuk buffer. Sistem menolak booking yang berbenturan.</span></div>
              <div className="modalActions full"><button type="button" onClick={() => setShowBookingForm(false)}>Cancel</button><button type="submit" disabled={savingBooking}>{savingBooking ? "Saving..." : "Save Draft"}</button><button className="primary" type="button" disabled={savingBooking} onClick={() => void saveBooking(true)}>Submit for Approval</button></div>
            </form>
          </div>
        </div>
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

function dateValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function startOfWeek(value: string) {
  const date = new Date(`${value}T00:00:00`);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date;
}

function BookingCalendar({
  view,
  anchor,
  bookings,
  currentUserId,
  canApprove,
  onEdit,
  onAction,
}: {
  view: "Day" | "Week" | "Month" | "List";
  anchor: string;
  bookings: RoomBooking[];
  currentUserId: string;
  canApprove: boolean;
  onEdit: (booking: RoomBooking) => void;
  onAction: (booking: RoomBooking, action: "submit" | "approve" | "reject" | "cancel") => void;
}) {
  const byDate = (date: string) => bookings.filter((booking) => booking.localDate === date);
  const card = (booking: RoomBooking, compact = false) => (
    <div className={`bookingEvent status-${booking.status.toLowerCase().replaceAll(" ", "-")} ${compact ? "compact" : ""}`} key={booking.id}>
      <div><b>{booking.startTime}–{booking.endTime}</b><span className="bookingStatus">{booking.status}</span></div>
      <strong>{booking.title}</strong>
      <small>{booking.roomName} · {booking.organizer}</small>
      {!compact && <><span>{booking.attendees} attendees · Buffer {booking.bufferBeforeMinutes}/{booking.bufferAfterMinutes} min</span><BookingActions booking={booking} currentUserId={currentUserId} canApprove={canApprove} onEdit={onEdit} onAction={onAction} /></>}
    </div>
  );

  if (view === "List") {
    return <div className="tableWrap bookingList"><table><thead><tr><th>Date &amp; Time</th><th>Room</th><th>Booking</th><th>Organizer</th><th>Status</th><th>Action</th></tr></thead><tbody>{bookings.length ? bookings.map((booking) => <tr key={booking.id}><td><b>{booking.localDate}</b><small>{booking.startTime}–{booking.endTime}</small></td><td>{booking.station}<small>{booking.roomName}</small></td><td><b>{booking.title}</b><small>{booking.purpose || "—"}</small></td><td>{booking.organizer}<small>{booking.attendees} attendees</small></td><td><span className={`bookingStatus status-${booking.status.toLowerCase().replaceAll(" ", "-")}`}>{booking.status}</span></td><td><BookingActions booking={booking} currentUserId={currentUserId} canApprove={canApprove} onEdit={onEdit} onAction={onAction} /></td></tr>) : <tr><td colSpan={6}>No booking found.</td></tr>}</tbody></table></div>;
  }

  if (view === "Day") {
    const rows = byDate(anchor);
    return <div className="bookingDay"><div className="bookingDateHeading"><strong>{new Date(`${anchor}T00:00:00`).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</strong><span>{rows.length} booking</span></div>{rows.length ? rows.map((booking) => card(booking)) : <EmptyState text="Belum ada booking pada tanggal ini." />}</div>;
  }

  if (view === "Week") {
    const first = startOfWeek(anchor);
    const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(first); date.setDate(first.getDate() + index); return date; });
    return <div className="bookingWeek">{days.map((day) => { const value = dateValue(day); const rows = byDate(value); return <section key={value} className={value === localToday() ? "today" : ""}><header><b>{day.toLocaleDateString("id-ID", { weekday: "short" })}</b><span>{day.getDate()}</span></header><div>{rows.length ? rows.map((booking) => card(booking, true)) : <small>—</small>}</div></section>; })}</div>;
  }

  const selected = new Date(`${anchor}T00:00:00`);
  const firstMonthDay = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const gridStart = startOfWeek(dateValue(firstMonthDay));
  const days = Array.from({ length: 42 }, (_, index) => { const date = new Date(gridStart); date.setDate(gridStart.getDate() + index); return date; });
  return <div className="bookingMonth"><div className="bookingWeekdays">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <b key={day}>{day}</b>)}</div><div className="bookingMonthGrid">{days.map((day) => { const value = dateValue(day); const rows = byDate(value); return <section key={value} className={`${day.getMonth() !== selected.getMonth() ? "outside" : ""} ${value === localToday() ? "today" : ""}`}><header>{day.getDate()}</header><div>{rows.slice(0, 3).map((booking) => card(booking, true))}{rows.length > 3 && <small>+{rows.length - 3} more</small>}</div></section>; })}</div></div>;
}

function BookingActions({
  booking,
  currentUserId,
  canApprove,
  onEdit,
  onAction,
}: {
  booking: RoomBooking;
  currentUserId: string;
  canApprove: boolean;
  onEdit: (booking: RoomBooking) => void;
  onAction: (booking: RoomBooking, action: "submit" | "approve" | "reject" | "cancel") => void;
}) {
  const owner = booking.createdBy === currentUserId;
  return <div className="bookingActions">
    {booking.status === "Draft" && owner && <><button type="button" onClick={() => onEdit(booking)}>Edit</button><button type="button" onClick={() => onAction(booking, "submit")}>Submit</button></>}
    {booking.status === "Requested" && canApprove && <><button type="button" onClick={() => onAction(booking, "approve")}>Approve</button><button type="button" onClick={() => onAction(booking, "reject")}>Reject</button></>}
    {["Draft", "Requested", "Approved"].includes(booking.status) && (owner || canApprove) && <button type="button" onClick={() => onAction(booking, "cancel")}>Cancel</button>}
  </div>;
}
