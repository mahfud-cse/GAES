"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

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
  const [language, setLanguage] = useState<"ID" | "EN">("ID");
  const [error, setError] = useState("");

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

  const categories = useMemo(
    () => ["All Services", ...new Set((layout?.areas || []).map((area) => area.category))],
    [layout],
  );
  const visibleAreas = (layout?.areas || []).filter(
    (area) =>
      (category === "All Services" || area.category === category) &&
      `${area.name} ${area.category} ${area.services.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const selected = layout?.areas.find((area) => area.id === selectedId) || null;
  const currentArea = layout?.areas.find((area) => area.id === currentAreaId) || null;
  const t = (id: string, en: string) => language === "ID" ? id : en;

  if (error)
    return <main className="publicLoungeMap publicMapState"><img src="/garuda-indonesia-logo.png" alt="Garuda Indonesia" /><h1>{t("Denah belum tersedia", "Layout unavailable")}</h1><p>{error}</p></main>;
  if (!layout)
    return <main className="publicLoungeMap publicMapState"><img src="/garuda-indonesia-logo.png" alt="Garuda Indonesia" /><p>{t("Memuat denah lounge…", "Loading lounge map…")}</p></main>;

  return (
    <main className="publicLoungeMap">
      <header>
        <img src="/garuda-indonesia-logo.png" alt="Garuda Indonesia" />
        <div><small>{layout.station} · {layout.floorName}</small><h1>{layout.loungeName}</h1><p>{t("Temukan layanan dan area lounge", "Find lounge services and areas")}</p></div>
        <button type="button" onClick={() => setLanguage(language === "ID" ? "EN" : "ID")}>{language === "ID" ? "EN" : "ID"}</button>
      </header>
      <section className="publicMapFilters">
        <label><span>{t("Cari fasilitas", "Search facilities")}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Contoh: shower, buffet, charging", "Example: shower, buffet, charging")} /></label>
        <label><span>{t("Kategori", "Category")}</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
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
            <button key={area.id} type="button" className={`${selectedId === area.id ? "selected" : ""} ${currentAreaId === area.id ? "current" : ""} status-${area.status.toLowerCase().replaceAll(" ", "-")}`} style={{ left: `${area.x}%`, top: `${area.y}%` }} onClick={() => setSelectedId(area.id)} aria-label={`${area.name}, ${area.status}`}><span>{currentAreaId === area.id ? "◉" : index + 1}</span><b>{currentAreaId === area.id ? t("Anda di sini", "You are here") : area.name}</b></button>
          ))}
        </section>
        <aside className="publicAreaList">
          <h2>{t("Layanan Lounge", "Lounge Services")}</h2>
          {visibleAreas.map((area, index) => <button key={area.id} type="button" className={selectedId === area.id ? "selected" : ""} onClick={() => setSelectedId(area.id)}><span>{index + 1}</span><div><b>{area.name}</b><small>{area.category} · {area.status}</small></div></button>)}
        </aside>
      </div>
      {selected && (
        <div className="publicAreaSheet" role="dialog" aria-modal="true">
          <button className="publicAreaClose" type="button" onClick={() => setSelectedId("")} aria-label={t("Tutup", "Close")}>×</button>
          <div><small>{selected.category}</small><h2>{selected.name}</h2><span className={`publicAreaStatus status-${selected.status.toLowerCase().replaceAll(" ", "-")}`}>{selected.status}</span><p>{selected.description || t("Informasi area belum tersedia.", "Area information is not available yet.")}</p><div className="publicServiceTags">{selected.services.map((service) => <span key={service}>{service}</span>)}</div></div>
          <div className="publicPhotoGallery">{selected.photoUrls.map((url) => <img key={url} src={url} alt={`${selected.name} lounge`} />)}{!selected.photoUrls.length && <p>{t("Foto area belum tersedia.", "Area photos are not available yet.")}</p>}</div>
        </div>
      )}
      <footer>{t("Informasi dapat berubah mengikuti kondisi operasional lounge.", "Information may change based on lounge operating conditions.")}</footer>
    </main>
  );
}
