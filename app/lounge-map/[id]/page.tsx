"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

const PASSENGER_ACCESS_CATEGORIES = [
  "All Guests",
  "Business Class",
  "First Class",
  "GarudaMiles Platinum",
  "SkyTeam Elite Plus",
  "VIP / CIP",
] as const;

type PublicArea = {
  id: string;
  name: string;
  category: string;
  description: string;
  services: string[];
  x: number;
  y: number;
  status: "Available" | "In Use" | "Temporarily Closed";
  photoUrls: string[];
  accessCategories: string[];
};
type PublicLayout = {
  id: string;
  station: string;
  loungeName: string;
  title: string;
  floorName: string;
  layoutUrl: string;
  areas: PublicArea[];
};

export default function PassengerLoungeMap() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const [layout, setLayout] = useState<PublicLayout | null>(null);
  const [selectedId, setSelectedId] = useState(search.get("area") || "");
  const currentAreaId = search.get("from") || "";
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All Services");
  const requestedAccess = search.get("access") || "";
  const [accessProfile, setAccessProfile] = useState(
    PASSENGER_ACCESS_CATEGORIES.some((item) => item === requestedAccess)
      ? requestedAccess
      : "All Guests",
  );
  const [language, setLanguage] = useState<"ID" | "EN">("ID");
  const [error, setError] = useState("");
  const [photoIndex, setPhotoIndex] = useState(0);
  const [fullScreenPhoto, setFullScreenPhoto] = useState("");
  const [shareFeedback, setShareFeedback] = useState("");
  const sheetTouchStartY = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/.netlify/functions/public-lounge-layout?id=${encodeURIComponent(params.id)}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Layout tidak tersedia.");
        if (active) setLayout(payload as PublicLayout);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "Layout tidak tersedia."));
    return () => { active = false; };
  }, [params.id]);

  useEffect(() => {
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (fullScreenPhoto) setFullScreenPhoto("");
      else setSelectedId("");
    };
    window.addEventListener("keydown", closeWithEscape);
    return () => window.removeEventListener("keydown", closeWithEscape);
  }, [fullScreenPhoto]);

  const categories = useMemo(
    () => ["All Services", ...new Set((layout?.areas || []).map((area) => area.category))],
    [layout],
  );
  const accessProfiles = useMemo(
    () => [
      ...PASSENGER_ACCESS_CATEGORIES,
      ...new Set(
        (layout?.areas || [])
          .flatMap((area) => area.accessCategories || [])
          .filter(
            (access) =>
              access &&
              !PASSENGER_ACCESS_CATEGORIES.some((item) => item === access),
          ),
      ),
    ],
    [layout],
  );
  const visibleAreas = (layout?.areas || []).filter(
    (area) =>
      (area.id === currentAreaId ||
        (area.accessCategories?.length
          ? area.accessCategories
          : ["All Guests"]
        ).some(
          (access) =>
            access === "All Guests" || access === accessProfile,
        )) &&
      (category === "All Services" || area.category === category) &&
      `${area.name} ${area.category} ${area.services.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const selected = visibleAreas.find((area) => area.id === selectedId) || null;
  const activePhotoIndex = selected?.photoUrls.length
    ? Math.min(photoIndex, selected.photoUrls.length - 1)
    : 0;
  const currentArea = layout?.areas.find((area) => area.id === currentAreaId) || null;
  const t = (id: string, en: string) => language === "ID" ? id : en;
  const selectArea = (id: string) => {
    setPhotoIndex(0);
    setSelectedId(id);
  };
  const shareMap = async () => {
    const url = new URL(window.location.href);
    if (accessProfile === "All Guests") url.searchParams.delete("access");
    else url.searchParams.set("access", accessProfile);
    try {
      if (navigator.share)
        await navigator.share({ title: layout?.loungeName || "Lounge Map", url: url.toString() });
      else await navigator.clipboard.writeText(url.toString());
      setShareFeedback(t("Tautan siap dibagikan", "Link ready to share"));
      window.setTimeout(() => setShareFeedback(""), 2500);
    } catch (reason) {
      if ((reason as { name?: string })?.name !== "AbortError")
        setShareFeedback(t("Tautan tidak dapat dibagikan", "Unable to share link"));
    }
  };

  if (error)
    return <main className="publicLoungeMap publicMapState"><img src="/garuda-indonesia-logo.png" alt="Garuda Indonesia" /><h1>{t("Denah belum tersedia", "Layout unavailable")}</h1><p>{error}</p></main>;
  if (!layout)
    return <main className="publicLoungeMap publicMapState"><img src="/garuda-indonesia-logo.png" alt="Garuda Indonesia" /><p>{t("Memuat denah lounge…", "Loading lounge map…")}</p></main>;

  return (
    <main className="publicLoungeMap">
      <header>
        <img src="/garuda-indonesia-logo.png" alt="Garuda Indonesia" />
        <div><small>{layout.station} · {layout.floorName}</small><h1>{layout.loungeName}</h1><p>{t("Temukan layanan dan area lounge", "Find lounge services and areas")}</p></div>
        <div className="publicMapHeaderActions">
          <button type="button" onClick={() => void shareMap()}>{t("Bagikan", "Share")}</button>
          <button type="button" onClick={() => setLanguage(language === "ID" ? "EN" : "ID")}>{language === "ID" ? "EN" : "ID"}</button>
          {shareFeedback && <small role="status">{shareFeedback}</small>}
        </div>
      </header>
      <section className="publicMapFilters">
        <label><span>{t("Cari fasilitas", "Search facilities")}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Contoh: shower, buffet, charging", "Example: shower, buffet, charging")} /></label>
        <label><span>{t("Kategori", "Category")}</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>{t("Akses Anda", "Your Access")}</span><select value={accessProfile} onChange={(event) => { setAccessProfile(event.target.value); setSelectedId(""); }}>{accessProfiles.map((item) => <option key={item}>{item}</option>)}</select></label>
        <p className="publicMapHint">{t("Pilih marker atau fasilitas untuk melihat detail area, layanan, foto, dan petunjuk lokasinya.", "Select a marker or facility to view area details, services, photos, and location guidance.")}</p>
      </section>
      {currentArea && (
        <div className="publicCurrentLocation">
          <span aria-hidden="true">◉</span>
          <div><small>{t("ANDA BERADA DI", "YOU ARE HERE")}</small><b>{currentArea.name}</b></div>
        </div>
      )}
      <div className="publicMapGrid">
        <section className="publicMapCanvas">
          <img src={layout.layoutUrl} alt={`${layout.title}, ${layout.floorName}`} />
          {currentArea && selected && currentArea.id !== selected.id && (
            <svg className="publicWayfindingLine" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <line x1={currentArea.x} y1={currentArea.y} x2={selected.x} y2={selected.y} />
            </svg>
          )}
          {visibleAreas.map((area, index) => (
            <button key={area.id} type="button" className={`${selectedId === area.id ? "selected" : ""} ${currentAreaId === area.id ? "current" : ""} status-${area.status.toLowerCase().replaceAll(" ", "-")}`} style={{ left: `${area.x}%`, top: `${area.y}%` }} onClick={() => selectArea(area.id)} aria-label={`${area.name}, ${area.status}`}><span>{currentAreaId === area.id ? "◉" : index + 1}</span><b>{currentAreaId === area.id ? t("Anda di sini", "You are here") : area.name}</b></button>
          ))}
        </section>
        <aside className={`publicAreaPanel ${selected ? "detailOpen" : ""}`}>
          {selected ? (
            <section className="publicAreaDetailPanel" role="dialog" aria-modal="false" aria-label={`${selected.name} detail`}>
              <button
                className="publicSheetHandle"
                type="button"
                onClick={() => setSelectedId("")}
                onTouchStart={(event) => { sheetTouchStartY.current = event.changedTouches[0]?.clientY ?? null; }}
                onTouchEnd={(event) => {
                  const start = sheetTouchStartY.current;
                  const end = event.changedTouches[0]?.clientY;
                  sheetTouchStartY.current = null;
                  if (start !== null && end !== undefined && end - start > 60) setSelectedId("");
                }}
                aria-label={t("Tarik ke bawah atau tekan untuk menutup", "Swipe down or press to close")}
              />
              <button className="publicAreaClose" type="button" onClick={() => setSelectedId("")} aria-label={t("Tutup", "Close")}>×</button>
              {selected.photoUrls.length ? (
                <div className="publicPhotoCarousel">
                  <button type="button" className="publicPhotoPrevious" onClick={() => setPhotoIndex((current) => (current - 1 + selected.photoUrls.length) % selected.photoUrls.length)} aria-label={t("Foto sebelumnya", "Previous photo")}>‹</button>
                  <button type="button" className="publicPhotoExpand" onClick={() => setFullScreenPhoto(selected.photoUrls[activePhotoIndex])} aria-label={t("Buka foto penuh", "Open full photo")}>
                    <img src={selected.photoUrls[activePhotoIndex]} alt={`${selected.name} lounge ${activePhotoIndex + 1}`} />
                  </button>
                  <button type="button" className="publicPhotoNext" onClick={() => setPhotoIndex((current) => (current + 1) % selected.photoUrls.length)} aria-label={t("Foto berikutnya", "Next photo")}>›</button>
                  <span>{activePhotoIndex + 1} / {selected.photoUrls.length}</span>
                </div>
              ) : (
                <div className="publicPhotoPlaceholder">{t("Foto area belum tersedia.", "Area photos are not available yet.")}</div>
              )}
              <div className="publicAreaDetailContent">
                <small>{selected.category}</small>
                <h2>{selected.name}</h2>
                <span className={`publicAreaStatus status-${selected.status.toLowerCase().replaceAll(" ", "-")}`}>{selected.status}</span>
                <p>{selected.description || t("Informasi area belum tersedia.", "Area information is not available yet.")}</p>
                <div className="publicServiceTags">{selected.services.map((service) => <span key={service}>{service}</span>)}</div>
                <div className="publicAccessInformation">
                  <small>{t("AKSES PENUMPANG", "PASSENGER ACCESS")}</small>
                  <div className="publicServiceTags">
                    {(selected.accessCategories?.length ? selected.accessCategories : ["All Guests"]).map((access) => <span key={access}>{access}</span>)}
                  </div>
                </div>
                <button className="publicLocateArea" type="button" onClick={() => document.querySelector(".publicMapCanvas")?.scrollIntoView({ behavior: "smooth", block: "center" })}>{t("Tampilkan pada Denah", "Show on Map")}</button>
              </div>
            </section>
          ) : (
            <div className="publicAreaList">
              <h2>{t("Layanan Lounge", "Lounge Services")}</h2>
              {visibleAreas.map((area, index) => <button key={area.id} type="button" onClick={() => selectArea(area.id)}><span>{index + 1}</span><div><b>{area.name}</b><small>{area.category} · {area.status}</small></div></button>)}
              {!visibleAreas.length && <p>{t("Fasilitas tidak ditemukan.", "No facilities found.")}</p>}
            </div>
          )}
        </aside>
      </div>
      {fullScreenPhoto && <div className="publicPhotoLightbox" role="dialog" aria-modal="true" aria-label={t("Foto area", "Area photo")} onMouseDown={(event) => event.target === event.currentTarget && setFullScreenPhoto("")}><button type="button" onClick={() => setFullScreenPhoto("")} aria-label={t("Tutup foto", "Close photo")}>×</button><img src={fullScreenPhoto} alt={`${selected?.name || "Lounge"} full screen`} /></div>}
      <footer>{t("Informasi dapat berubah mengikuti kondisi operasional lounge.", "Information may change based on lounge operating conditions.")}</footer>
    </main>
  );
}
