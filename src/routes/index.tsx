import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  TYPES,
  curveTimes,
  buildAuditPairs,
  getDescendantIds,
  worstVerdict,
  type ProtType,
  type Verdict,
} from "@/lib/selectividad";
import {
  ICU_VALORES,
  SECCIONES,
  TABLA_5I,
  TABLA_5II,
  TABLA_5III,
  factorTemp,
  izTabla,
  type Montaje,
  type Polaridad,
} from "@/lib/tablas";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Selectividad de Protecciones | Curvas Tiempo-Corriente" },
      {
        name: "description",
        content:
          "Auditoría de selectividad entre protecciones eléctricas: coordinación aguas arriba/aguas abajo, comparación de bandas tiempo-corriente y verificación por zona de sobrecarga y cortocircuito.",
      },
      { property: "og:title", content: "Selectividad de Protecciones Eléctricas" },
      {
        property: "og:description",
        content:
          "Cargá el árbol de protecciones (aguas arriba/aguas abajo) y verificá selectividad en sobrecarga y cortocircuito por separado, con curvas tiempo-corriente log-log.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

/* ───────────────────────── Modelo de datos ───────────────────────── */

type Device = {
  id: string;
  name: string;
  type: ProtType;
  In: number;
  curve: string;
  kA: number;
  visible: boolean;
  /** Protección inmediatamente aguas arriba (null = cabecera / acometida). */
  parentId: string | null;
  // Cable asociado (informativo)
  cableType: "unipolar" | "multipolar";
  install: "subterraneo" | "aire";
  section: number;
  cableIz: number;
  color: string;
};

const PALETTE = [
  "#f4b73f",
  "#4cc9f0",
  "#ef476f",
  "#8ac926",
  "#c77dff",
  "#ff9f1c",
  "#06d6a0",
  "#ff6b6b",
];

const VERDICT_LABEL: Record<Verdict, string> = {
  TOTAL: "Selectividad total",
  PARCIAL: "Selectividad parcial",
  NO_SELECTIVO: "No selectivo",
  NO_VERIFICABLE: "No verificable",
};

const VERDICT_DOT: Record<Verdict, string> = {
  TOTAL: "🟢",
  PARCIAL: "🟡",
  NO_SELECTIVO: "🔴",
  NO_VERIFICABLE: "⚪",
};

const VERDICT_TONE: Record<Verdict, "ok" | "warn" | "bad" | "muted"> = {
  TOTAL: "ok",
  PARCIAL: "warn",
  NO_SELECTIVO: "bad",
  NO_VERIFICABLE: "muted",
};

/* ───────────────────────── Gráfico log-log (banda mín/máx) ───────────────────────── */

function CurveChart({ devices }: { devices: Device[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const visible = devices.filter((d) => d.visible);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const css = (n: string) => getComputedStyle(document.body).getPropertyValue(n).trim();
    const grid = css("--grid-line") || "#333";
    const fg = css("--muted-foreground") || "#999";

    const pad = { l: 56, r: 14, t: 16, b: 34 };
    const Imin = 1;
    const Imax = Math.max(1000, ...visible.map((d) => d.In * 25));
    const Tmin = 0.005;
    const Tmax = 7200;
    const lx = (I: number) =>
      pad.l +
      ((Math.log10(I) - Math.log10(Imin)) / (Math.log10(Imax) - Math.log10(Imin))) *
        (w - pad.l - pad.r);
    const ly = (t: number) =>
      pad.t +
      ((Math.log10(Tmax) - Math.log10(t)) / (Math.log10(Tmax) - Math.log10(Tmin))) *
        (h - pad.t - pad.b);

    // grilla
    ctx.font = "10px ui-monospace, monospace";
    ctx.strokeStyle = grid;
    ctx.fillStyle = fg;
    for (let dec = 0; Math.pow(10, dec) <= Imax; dec++) {
      for (let m = 1; m < 10; m++) {
        const I = m * Math.pow(10, dec);
        if (I < Imin || I > Imax) continue;
        ctx.globalAlpha = m === 1 ? 0.9 : 0.35;
        ctx.beginPath();
        ctx.moveTo(lx(I), pad.t);
        ctx.lineTo(lx(I), h - pad.b);
        ctx.stroke();
        if (m === 1) {
          ctx.globalAlpha = 1;
          ctx.textAlign = "center";
          ctx.fillText(`${I} A`, lx(I), h - pad.b + 14);
        }
      }
    }
    for (let dec = -3; dec <= 4; dec++) {
      for (let m = 1; m < 10; m++) {
        const t = m * Math.pow(10, dec);
        if (t < Tmin || t > Tmax) continue;
        ctx.globalAlpha = m === 1 ? 0.9 : 0.3;
        ctx.beginPath();
        ctx.moveTo(pad.l, ly(t));
        ctx.lineTo(w - pad.r, ly(t));
        ctx.stroke();
        if (m === 1) {
          ctx.globalAlpha = 1;
          ctx.textAlign = "right";
          ctx.fillText(t < 1 ? `${t}` : `${t}s`, pad.l - 6, ly(t) + 3);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.fillText("t", 8, pad.t + 10);

    // curvas: banda [tMin, tMax] rellena + bordes
    const STEPS = 900;
    visible.forEach((d) => {
      const upper: [number, number][] = []; // borde rápido (tMin)
      const lower: [number, number][] = []; // borde lento (tMax)

      for (let s = 0; s <= STEPS; s++) {
        const I = Imin * Math.pow(Imax / Imin, s / STEPS);
        const { tMin, tMax } = curveTimes(d, I);
        if (tMin != null && tMin <= Tmax && tMin >= Tmin) upper.push([lx(I), ly(tMin)]);
        if (tMax != null && tMax <= Tmax && tMax >= Tmin) lower.push([lx(I), ly(tMax)]);
      }

      // relleno de banda (solo si hay puntos en ambos bordes)
      if (upper.length > 1 && lower.length > 1) {
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = d.color;
        ctx.beginPath();
        upper.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        for (let i = lower.length - 1; i >= 0; i--) ctx.lineTo(lower[i]![0], lower[i]![1]);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.strokeStyle = d.color;
      ctx.lineWidth = 1.6;
      [upper, lower].forEach((pts) => {
        if (pts.length < 2) return;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.stroke();
      });

      // marca de In
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(lx(d.In), pad.t);
      ctx.lineTo(lx(d.In), h - pad.b);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    });
  }, [devices, visible.length]);

  return <canvas ref={ref} className="h-[420px] w-full rounded-md sm:h-[520px]" />;
}

/* ───────────────────────── Página ───────────────────────── */

const STORAGE = "selectividad.devices.v2";
const STORAGE_LEGACY = "selectividad.devices.v1";

const emptyForm = (): Omit<Device, "id" | "color" | "visible"> => ({
  name: "",
  type: "termomagnetico",
  In: 16,
  curve: "C",
  kA: 6,
  parentId: null,
  cableType: "unipolar",
  install: "aire",
  section: 2.5,
  cableIz: 21,
});

function Index() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [form, setForm] = useState(emptyForm());
  const [editing, setEditing] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE) ?? localStorage.getItem(STORAGE_LEGACY);
      if (raw) {
        const parsed = JSON.parse(raw) as Device[];
        setDevices(parsed.map((d) => ({ ...d, parentId: d.parentId ?? null })));
      }
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(STORAGE, JSON.stringify(devices));
  }, [devices, loaded]);

  const pairs = useMemo(() => buildAuditPairs(devices.filter((d) => d.visible)), [devices]);
  const curves = TYPES.find((t) => t.value === form.type)?.curves ?? ["C"];

  const parentOptions = useMemo(() => {
    const excluded = new Set<string>();
    if (editing) {
      excluded.add(editing);
      getDescendantIds(editing, devices).forEach((id) => excluded.add(id));
    }
    return devices.filter((d) => !excluded.has(d.id));
  }, [devices, editing]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim() || `Protección ${devices.length + 1}`;
    if (editing) {
      setDevices((ds) => ds.map((d) => (d.id === editing ? { ...d, ...form, name } : d)));
      setEditing(null);
    } else {
      setDevices((ds) => [
        ...ds,
        {
          ...form,
          name,
          id: crypto.randomUUID(),
          visible: true,
          color: PALETTE[ds.length % PALETTE.length]!,
        },
      ]);
    }
    setForm(emptyForm());
  }

  function edit(d: Device) {
    const { id: _id, color: _c, visible: _v, ...rest } = d;
    setForm(rest);
    setEditing(d.id);
  }

  function removeDevice(id: string) {
    // Los circuitos que colgaban del eliminado se reconectan un nivel arriba,
    // para no romper la cadena de aguas arriba/aguas abajo.
    const removed = devices.find((d) => d.id === id);
    const parentId = removed ? removed.parentId : null;
    setDevices((ds) =>
      ds.filter((d) => d.id !== id).map((d) => (d.parentId === id ? { ...d, parentId } : d)),
    );
    if (editing === id) setEditing(null);
  }

  /** Pares donde `d` es la protección aguas abajo (su propia cobertura). */
  function pairsFor(d: Device) {
    return pairs.filter((p) => p.down.id === d.id);
  }

  function deviceStatus(d: Device) {
    if (!d.visible) return { label: "Oculto", tone: "muted" as const, detail: "" };
    if (!d.parentId)
      return {
        label: "Cabecera",
        tone: "muted" as const,
        detail: "Sin protección aguas arriba definida en el árbol.",
      };
    const rel = pairsFor(d);
    if (!rel.length)
      return {
        label: "Sin datos",
        tone: "muted" as const,
        detail: "No se pudo evaluar la cadena aguas arriba.",
      };
    const v = worstVerdict(rel.map((p) => p.global.verdict))!;
    const worstPair = rel.find((p) => p.global.verdict === v)!;
    return { label: VERDICT_LABEL[v], tone: VERDICT_TONE[v], detail: worstPair.global.detail };
  }

  const projectVerdict = worstVerdict(pairs.map((p) => p.global.verdict));
  const sortedPairs = [...pairs].sort((a, b) => {
    if (a.adyacente !== b.adyacente) return a.adyacente ? -1 : 1;
    return a.down.name.localeCompare(b.down.name);
  });

  const toneClass = {
    ok: "bg-success/15 text-success border-success/40",
    warn: "bg-warning/15 text-warning border-warning/40",
    bad: "bg-destructive/15 text-destructive border-destructive/40",
    muted: "bg-muted text-muted-foreground border-border",
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-[0.65rem] uppercase tracking-[0.25em] text-primary">
          Estudio tiempo-corriente
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
          Selectividad de protecciones eléctricas
        </h1>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          Cargá cada protección indicando de qué protección "aguas arriba" depende. La app arma el
          árbol de alimentación y verifica, para cada tramo, si actúa primero la protección
          inmediatamente aguas abajo — por separado en la zona de sobrecarga y en la de
          cortocircuito — comparando bandas tiempo-corriente, no una única curva ideal.
        </p>
        <p className="mt-2 max-w-2xl text-[0.68rem] leading-relaxed text-muted-foreground">
          Los resultados son una <strong>estimación según curva genérica</strong> (letra B/C/D/K/Z o
          clase 10/20/30), calibrada contra los puntos normalizados de IEC 60898-1 / IEC 60947-4-1 /
          IEC 60255-151 / IEC 60269. La reglamentación (AEA 90364) exige que la protección coordine
          para que actúe primero la más cercana a la falla; esta herramienta no reemplaza las tablas
          de selectividad certificadas por el fabricante del dispositivo real instalado, que son las
          únicas que permiten declarar selectividad garantizada.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        {/* Panel de ingreso */}
        <section className="panel h-fit p-4">
          <h2 className="mb-3 text-sm font-semibold">
            {editing ? "Editar protección" : "Nueva protección"}
          </h2>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <span className="label-xs">Nombre / circuito</span>
              <input
                className="field"
                placeholder="Bomba 1, Tablero principal…"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <span className="label-xs">Alimentado desde (aguas arriba)</span>
              <select
                className="field"
                value={form.parentId ?? ""}
                onChange={(e) => setForm({ ...form, parentId: e.target.value || null })}
              >
                <option value="">— Ninguno (acometida / cabecera) —</option>
                {parentOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} (In {d.In} A)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="label-xs">Tipo de protección</span>
              <select
                className="field"
                value={form.type}
                onChange={(e) => {
                  const type = e.target.value as ProtType;
                  const c = TYPES.find((t) => t.value === type)!.curves[0]!;
                  setForm({ ...form, type, curve: c });
                }}
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="label-xs">In (A)</span>
                <input
                  type="number"
                  min={0.1}
                  step="0.1"
                  className="field"
                  value={form.In}
                  onChange={(e) => setForm({ ...form, In: Number(e.target.value) })}
                />
              </div>
              <div>
                <span className="label-xs">Curva</span>
                <select
                  className="field"
                  value={form.curve}
                  onChange={(e) => setForm({ ...form, curve: e.target.value })}
                >
                  {curves.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="label-xs">Icu (kA)</span>
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  className="field"
                  value={form.kA}
                  onChange={(e) => setForm({ ...form, kA: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="rounded-md border border-border/70 bg-secondary/40 p-3">
              <p className="label-xs mb-2">Cable asociado (informativo)</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="label-xs">Tipo</span>
                  <select
                    className="field"
                    value={form.cableType}
                    onChange={(e) =>
                      setForm({ ...form, cableType: e.target.value as Device["cableType"] })
                    }
                  >
                    <option value="unipolar">Unipolar</option>
                    <option value="multipolar">Multipolar / bipolar</option>
                  </select>
                </div>
                <div>
                  <span className="label-xs">Instalación</span>
                  <select
                    className="field"
                    value={form.install}
                    onChange={(e) =>
                      setForm({ ...form, install: e.target.value as Device["install"] })
                    }
                  >
                    <option value="aire">Al aire / intemperie</option>
                    <option value="subterraneo">Subterráneo</option>
                  </select>
                </div>
                <div>
                  <span className="label-xs">Sección (mm²)</span>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    className="field"
                    value={form.section}
                    onChange={(e) => setForm({ ...form, section: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <span className="label-xs">Iz admisible (A)</span>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    className="field"
                    value={form.cableIz}
                    onChange={(e) => setForm({ ...form, cableIz: Number(e.target.value) })}
                  />
                </div>
              </div>
              {form.cableIz > 0 && form.In > form.cableIz && (
                <p className="mt-2 text-[0.7rem] text-destructive">
                  In ({form.In} A) supera la corriente admisible del cable ({form.cableIz} A).
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                {editing ? "Guardar cambios" : "Agregar protección"}
              </button>
              {editing && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setForm(emptyForm());
                  }}
                  className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-secondary"
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </section>

        {/* Gráfico + análisis */}
        <div className="space-y-5">
          <section className="panel p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Curvas de disparo (banda mín/máx, log-log)</h2>
              <div className="flex flex-wrap gap-3 text-[0.7rem]">
                {devices
                  .filter((d) => d.visible)
                  .map((d) => (
                    <span key={d.id} className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-4 rounded-sm"
                        style={{ backgroundColor: d.color }}
                      />
                      {d.name}
                    </span>
                  ))}
              </div>
            </div>
            {devices.some((d) => d.visible) ? (
              <CurveChart devices={devices} />
            ) : (
              <p className="py-24 text-center text-xs text-muted-foreground">
                Agregá protecciones para ver sus curvas superpuestas.
              </p>
            )}
          </section>

          <section className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold">
              Estado de selectividad del proyecto{" "}
              {projectVerdict ? (
                <span
                  className={`ml-1 rounded border px-2 py-0.5 text-[0.65rem] ${toneClass[VERDICT_TONE[projectVerdict]]}`}
                >
                  {VERDICT_DOT[projectVerdict]} {VERDICT_LABEL[projectVerdict]}
                </span>
              ) : (
                <span
                  className={`ml-1 rounded border px-2 py-0.5 text-[0.65rem] ${toneClass.muted}`}
                >
                  Sin tramos para evaluar
                </span>
              )}
            </h2>
            {pairs.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Cargá al menos dos protecciones encadenadas (una "alimentada desde" la otra) para
                obtener un resultado.
              </p>
            ) : (
              <ul className="space-y-2">
                {sortedPairs
                  .filter((p) => p.global.verdict !== "TOTAL")
                  .map((p, k) => (
                    <li
                      key={k}
                      className={`rounded-md border p-2.5 text-[0.72rem] leading-relaxed ${toneClass[VERDICT_TONE[p.global.verdict]]}`}
                    >
                      <strong>
                        {p.up.name} (aguas arriba) → {p.down.name} (aguas abajo)
                        {!p.adyacente && " · cadena global (no inmediata)"}
                      </strong>
                      <br />
                      {p.splitByZone ? (
                        <>
                          Sobrecarga: {VERDICT_DOT[p.sobrecarga!.verdict]}{" "}
                          {VERDICT_LABEL[p.sobrecarga!.verdict]} — {p.sobrecarga!.detail}
                          <br />
                          Cortocircuito: {VERDICT_DOT[p.cortocircuito!.verdict]}{" "}
                          {VERDICT_LABEL[p.cortocircuito!.verdict]} — {p.cortocircuito!.detail}
                        </>
                      ) : (
                        p.combinado!.detail
                      )}
                      {p.notas.length > 0 && (
                        <ul className="mt-1 list-inside list-disc text-[0.68rem] text-muted-foreground">
                          {p.notas.map((n, i) => (
                            <li key={i}>{n}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                {sortedPairs.every((p) => p.global.verdict === "TOTAL") && (
                  <p className="text-xs text-muted-foreground">
                    No se detectan pérdidas de selectividad (estimadas) entre los tramos cargados.
                  </p>
                )}
              </ul>
            )}
          </section>

          <section className="panel overflow-x-auto p-4">
            <h2 className="mb-1 text-sm font-semibold">Matriz de selectividad</h2>
            <p className="mb-3 text-[0.68rem] text-muted-foreground">
              Cada fila compara una protección con una protección aguas arriba de su cadena
              (inmediata o más lejana, para detectar también problemas de coordinación global).
            </p>
            {pairs.length === 0 ? (
              <p className="text-xs text-muted-foreground">Todavía no hay tramos para auditar.</p>
            ) : (
              <table className="w-full min-w-[860px] text-left text-[0.72rem]">
                <thead className="text-[0.62rem] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="whitespace-nowrap py-2 pr-4">Aguas arriba</th>
                    <th className="whitespace-nowrap py-2 pr-4">Aguas abajo</th>
                    <th className="whitespace-nowrap py-2 pr-4">Relación</th>
                    <th className="whitespace-nowrap py-2 pr-4">Sobrecarga</th>
                    <th className="whitespace-nowrap py-2 pr-4">Cortocircuito</th>
                    <th className="whitespace-nowrap py-2 pr-4">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPairs.map((p, k) => (
                    <tr key={k} className="border-b border-border/50 align-top">
                      <td className="py-2 pr-4">{p.up.name}</td>
                      <td className="py-2 pr-4">{p.down.name}</td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {p.adyacente ? "Inmediata" : "Cadena global"}
                      </td>
                      <td className="py-2 pr-4">
                        {p.splitByZone
                          ? `${VERDICT_DOT[p.sobrecarga!.verdict]} ${VERDICT_LABEL[p.sobrecarga!.verdict]}`
                          : "N/A"}
                      </td>
                      <td className="py-2 pr-4">
                        {p.splitByZone
                          ? `${VERDICT_DOT[p.cortocircuito!.verdict]} ${VERDICT_LABEL[p.cortocircuito!.verdict]}`
                          : `${VERDICT_DOT[p.combinado!.verdict]} ${VERDICT_LABEL[p.combinado!.verdict]} (curva única)`}
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          title={p.global.detail}
                          className={`rounded border px-2 py-0.5 text-[0.65rem] ${toneClass[VERDICT_TONE[p.global.verdict]]}`}
                        >
                          {VERDICT_DOT[p.global.verdict]} {VERDICT_LABEL[p.global.verdict]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel overflow-x-auto p-4">
            <h2 className="mb-3 text-sm font-semibold">Protecciones cargadas ({devices.length})</h2>
            {devices.length === 0 ? (
              <p className="text-xs text-muted-foreground">Todavía no cargaste equipos.</p>
            ) : (
              <table className="w-full min-w-[900px] text-left text-[0.72rem]">
                <thead className="text-[0.62rem] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="whitespace-nowrap py-2 pr-4">Equipo</th>
                    <th className="whitespace-nowrap py-2 pr-4">Aguas arriba</th>
                    <th className="whitespace-nowrap py-2 pr-4">Tipo</th>
                    <th className="whitespace-nowrap py-2 pr-4">In</th>
                    <th className="whitespace-nowrap py-2 pr-4">Curva</th>
                    <th className="whitespace-nowrap py-2 pr-4">kA</th>
                    <th className="whitespace-nowrap py-2 pr-4">Estado</th>
                    <th className="py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {[...devices]
                    .sort((a, b) => b.In - a.In)
                    .map((d) => {
                      const v = deviceStatus(d);
                      const parent = devices.find((x) => x.id === d.parentId);
                      return (
                        <tr key={d.id} className="border-b border-border/50">
                          <td className="py-2 pr-4">
                            <span className="flex items-center gap-2">
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: d.color }}
                              />
                              {d.name}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-muted-foreground">
                            {parent ? parent.name : "—"}
                          </td>
                          <td className="py-2 text-muted-foreground">
                            {TYPES.find((t) => t.value === d.type)?.label}
                          </td>
                          <td className="py-2 pr-4">{d.In} A</td>
                          <td className="py-2 pr-4">{d.curve}</td>
                          <td className="py-2 pr-4">{d.kA}</td>
                          <td className="py-2 pr-4">
                            <span
                              title={v.detail}
                              className={`rounded border px-2 py-0.5 text-[0.65rem] ${toneClass[v.tone]}`}
                            >
                              {v.label}
                            </span>
                          </td>
                          <td className="py-2 text-right">
                            <span className="inline-flex gap-1">
                              <button
                                onClick={() =>
                                  setDevices((ds) =>
                                    ds.map((x) =>
                                      x.id === d.id ? { ...x, visible: !x.visible } : x,
                                    ),
                                  )
                                }
                                className="rounded border border-border px-2 py-1 hover:bg-secondary"
                              >
                                {d.visible ? "Ocultar" : "Mostrar"}
                              </button>
                              <button
                                onClick={() => edit(d)}
                                className="rounded border border-border px-2 py-1 hover:bg-secondary"
                              >
                                Editar
                              </button>
                              <button
                                onClick={() => removeDevice(d.id)}
                                className="rounded border border-destructive/50 px-2 py-1 text-destructive hover:bg-destructive/10"
                              >
                                Eliminar
                              </button>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
