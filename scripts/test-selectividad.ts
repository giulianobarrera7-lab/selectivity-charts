/**
 * Pruebas de humo del motor de selectividad (src/lib/selectividad.ts).
 * Se ejecuta con Node nativo (type-stripping), sin agregar dependencias:
 *   node --experimental-strip-types scripts/test-selectividad.ts
 */
import { auditPair, curveTimes, type ProtectionCurve } from "../src/lib/selectividad.ts";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) {
    failures++;
    console.error(`✗ ${name}${extra ? " — " + extra : ""}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

function dev(
  p: Partial<ProtectionCurve> & { id: string; name: string; In: number; curve: string },
): ProtectionCurve {
  return { type: "termomagnetico", ...p } as ProtectionCurve;
}

// 1) Q1=63A curva C vs Q2=32A curva C: la sola relación In no alcanza para
// declarar selectividad total — en la zona de cortocircuito las bandas de una
// misma curva C se superponen (ambas alcanzan instantáneo dentro del rango 5-10x).
{
  const q2 = dev({ id: "q2", name: "Q2", In: 32, curve: "C" }); // aguas abajo
  const q1 = dev({ id: "q1", name: "Q1", In: 63, curve: "C" }); // aguas arriba
  const audit = auditPair(q2, q1, true);
  check(
    "Q1(63A,C) vs Q2(32A,C): NO se declara TOTAL solo por In mayor",
    audit.global.verdict !== "TOTAL",
    `global=${audit.global.verdict}`,
  );
  check(
    "Q1 vs Q2: cortocircuito no es TOTAL",
    audit.cortocircuito?.verdict !== "TOTAL",
    `cortocircuito=${audit.cortocircuito?.verdict}`,
  );
}

// 2) Selectividad total esperable: aguas arriba con In muy superior y curva D
// (banda magnética alta) contra aguas abajo pequeño curva B (banda magnética baja).
{
  const down = dev({ id: "down", name: "Circuito TUG", In: 16, curve: "B" });
  const up = dev({ id: "up", name: "Alimentador", In: 100, curve: "D" });
  const audit = auditPair(down, up, true);
  check(
    "Circuito 16A curva B vs alimentador 100A curva D: sobrecarga TOTAL",
    audit.sobrecarga?.verdict === "TOTAL",
  );
}

// 3) Relé térmico: no debe evaluar cortocircuito como si lo protegiera.
{
  const down = dev({ id: "term", name: "Térmico M1", In: 10, curve: "Clase 10", type: "termico" });
  const up = dev({ id: "qf", name: "QF general", In: 63, curve: "C" });
  const audit = auditPair(down, up, true);
  check(
    "Relé térmico: no tiene split de zona (no ofrece protección de cortocircuito propia)",
    audit.splitByZone === false,
  );
  check(
    "Relé térmico: nota advierte falta de protección de cortocircuito",
    audit.notas.some((n) => n.includes("cortocircuito propia")),
  );
}

// 4) Curva MA de guardamotor: no debe tener trip por sobrecarga a corrientes bajas.
{
  const ma = dev({ id: "ma", name: "Guardamotor MA", In: 10, curve: "MA", type: "guardamotor" });
  const t_1_5In = curveTimes(ma, 15); // 1.5x In, muy por debajo de 12x
  check(
    "Curva MA no dispara a 1,5×In (no tiene protección térmica)",
    t_1_5In.tMax == null && t_1_5In.tMin == null,
  );
  const t_13In = curveTimes(ma, 130); // 13x In
  check("Curva MA dispara instantáneo a 13×In", t_13In.tMax === 0.01 && t_13In.tMin === 0.01);
}

// 5) Clase térmica calibrada contra el punto normativo IEC 60947-4-1 (7,2×Ie).
{
  const c10 = dev({
    id: "c10",
    name: "Térmico clase 10",
    In: 10,
    curve: "Clase 10",
    type: "termico",
  });
  const t = curveTimes(c10, 72); // 7.2 x In
  check(
    "Clase 10 dispara entre 4 y 10 s a 7,2×Ie (según IEC 60947-4-1)",
    t.tMin != null &&
      t.tMax != null &&
      t.tMin >= 3.9 &&
      t.tMin <= 4.2 &&
      t.tMax >= 9.8 &&
      t.tMax <= 10.2,
    `tMin=${t.tMin} tMax=${t.tMax}`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} prueba(s) fallida(s).`);
  process.exit(1);
} else {
  console.log("\nTodas las pruebas pasaron.");
}
