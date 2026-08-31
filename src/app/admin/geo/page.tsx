"use client";

// ── Correção de localização ───────────────────────────────────────────
// Lista imóveis sem coordenadas. Para cada um: edite o endereço e
// re-geocodifique, ou clique no mapa para fixar o ponto manualmente.

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

interface City {
  name: string | null;
  state: string | null;
}
interface Pending {
  id: string;
  title: string | null;
  type: string | null;
  price: number | null;
  neighborhood: string | null;
  street: string | null;
  street_number: string | null;
  cep: string | null;
  source_url: string;
  cities: City | City[] | null;
}
interface Edit {
  street: string;
  street_number: string;
  neighborhood: string;
  cep: string;
  lat?: number;
  lng?: number;
}

const input: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--ink)",
  fontSize: 13,
};
const btn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 7,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

function cityOf(l: Pending): City {
  const c = Array.isArray(l.cities) ? l.cities[0] : l.cities;
  return c ?? { name: null, state: null };
}

export default function GeoEditor() {
  const [token, setToken] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  useEffect(() => {
    setToken(localStorage.getItem("admin_token") ?? "");
  }, []);

  // inicializa o mapa
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled) return;
      LRef.current = L;
      const el = document.getElementById("geo-map");
      if (!el || (el as HTMLElement).dataset.init) return;
      (el as HTMLElement).dataset.init = "1";
      const map = L.map(el, { zoomControl: true }).setView([-26.11, -48.61], 12);
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { attribution: "&copy; OSM &copy; CARTO", maxZoom: 19 },
      ).addTo(map);
      map.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        const id = selectedRef.current;
        if (!id) {
          setMsg("Selecione um imóvel na lista antes de marcar no mapa.");
          return;
        }
        placeMarker(e.latlng.lat, e.latlng.lng);
        setEdits((prev) => ({
          ...prev,
          [id]: { ...emptyEdit(), ...prev[id], lat: e.latlng.lat, lng: e.latlng.lng },
        }));
      });
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = null;
    };
  }, []);

  function emptyEdit(): Edit {
    return { street: "", street_number: "", neighborhood: "", cep: "" };
  }

  function placeMarker(lat: number, lng: number) {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      const m = L.marker([lat, lng], { draggable: true }).addTo(map);
      m.on("dragend", () => {
        const id = selectedRef.current;
        const p = m.getLatLng();
        if (id)
          setEdits((prev) => ({
            ...prev,
            [id]: { ...emptyEdit(), ...prev[id], lat: p.lat, lng: p.lng },
          }));
      });
      markerRef.current = m;
    }
    map.panTo([lat, lng]);
  }

  function clearMarker() {
    if (markerRef.current && mapRef.current) {
      mapRef.current.removeLayer(markerRef.current);
      markerRef.current = null;
    }
  }

  function headers() {
    return { "content-type": "application/json", "x-admin-token": token };
  }

  async function load() {
    setMsg("");
    setBusy(true);
    try {
      const res = await fetch("/api/listings/pending", { headers: headers() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPending(data.listings);
      const e: Record<string, Edit> = {};
      (data.listings as Pending[]).forEach((l) => {
        e[l.id] = {
          street: l.street ?? "",
          street_number: l.street_number ?? "",
          neighborhood: l.neighborhood ?? "",
          cep: l.cep ?? "",
        };
      });
      setEdits(e);
      setMsg(`${data.listings.length} imóveis sem localização.`);
    } catch (err) {
      setMsg("Erro: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function select(l: Pending) {
    setSelected(l.id);
    clearMarker();
    const e = edits[l.id];
    if (e?.lat != null && e?.lng != null) placeMarker(e.lat, e.lng);
  }

  async function save(l: Pending, useMarker: boolean) {
    const e = edits[l.id] ?? emptyEdit();
    const city = cityOf(l);
    setBusy(true);
    setMsg("");
    try {
      const body: Record<string, unknown> = {
        id: l.id,
        street: e.street,
        street_number: e.street_number,
        neighborhood: e.neighborhood,
        cep: e.cep,
        cityName: city.name,
        uf: city.state,
      };
      if (useMarker) {
        if (e.lat == null || e.lng == null) {
          setMsg("Clique no mapa para marcar o ponto primeiro.");
          setBusy(false);
          return;
        }
        body.lat = e.lat;
        body.lng = e.lng;
      }
      const res = await fetch("/api/listings/geo", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setPending((p) => p.filter((x) => x.id !== l.id));
        setSelected(null);
        clearMarker();
        setMsg("✅ Localização salva.");
      } else {
        setMsg("⚠️ " + (data.error ?? "Não deu certo."));
      }
    } catch (err) {
      setMsg("Erro: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function setField(id: string, field: keyof Edit, value: string) {
    setEdits((prev) => ({
      ...prev,
      [id]: { ...emptyEdit(), ...prev[id], [field]: value },
    }));
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* Lista */}
      <div
        style={{
          width: 380,
          minWidth: 320,
          borderRight: "1px solid var(--border)",
          overflow: "auto",
          padding: 16,
        }}
      >
        <a href="/admin" style={{ fontSize: 13 }}>
          ← painel
        </a>
        <h1 style={{ fontSize: 20, margin: "6px 0 2px" }}>Corrigir localização</h1>
        <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 0 }}>
          Ajuste o endereço e re-geocodifique, ou clique no mapa para fixar o ponto.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input
            style={input}
            type="password"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              localStorage.setItem("admin_token", e.target.value);
            }}
            placeholder="senha do painel"
          />
          <button style={btn} onClick={load} disabled={busy}>
            {busy ? "…" : "Carregar"}
          </button>
        </div>

        {msg && (
          <p style={{ fontSize: 12.5, color: "var(--muted)" }}>{msg}</p>
        )}

        {pending.map((l) => {
          const e = edits[l.id] ?? emptyEdit();
          const isSel = selected === l.id;
          return (
            <div
              key={l.id}
              onClick={() => select(l)}
              style={{
                border: `1px solid ${isSel ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 10,
                padding: 12,
                marginBottom: 10,
                cursor: "pointer",
                background: isSel ? "var(--paper)" : "transparent",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {l.title ?? l.type ?? "Imóvel"}{" "}
                {l.price ? "· R$ " + l.price.toLocaleString("pt-BR") : ""}
              </div>
              {isSel ? (
                <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      style={input}
                      placeholder="Rua"
                      value={e.street}
                      onChange={(ev) => setField(l.id, "street", ev.target.value)}
                    />
                    <input
                      style={{ ...input, width: 80 }}
                      placeholder="Nº"
                      value={e.street_number}
                      onChange={(ev) =>
                        setField(l.id, "street_number", ev.target.value)
                      }
                    />
                  </div>
                  <input
                    style={input}
                    placeholder="Bairro"
                    value={e.neighborhood}
                    onChange={(ev) =>
                      setField(l.id, "neighborhood", ev.target.value)
                    }
                  />
                  {e.lat != null && (
                    <div style={{ fontSize: 11, color: "var(--accent)" }}>
                      ponto marcado: {e.lat.toFixed(5)}, {e.lng!.toFixed(5)}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      style={btn}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        save(l, false);
                      }}
                      disabled={busy}
                    >
                      Geocodificar endereço
                    </button>
                    <button
                      style={{
                        ...btn,
                        background: "transparent",
                        border: "1px solid var(--accent)",
                        color: "var(--accent)",
                      }}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        save(l, true);
                      }}
                      disabled={busy}
                    >
                      Salvar ponto do mapa
                    </button>
                  </div>
                  <a
                    href={l.source_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12 }}
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    ver anúncio →
                  </a>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {e.neighborhood || "sem bairro"} · clique para corrigir
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Mapa */}
      <div id="geo-map" style={{ flex: 1 }} />
    </div>
  );
}
