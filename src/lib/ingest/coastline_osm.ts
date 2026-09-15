// ── Coleta da linha de costa (OpenStreetMap) ──────────────────────────
// Uma única consulta ao Overpass traz o traçado real do mar (natural=coastline)
// dentro da bbox da cidade. Devolve polilinhas [[lat,lng],...] para o fator
// "praia" do ranking — sem precisar desenhar a costa à mão por cidade.

import { overpassFetch } from "./pois";

export async function collectCoastlineOsm(b: {
  minLat: number; minLng: number; maxLat: number; maxLng: number;
}): Promise<{ ways: [number, number][][]; points: number }> {
  const bbox = `${b.minLat},${b.minLng},${b.maxLat},${b.maxLng}`;
  const query = `[out:json][timeout:25];(way["natural"="coastline"](${bbox}););out geom;`;
  const data = await overpassFetch(query);

  const ways: [number, number][][] = [];
  let points = 0;
  for (const el of data.elements ?? []) {
    if (el.type !== "way" || !el.geometry?.length) continue;
    const line = el.geometry.map((g) => [g.lat, g.lon] as [number, number]);
    if (line.length >= 2) { ways.push(line); points += line.length; }
  }
  return { ways, points };
}
