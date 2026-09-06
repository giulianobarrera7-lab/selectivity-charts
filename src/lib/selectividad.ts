/**
 * Motor de verificación de SELECTIVIDAD entre protecciones eléctricas.
 *
 * Alcance: dado un árbol de protecciones (cada una con su protección
 * "aguas arriba" declarada), determinar si la cadena cumple con el
 * criterio de coordinación exigido de forma general por la reglamentación
 * (AEA 90364, y las normas IEC de base para cada familia de dispositivo:
 * IEC 60898-1 para termomagnéticos domésticos, IEC 60947-2 / 60947-4-1
 * para interruptores industriales y guardamotores, IEC 60269 para
 * fusibles, IEC 60255-151 para relés de sobrecorriente): ante una falla
 * en un circuito, debe actuar primero la protección inmediatamente aguas
 * arriba de ese circuito, no una protección general.
 *
 * IMPORTANTE — límites de este módulo:
 * - No hay base de datos de fabricantes: todas las curvas son genéricas
 *   (según letra de curva / clase). Por eso ningún resultado se informa
 *   como "verificado", siempre como estimación (no hay Nivel A/B de
 *   confiabilidad posible sin tablas de fabricante).
 * - No se calculan corrientes de cortocircuito de la instalación (Ik):
 *   el barrido se hace en múltiplos de In. Si el usuario ya calculó Ik en
 *   otro módulo, ese dato no se cruza acá.
 * - No compara diferenciales, esquemas de puesta a tierra, poder de
 *   corte ni sección de conductores: la app ya resuelve eso en otros
 *   módulos. Esto es exclusivamente el chequeo de selectividad.
 */

export type ProtType = "termomagnetico" | "guardamotor" | "fusible" | "rele" | "termico";

export interface ProtectionCurve {
  id: string;
  name: string;
  type: ProtType;
  In: number;
  curve: string;
}

export const TYPES: { value: ProtType; label: string; curves: string[] }[] = [
  {
    value: "termomagnetico",
    label: "Interruptor termomagnético",
    curves: ["B", "C", "D", "K", "Z"],
  },
  {
    value: "guardamotor",
    label: "Guardamotor (magnetotérmico)",
    curves: ["MA", "Clase 10", "Clase 20"],
  },
  { value: "fusible", label: "Fusible", curves: ["gG", "aM"] },
  { value: "rele", label: "Relé de sobrecorriente", curves: ["IEC NI", "IEC MI", "IEC EI"] },
  { value: "termico", label: "Relé térmico", curves: ["Clase 10", "Clase 20", "Clase 30"] },
];

/** Multiplicador de In (banda [mín, máx]) al que puede actuar el disparo magnético/instantáneo. */
const MAG_BAND: Record<string, [number, number]> = {
  B: [3, 5],
  C: [5, 10],
  D: [10, 14],
  K: [10, 14],
  Z: [2.4, 3.6],
  MA: [12, 13],
};

/**
 * IEC 60947-4-1 — tiempo de disparo normalizado a 7,2×Ie según clase de disparo
 * de relé térmico / guardamotor (valores tabulados de la norma, no estimados).
 */
const CLASE_7_2xIe: Record<string, { min: number; max: number }> = {
  "Clase 10": { min: 4, max: 10 },
  "Clase 20": { min: 6, max: 20 },
  "Clase 30": { min: 9, max: 30 },
};
const X72 = 7.2 * 7.2 - 1; // 50,84

const MAXT = 7200;
const INSTANT = 0.01;

/**
 * Curva térmica genérica IEC 60898-1 para termomagnéticos domésticos (B/C/D/K/Z),
 * calibrada con los ÚNICOS puntos que la norma fija (no hay una curva única publicada,
 * cada fabricante tiene la suya dentro de esta banda):
 *  - 1,13×In: no debe disparar dentro de 1 h (In≤63A) / 2 h (In>63A).
 *  - 2,55×In: debe disparar entre 1 s y 60 s (In≤32A) / 120 s (In>32A).
 * Se usa un modelo I²t = k (t = k/(x²-1)) calibrado con el punto de 2,55×In para
 * obtener el límite más rápido (k con t=1s) y el más lento (k con t=60/120s)
 * admitidos por la norma para cualquier fabricante.
 */
function thermalIEC60898Band(In: number, x: number): { tMin: number | null; tMax: number | null } {
  if (x <= 1.13) return { tMin: null, tMax: null };
  const t3 = In <= 32 ? 60 : 120;
  const kMin = 1 * (2.55 * 2.55 - 1);
  const kMax = t3 * (2.55 * 2.55 - 1);
  const tMin = kMin / (x * x - 1);
  const tMax = kMax / (x * x - 1);
  return { tMin: tMin > MAXT ? null : tMin, tMax: tMax > MAXT ? null : tMax };
}

/** Banda térmica IEC 60947-4-1 para relés térmicos / guardamotores por clase (10/20/30). */
function classThermalBand(curve: string, x: number): { tMin: number | null; tMax: number | null } {
  const lim = CLASE_7_2xIe[curve] ?? CLASE_7_2xIe["Clase 10"]!;
  if (x <= 1.05) return { tMin: null, tMax: null };
  const tMin = (lim.min * X72) / (x * x - 1);
  const tMax = (lim.max * X72) / (x * x - 1);
  return { tMin: tMin > MAXT ? null : tMin, tMax: tMax > MAXT ? null : tMax };
}

export interface CurveTimes {
  /** Tiempo de disparo más rápido plausible (unidad "sensible" de fábrica). null = no dispara. */
  tMin: number | null;
  /** Tiempo de disparo más lento plausible (unidad "tolerante" de fábrica). null = no dispara. */
  tMax: number | null;
  /** true si hay una banda real (tolerancia de fabricación) detrás de tMin/tMax. */
  hasBand: boolean;
}

/**
 * Tiempo de disparo [tMin, tMax] para una corriente I [A].
 * A diferencia de una curva ideal única, esto representa la dispersión real
 * de fabricación de una familia de dispositivos que comparten la misma
 * letra de curva / clase, tal como se publican en catálogos reales
 * (banda sombreada entre dos límites), y es la base para declarar
 * selectividad "garantizada" en el peor caso.
 */
export function curveTimes(d: ProtectionCurve, I: number): CurveTimes {
  const x = I / d.In;

  if (d.type === "fusible") {
    // Aproximación genérica IEC 60269 (gG/aM). Sin datos de fabricante no se puede
    // construir una banda real: se informa como curva única de baja confianza.
    const k = d.curve === "aM" ? 900 : 300;
    if (x <= 1.25) return { tMin: null, tMax: null, hasBand: false };
    const t = k * Math.pow(x, -4);
    const v = t > MAXT ? null : Math.max(t, 0.002);
    return { tMin: v, tMax: v, hasBand: false };
  }

  if (d.type === "rele") {
    // IEC 60255-151, TMS fijo en 0,2 (no configurable en esta versión); curva única.
    const p =
      d.curve === "IEC EI"
        ? { a: 80, n: 2 }
        : d.curve === "IEC MI"
          ? { a: 13.5, n: 1 }
          : { a: 0.14, n: 0.02 };
    if (x <= 1.05) return { tMin: null, tMax: null, hasBand: false };
    const t = (0.2 * p.a) / (Math.pow(x, p.n) - 1);
    const v = t > MAXT ? null : Math.max(t, 0.05);
    return { tMin: v, tMax: v, hasBand: false };
  }

  if (d.type === "termico") {
    // Relé térmico "puro": solo protección de sobrecarga (ver nota en auditPair:
    // no incluye cortocircuito). Banda real según IEC 60947-4-1.
    const b = classThermalBand(d.curve, x);
    return { tMin: b.tMin, tMax: b.tMax, hasBand: true };
  }

  // termomagnético / guardamotor: combinan zona térmica + zona magnética.
  const band = MAG_BAND[d.curve] ?? (d.type === "guardamotor" ? MAG_BAND["MA"]! : MAG_BAND["C"]!);

  if (d.type === "guardamotor" && d.curve === "MA") {
    // Curva MA: solo disparo magnético (~12-13×In), SIN protección térmica propia
    // (el guardamotor con curva MA se combina con un relé térmico aparte).
    if (x >= band[1]) return { tMin: INSTANT, tMax: INSTANT, hasBand: true };
    if (x >= band[0]) return { tMin: INSTANT, tMax: null, hasBand: true };
    return { tMin: null, tMax: null, hasBand: true };
  }

  const clase = CLASE_7_2xIe[d.curve]; // guardamotor con curva "Clase 10/20"
  const thermal = clase ? classThermalBand(d.curve, x) : thermalIEC60898Band(d.In, x);

  if (x >= band[1]) {
    // Toda la población de unidades ya disparó instantáneamente.
    return { tMin: INSTANT, tMax: INSTANT, hasBand: true };
  }
  if (x >= band[0]) {
    // La unidad más sensible ya puede haber disparado instantáneamente,
    // pero la más tolerante puede seguir dependiendo de la curva térmica
    // hasta llegar al techo de la banda magnética.
    return { tMin: INSTANT, tMax: thermal.tMax ?? MAXT, hasBand: true };
  }
  return { tMin: thermal.tMin, tMax: thermal.tMax, hasBand: true };
}

/**
 * Corriente [A] a partir de la cual un dispositivo puede empezar a operar
 * magnéticamente (fin garantizado de la zona de sobrecarga pura).
 * null = el dispositivo no tiene una zona magnética modelada (fusible, relé,
 * térmico puro), por lo que no corresponde separar sobrecarga/cortocircuito.
 */
export function zoneBoundaryCurrent(d: ProtectionCurve): number | null {
  if (d.type !== "termomagnetico" && d.type !== "guardamotor") return null;
  const band = MAG_BAND[d.curve] ?? (d.type === "guardamotor" ? MAG_BAND["MA"]! : MAG_BAND["C"]!);
  return band[0] * d.In;
}

export type Verdict = "TOTAL" | "PARCIAL" | "NO_SELECTIVO" | "NO_VERIFICABLE";

export interface ZoneEval {
  verdict: Verdict;
  /** Corriente límite de selectividad estimada (A), solo si verdict = PARCIAL. */
  limitCurrent?: number;
  detail: string;
}

export const VERDICT_SEVERITY: Record<Verdict, number> = {
  NO_SELECTIVO: 4,
  PARCIAL: 3,
  NO_VERIFICABLE: 2,
  TOTAL: 1,
};

function worst(a: ZoneEval, b: ZoneEval): ZoneEval {
  return VERDICT_SEVERITY[a.verdict] >= VERDICT_SEVERITY[b.verdict] ? a : b;
}

/** Combina varios veredictos y devuelve el peor caso (para armar un estado global). */
export function worstVerdict(verdicts: Verdict[]): Verdict | null {
  if (!verdicts.length) return null;
  return verdicts.reduce((acc, v) => (VERDICT_SEVERITY[v] >= VERDICT_SEVERITY[acc] ? v : acc));
}

/**
 * Evalúa selectividad entre `down` (aguas abajo) y `up` (aguas arriba) en el
 * rango de corriente [Ilo, Ihi]. Criterio (conservador, "peor caso"):
 *  - SELECTIVO en I si tMax(down, I) < tMin(up, I): incluso la unidad más
 *    lenta de aguas abajo despeja la falla antes que la unidad más rápida
 *    posible de aguas arriba.
 *  - Se recorre el rango de menor a mayor corriente. Si nunca se pierde esa
 *    condición → TOTAL. Si se pierde desde el primer punto del tramo → NO
 *    SELECTIVO. Si se pierde a partir de una corriente intermedia → PARCIAL,
 *    informando la corriente límite de selectividad (Is) estimada.
 */
function evalRange(
  down: ProtectionCurve,
  up: ProtectionCurve,
  Ilo: number,
  Ihi: number,
  steps = 240,
): ZoneEval {
  let firstUnsafe: number | null = null;
  let sampledAny = false;
  let bandless = false;

  for (let s = 0; s <= steps; s++) {
    const I = Ilo * Math.pow(Ihi / Ilo, s / steps);
    const dn = curveTimes(down, I);
    const up_ = curveTimes(up, I);
    // Si la protección aguas abajo ni siquiera ve sobrecarga a esta corriente,
    // no hay nada que proteger todavía: no aporta información de selectividad.
    if (dn.tMax == null) continue;
    sampledAny = true;
    if (!dn.hasBand || !up_.hasBand) bandless = true;
    // Si la protección aguas arriba está garantizada a NO operar a esta corriente
    // (muy por debajo de su propio umbral), la condición es segura por definición:
    // no hay riesgo de que dispare antes que la de aguas abajo.
    if (up_.tMin == null) continue;

    const safe = dn.tMax < up_.tMin;
    if (!safe && firstUnsafe == null) firstUnsafe = I;
  }

  if (!sampledAny) {
    return {
      verdict: "NO_VERIFICABLE",
      detail:
        "En el rango de corriente analizado ninguna de las dos protecciones dispara dentro de los tiempos considerados (hasta 7200 s); no se puede comparar.",
    };
  }

  if (firstUnsafe == null) {
    return {
      verdict: "TOTAL",
      detail: bandless
        ? "La curva de la protección aguas abajo se mantiene por debajo de la de aguas arriba en todo el tramo, pero al menos uno de los dos dispositivos no tiene banda de tolerancia modelada (fusible o relé): resultado orientativo, no garantizado para todas las unidades de fábrica."
        : "La banda de disparo (caso más lento) de la protección aguas abajo se mantiene íntegramente por debajo de la banda de disparo (caso más rápido) de la protección aguas arriba en todo el tramo analizado.",
    };
  }

  if (firstUnsafe <= Ilo * 1.02) {
    return {
      verdict: "NO_SELECTIVO",
      detail: `Desde el inicio del tramo (≈${firstUnsafe.toFixed(0)} A) no está garantizado que la protección aguas abajo actúe antes que la de aguas arriba.`,
    };
  }

  return {
    verdict: "PARCIAL",
    limitCurrent: firstUnsafe,
    detail: `Selectivo hasta aproximadamente ${firstUnsafe.toFixed(0)} A (corriente límite de selectividad estimada, Is). Por encima de ese valor no está garantizado que la protección aguas abajo actúe primero.`,
  };
}

export interface PairAudit {
  down: ProtectionCurve;
  up: ProtectionCurve;
  /** true = down.parentId === up.id (protección inmediatamente aguas arriba). false = ancestro más lejano. */
  adyacente: boolean;
  splitByZone: boolean;
  sobrecarga?: ZoneEval;
  cortocircuito?: ZoneEval;
  combinado?: ZoneEval;
  global: ZoneEval;
  notas: string[];
}

/** Compara dos protecciones consecutivas (o de una misma cadena) y determina selectividad. */
export function auditPair(
  down: ProtectionCurve,
  up: ProtectionCurve,
  adyacente: boolean,
): PairAudit {
  const notas: string[] = [];
  if (down.type === "termico" || up.type === "termico") {
    notas.push(
      "Un relé térmico no incluye protección de cortocircuito propia (solo sobrecarga); necesita un dispositivo adicional (fusible o interruptor) que despeje la falla de cortocircuito.",
    );
  }
  if (down.type === "fusible" || up.type === "fusible") {
    notas.push(
      "El fusible se evaluó con una curva gG/aM genérica (no la curva real publicada por el fabricante del modelo instalado), por lo que la selectividad en la zona de cortocircuito es orientativa.",
    );
  }
  if (down.type === "rele" || up.type === "rele") {
    notas.push(
      "La curva del relé de sobrecorriente se evaluó con TMS = 0,2 fijo y sin escalón instantáneo (50/50N); si el relé real tiene otro ajuste, este resultado no es válido para ese dispositivo.",
    );
  }
  if (down.type === "guardamotor" && down.curve === "MA") {
    notas.push(
      `${down.name}: la curva MA no ofrece protección de sobrecarga (solo cortocircuito, ~12-13×In).`,
    );
  }
  if (up.type === "guardamotor" && up.curve === "MA") {
    notas.push(
      `${up.name}: la curva MA no ofrece protección de sobrecarga (solo cortocircuito, ~12-13×In).`,
    );
  }

  const downBoundary = zoneBoundaryCurrent(down);
  const upBoundary = zoneBoundaryCurrent(up);
  const splitByZone = downBoundary != null && upBoundary != null;

  const sweepLo = Math.max(1.05 * down.In, 1.02);
  const sweepHi = 25 * Math.max(down.In, up.In);

  if (!splitByZone) {
    const combinado = evalRange(down, up, sweepLo, sweepHi);
    return { down, up, adyacente, splitByZone, combinado, global: combinado, notas };
  }

  const zoneSplit = Math.min(downBoundary!, upBoundary!);
  const sobrecarga: ZoneEval =
    zoneSplit > sweepLo
      ? evalRange(down, up, sweepLo, zoneSplit)
      : {
          verdict: "NO_VERIFICABLE",
          detail:
            "El umbral magnético de una de las dos protecciones es igual o menor que la corriente de arranque del tramo de sobrecarga: no existe tramo puramente térmico para comparar.",
        };
  const cortocircuito = evalRange(down, up, zoneSplit, sweepHi);

  return {
    down,
    up,
    adyacente,
    splitByZone,
    sobrecarga,
    cortocircuito,
    global: worst(sobrecarga, cortocircuito),
    notas,
  };
}

/* ───────────────────────── Árbol aguas arriba / aguas abajo ───────────────────────── */

export interface WithParent {
  id: string;
  parentId: string | null;
}

/** Ancestros de `id`, del padre inmediato hacia la cabecera (protege contra ciclos). */
export function getAncestorIds<T extends WithParent>(id: string, all: T[]): string[] {
  const byId = new Map(all.map((d) => [d.id, d]));
  const out: string[] = [];
  const seen = new Set([id]);
  let cur = byId.get(id);
  while (cur?.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId)) {
    out.push(cur.parentId);
    seen.add(cur.parentId);
    cur = byId.get(cur.parentId);
  }
  return out;
}

/** Todos los descendientes de `id` (protege contra ciclos). */
export function getDescendantIds<T extends WithParent>(id: string, all: T[]): Set<string> {
  const out = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of all) {
      if (d.parentId && (d.parentId === id || out.has(d.parentId)) && !out.has(d.id)) {
        out.add(d.id);
        changed = true;
      }
    }
  }
  return out;
}

/**
 * Recorre automáticamente todo el árbol de protecciones (alimentación → tablero
 * principal → seccionales → circuitos finales) y arma la lista de pares a auditar:
 * cada protección contra CADA ancestro (no solo el inmediato), para detectar tanto
 * problemas puntuales (p. ej. Q2 vs Q1) como de coordinación global de la cadena
 * (p. ej. Q3 vs Q0), tal como exige el punto 1 de la auditoría.
 */
export function buildAuditPairs<T extends ProtectionCurve & WithParent>(devices: T[]): PairAudit[] {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const pairs: PairAudit[] = [];
  for (const down of devices) {
    const ancestors = getAncestorIds(down.id, devices);
    ancestors.forEach((upId, idx) => {
      const up = byId.get(upId);
      if (!up) return;
      pairs.push(auditPair(down, up, idx === 0));
    });
  }
  return pairs;
}
