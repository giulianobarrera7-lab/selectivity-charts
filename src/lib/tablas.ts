/**
 * Tablas de referencia (AEA 90364 / Reglamento para la Ejecución de
 * Instalaciones Eléctricas en Inmuebles).
 *
 * - Tabla 5.I  : Iz para cables IRAM 2183 (sin envoltura de protección),
 *                3 conductores en cañería, aire 40 °C, 70 °C en el conductor.
 * - Tabla 5.II : factor de corrección por temperatura ambiente.
 * - Tabla 5.III: Iz para cables IRAM 2220 / 2261 / 2262 (con envoltura),
 *                al aire sobre bandeja perforada (40 °C) y directamente
 *                enterrados (terreno 25 °C, 70 cm, 100 °C·cm/W).
 */

export type Polaridad = "unipolar" | "bipolar" | "tripolar";
export type Montaje = "caneria" | "aire" | "subterraneo";

/** Tabla 5.I — cables IRAM 2183 en cañería (3 conductores activos). */
export const TABLA_5I: { s: number; iz: number }[] = [
  { s: 1, iz: 9.6 },
  { s: 1.5, iz: 13 },
  { s: 2.5, iz: 18 },
  { s: 4, iz: 24 },
  { s: 6, iz: 31 },
  { s: 10, iz: 43 },
  { s: 16, iz: 59 },
  { s: 25, iz: 77 },
  { s: 35, iz: 96 },
  { s: 50, iz: 116 },
  { s: 70, iz: 148 },
  { s: 95, iz: 180 },
  { s: 120, iz: 207 },
  { s: 150, iz: 228 },
  { s: 185, iz: 260 },
  { s: 240, iz: 290 },
  { s: 300, iz: 340 },
  { s: 400, iz: 385 },
];

/** Tabla 5.II — factor de corrección por temperatura ambiente. */
export const TABLA_5II: { temp: number; k: number }[] = [
  { temp: 25, k: 1.33 },
  { temp: 30, k: 1.22 },
  { temp: 35, k: 1.13 },
  { temp: 40, k: 1.0 },
  { temp: 45, k: 0.86 },
  { temp: 50, k: 0.72 },
  { temp: 55, k: 0.5 },
];

/**
 * Tabla 5.III — [sección, aire: uni, bip, trip/tetra, enterrado: uni, bip, trip/tetra]
 * null = valor no tabulado.
 */
export const TABLA_5III: {
  s: number;
  aire: [number, number | null, number | null];
  ent: [number, number | null, number | null];
}[] = [
  { s: 1.5, aire: [25, 22, 17], ent: [32, 32, 27] },
  { s: 2.5, aire: [35, 32, 24], ent: [45, 45, 38] },
  { s: 4, aire: [47, 40, 32], ent: [58, 58, 48] },
  { s: 6, aire: [61, 52, 43], ent: [73, 73, 62] },
  { s: 10, aire: [79, 65, 56], ent: [93, 93, 79] },
  { s: 16, aire: [112, 85, 74], ent: [124, 124, 103] },
  { s: 25, aire: [139, 109, 97], ent: [158, 158, 132] },
  { s: 35, aire: [171, 134, 117], ent: [189, null, 158] },
  { s: 50, aire: [208, 166, 147], ent: [230, null, 193] },
  { s: 70, aire: [252, 204, 185], ent: [276, null, 235] },
  { s: 95, aire: [308, 248, 223], ent: [329, null, 279] },
  { s: 120, aire: [357, 289, 259], ent: [373, null, 316] },
  { s: 150, aire: [410, 330, 294], ent: [421, null, 355] },
  { s: 185, aire: [466, 376, 335], ent: [474, null, 396] },
  { s: 240, aire: [551, 434, 391], ent: [546, null, 451] },
  { s: 300, aire: [627, 489, 445], ent: [612, null, 504] },
  { s: 400, aire: [747, 572, 545], ent: [710, null, 608] },
  { s: 500, aire: [832, null, null], ent: [803, null, null] },
  { s: 630, aire: [944, null, null], ent: [906, null, null] },
];

export const SECCIONES = [
  1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630,
];

const POL_IDX: Record<Polaridad, 0 | 1 | 2> = { unipolar: 0, bipolar: 1, tripolar: 2 };

/** Iz de tabla para una sección, montaje y polaridad. null si no está tabulado. */
export function izTabla(section: number, montaje: Montaje, pol: Polaridad): number | null {
  if (montaje === "caneria") {
    return TABLA_5I.find((r) => r.s === section)?.iz ?? null;
  }
  const row = TABLA_5III.find((r) => r.s === section);
  if (!row) return null;
  const arr = montaje === "aire" ? row.aire : row.ent;
  return arr[POL_IDX[pol]] ?? null;
}

/** Factor de temperatura interpolado a escalón de tabla (aplica a Tabla 5.I). */
export function factorTemp(temp: number): number {
  const exact = TABLA_5II.find((r) => r.temp === temp);
  if (exact) return exact.k;
  const sorted = [...TABLA_5II].sort((a, b) => a.temp - b.temp);
  if (temp <= sorted[0]!.temp) return sorted[0]!.k;
  const last = sorted[sorted.length - 1]!;
  if (temp >= last.temp) return last.k;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (temp > a.temp && temp < b.temp) {
      const f = (temp - a.temp) / (b.temp - a.temp);
      return +(a.k + (b.k - a.k) * f).toFixed(3);
    }
  }
  return 1;
}

/**
 * Icu — capacidad de ruptura última normalizada (IEC 60898-1 / 60947-2).
 * Valores usuales y aplicación típica según nivel de cortocircuito del punto.
 */
export const ICU_VALORES: { kA: number; uso: string }[] = [
  { kA: 3, uso: "Circuitos terminales domiciliarios, muy lejos del transformador" },
  { kA: 4.5, uso: "Tableros seccionales pequeños, viviendas" },
  { kA: 6, uso: "Uso general domiciliario / pequeño comercio (IEC 60898)" },
  { kA: 10, uso: "Tableros seccionales de comercio e industria liviana" },
  { kA: 15, uso: "Tableros seccionales cercanos al principal" },
  { kA: 20, uso: "Tablero principal de baja potencia instalada" },
  { kA: 25, uso: "Tablero general con transformador propio hasta ~630 kVA" },
  { kA: 36, uso: "Tablero general industrial, transformadores 630–1000 kVA" },
  { kA: 50, uso: "Entrada de gran industria, transformadores ≥ 1000 kVA" },
  { kA: 65, uso: "Barras principales de alta potencia de cortocircuito" },
  { kA: 100, uso: "Acometidas especiales / cabeceras con Icc muy elevada" },
];

/** Icc trifásica estimada en bornes de un transformador (kA). */
export function iccTrafo(kVA: number, uSec = 400, ucc = 0.04): number {
  const inom = (kVA * 1000) / (Math.sqrt(3) * uSec);
  return +(inom / ucc / 1000).toFixed(1);
}
