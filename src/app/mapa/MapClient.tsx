"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export interface MapListing {
  id: string;
  title: string | null;
  type: string | null;
  price: number | null;
  area_total_m2: number | null;
  neighborhood: string | null;
  lat: number;
  lng: number;
  geo_method: string | null;
  source_url: string;
}

function shortPrice(v: number | null): string {
  if (!v) return "?";
  if (v >= 1_000_000) return "R$" + (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1000) return "R$" + Math.round(v / 1000) + "k";
  return "R$" + v;
}
function fmtPrice(v: number | null): string {
  return v ? "R$ " + v.toLocaleString("pt-BR") : "Consulte";
}

export default function MapClient({ listings }: { listings: MapListing[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !ref.current || ref.current.dataset.init) return;
      ref.current.dataset.init = "1";

      map = L.map(ref.current, { zoomControl: true }).setView(
        [-26.11, -48.61],
        12,
      );
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);

      const pts: [number, number][] = [];
      listings.forEach((d) => {
        const approx = d.geo_method === "bairro" || d.geo_method === "fallback";
        const icon = L.divIcon({
          className: "",
          html: `<div style="background:#14776b;color:#fff;padding:2px 7px;border-radius:6px;font:600 11px system-ui;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.4);${approx ? "opacity:.7;border:1px dashed #fff;" : ""}">${shortPrice(d.price)}</div>`,
          iconSize: [60, 20],
          iconAnchor: [30, 10],
        });
        const popup = `
          <div style="font:13px system-ui;min-width:180px;">
            <div style="font-weight:700;margin-bottom:2px;">${d.title ?? d.type ?? "Imóvel"}</div>
            <div style="font-size:15px;font-weight:700;color:#14776b;">${fmtPrice(d.price)}</div>
            <div style="color:#555;">
              ${d.area_total_m2 ? d.area_total_m2.toLocaleString("pt-BR") + " m²<br>" : ""}
              ${d.neighborhood ? d.neighborhood + "<br>" : ""}
            </div>
            ${approx ? '<div style="color:#b5651d;font-size:11px;">📍 Localização aproximada</div>' : ""}
            <a href="${d.source_url}" target="_blank" rel="noreferrer" style="color:#14776b;">Ver anúncio →</a>
          </div>`;
        L.marker([d.lat, d.lng], { icon })
          .addTo(map!)
          .bindPopup(popup, { maxWidth: 260 });
        pts.push([d.lat, d.lng]);
      });

      if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
    })();

    return () => {
      cancelled = true;
      if (map) map.remove();
      if (ref.current) delete ref.current.dataset.init;
    };
  }, [listings]);

  return <div ref={ref} style={{ position: "absolute", inset: 0 }} />;
}
