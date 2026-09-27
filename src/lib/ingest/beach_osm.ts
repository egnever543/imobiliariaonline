// ── Coleta das praias de areia (OpenStreetMap) ────────────────────────
// Uma consulta ao Overpass traz os polígonos de praia (natural=beach) dentro
// da bbox da cidade. Diferente da linha de costa (natural=coastline), a praia
// NÃO inclui baía/estuário/canal — então medir "distância do mar" até a praia
// evita o viés de cidades com baía (ex.: Babitonga/Itapoá), onde a costa mais
// próxima costuma ser um canal, não o mar aberto que o comprador entende.
// Devolve polígonos [[lat,lng],...] para o fator "praia" do ranking.

import { overpassFetch } from "./pois";

export async function collectBeachesOsm(b: {
  minLat: number; minLng: number; maxLat: number; maxLng: number;
}): Promise<{ ways: [number, number][][]; points: number }> {
  const bbox = `${b.minLat},${b.minLng},${b.maxLat},${b.maxLng}`;
  // way + relation (praias grandes às vezes são multipolígono); out geom traz
  // a geometria dos membros diretamente.
  const query =
    `[out:json][timeout:25];(way["natural"="beach"](${bbox});relation["natural"="beach"](${bbox}););out geom;`;
  const data = await overpassFetch(query);

  const ways: [number, number][][] = [];
  let points = 0;
  const push = (line: [number, number][]) => {
    if (line.length >= 2) { ways.push(line); points += line.length; }
  };
  for (const el of data.elements ?? []) {
    if (el.type === "way" && el.geometry?.length) {
      push(el.geometry.map((g) => [g.lat, g.lon] as [number, number]));
    } else if (el.type === "relation") {
      // relation traz "members" com geometria própria quando usa out geom
      const members = (el as { members?: { geometry?: { lat: number; lon: number }[] }[] }).members ?? [];
      for (const mem of members) {
        if (mem.geometry?.length) push(mem.geometry.map((g) => [g.lat, g.lon] as [number, number]));
      }
    }
  }
  return { ways, points };
}
