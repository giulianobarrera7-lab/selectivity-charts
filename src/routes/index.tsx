import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Selectividad de Protecciones | Curvas Tiempo-Corriente" },
      {
        name: "description",
        content:
          "Herramienta para estudiar la selectividad entre protecciones eléctricas: carga de equipos, curvas de disparo log-log superpuestas y detección de cruces.",
      },
      { property: "og:title", content: "Selectividad de Protecciones Eléctricas" },
      {
        property: "og:description",
        content:
          "Graficá curvas tiempo-corriente de termomagnéticas, guardamotores, fusibles y relés y verificá la selectividad entre aguas arriba y aguas abajo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

/* ───────────────────────── Modelo de datos ───────────────────────── */

type ProtType = "termomagnetico" | "guardamotor" | "fusible" | "rele" | "termico";

type Device = {
  id: string;
  name: string;
  type: ProtType;
  In: number;
  curve: string;
  kA: number;
  visible: boolean;
  // Cable asociado (informativo)
  cableType: "unipolar" | "multipolar";
  install: "subterraneo" | "aire";
  section: number;
  cableIz: number;
  color: string;
};

const TYPES: { value: ProtType; label: string; curves: string[] }[] = [
  {
    value: "termomagnetico",
    label: "Interruptor termomagnético",
    curves: ["B", "C", "D", "K", "Z"],
  },
  { value: "guardamotor", label: "Guardamotor (magnetotérmico)", curves: ["MA", "Clase 10", "Clase 20"] },
  { value: "fusible", label: "Fusible", curves: ["gG", "aM"] },
  { value: "rele", label: "Relé de sobrecorriente", curves: ["IEC NI", "IEC MI", "IEC EI"] },
  { value: "termico", label: "Relé térmico", curves: ["Clase 10", "Clase 20", "Clase 30"] },
];

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

const MAG_BAND: Record<string, [number, number]> = {
  B: [3, 5],
  C: [5, 10],
  D: [10, 14],
  K: [10, 14],
  Z: [2.4, 3.6],
  MA: [12, 13],
};

const CLASS_K: Record<string, number> = {
  "Clase 10": 60,
  "Clase 20": 120,
  "Clase 30": 180,
};

/** Tiempo de disparo [s] para una corriente I [A]. null = no dispara. */
function tripTime(d: Device, I: number): number | null {
  const x = I / d.In;
  const MAXT = 7200;
  const INST = 0.01;

  if (d.type === "fusible") {
    const k = d.curve === "aM" ? 900 : 300;
    if (x <= 1.25) return null;
    const t = k * Math.pow(x, -4);
    return t > MAXT ? null : Math.max(t, 0.002);
  }

  if (d.type === "rele") {
    const p = d.curve === "IEC EI" ? { a: 80, n: 2 } : d.curve === "IEC MI" ? { a: 13.5, n: 1 } : { a: 0.14, n: 0.02 };
    if (x <= 1.05) return null;
    const t = (0.2 * p.a) / (Math.pow(x, p.n) - 1);
    return t > MAXT ? null : Math.max(t, 0.05);
  }

  if (d.type === "termico") {
    const k = CLASS_K[d.curve] ?? 60;
    if (x <= 1.05) return null;
    const t = k / (x * x - 1);
    return t > MAXT ? null : t;
  }

  // Termomagnético / guardamotor: térmica + magnética
  const band =
    MAG_BAND[d.curve] ?? (d.type === "guardamotor" ? MAG_BAND["MA"]! : MAG_BAND["C"]!);
  const kTh = d.type === "guardamotor" ? (CLASS_K[d.curve] ?? 60) : 80;
  if (x >= band[0]) return INST;
  if (x <= 1.13) return null;
  const t = kTh / (x * x - 1);
  return t > MAXT ? null : t;
}

/* ───────────────────────── Selectividad ───────────────────────── */

type Issue = {
  up: Device;
  down: Device;
  severity: "cruce" | "margen";
  current: number;
  detail: string;
};

function analyze(devices: Device[]) {
  const list = [...devices].filter((d) => d.visible).sort((a, b) => a.In - b.In);
  const issues: Issue[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const down = list[i]!;
      const up = list[j]!;
      if (up.In <= down.In) continue;
      let worst: Issue | null = null;
      for (let s = 0; s <= 300; s++) {
        const I = down.In * Math.pow(20 / 0.9, s / 300) * 0.9;
        const tD = tripTime(down, I);
        const tU = tripTime(up, I);
        if (tD == null || tU == null) continue;
        const ratio = tU / tD;
        if (ratio < 1) {
          worst = {
            up,
            down,
            severity: "cruce",
            current: I,
            detail: `A ${I.toFixed(0)} A la protección aguas arriba dispara antes (${fmtT(tU)} vs ${fmtT(tD)}).`,
          };
          break;
        }
        if (ratio < 1.5 && !worst) {
          worst = {
            up,
            down,
            severity: "margen",
            current: I,
            detail: `A ${I.toFixed(0)} A el margen de tiempo es escaso (${ratio.toFixed(2)}× · ${fmtT(tU)} vs ${fmtT(tD)}).`,
          };
        }
      }
      if (worst) issues.push(worst);
    }
  }
  return issues;
}

function fmtT(t: number) {
  if (t < 0.1) return `${(t * 1000).toFixed(0)} ms`;
  if (t < 60) return `${t.toFixed(2)} s`;
  return `${(t / 60).toFixed(1)} min`;
}

/* ───────────────────────── Gráfico log-log ───────────────────────── */

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
      pad.l + ((Math.log10(I) - Math.log10(Imin)) / (Math.log10(Imax) - Math.log10(Imin))) * (w - pad.l - pad.r);
    const ly = (t: number) =>
      pad.t + ((Math.log10(Tmax) - Math.log10(t)) / (Math.log10(Tmax) - Math.log10(Tmin))) * (h - pad.t - pad.b);

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

    // curvas
    visible.forEach((d) => {
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      for (let s = 0; s <= 900; s++) {
        const I = Imin * Math.pow(Imax / Imin, s / 900);
        const t = tripTime(d, I);
        if (t == null || t > Tmax || t < Tmin) {
          started = false;
          continue;
        }
        const X = lx(I);
        const Y = ly(t);
        if (!started) {
          ctx.moveTo(X, Y);
          started = true;
        } else ctx.lineTo(X, Y);
      }
      ctx.stroke();

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

const STORAGE = "selectividad.devices.v1";

const emptyForm = (): Omit<Device, "id" | "color" | "visible"> => ({
  name: "",
  type: "termomagnetico",
  In: 16,
  curve: "C",
  kA: 6,
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
      const raw = localStorage.getItem(STORAGE);
      if (raw) setDevices(JSON.parse(raw) as Device[]);
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(STORAGE, JSON.stringify(devices));
  }, [devices, loaded]);

  const issues = useMemo(() => analyze(devices), [devices]);
  const curves = TYPES.find((t) => t.value === form.type)?.curves ?? ["C"];

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

  function verdict(d: Device) {
    const rel = issues.filter((i) => i.up.id === d.id || i.down.id === d.id);
    if (!d.visible) return { label: "Oculto", tone: "muted" as const, detail: "" };
    if (rel.some((i) => i.severity === "cruce"))
      return { label: "No apto", tone: "bad" as const, detail: rel.find((i) => i.severity === "cruce")!.detail };
    if (rel.length) return { label: "Revisar", tone: "warn" as const, detail: rel[0]!.detail };
    return { label: "Apto", tone: "ok" as const, detail: "Selectivo con las demás protecciones cargadas." };
  }

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
          Cargá cada protección con su corriente nominal y curva de disparo. Las curvas se
          superponen en escala log-log y la app avisa si se cruzan o si falta margen entre aguas
          arriba y aguas abajo. Los datos de cable son informativos.
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
              <h2 className="text-sm font-semibold">Curvas de disparo (log-log)</h2>
              <div className="flex flex-wrap gap-3 text-[0.7rem]">
                {devices.filter((d) => d.visible).map((d) => (
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
              Verificación de selectividad{" "}
              <span
                className={`ml-1 rounded border px-2 py-0.5 text-[0.65rem] ${
                  issues.some((i) => i.severity === "cruce")
                    ? toneClass.bad
                    : issues.length
                      ? toneClass.warn
                      : toneClass.ok
                }`}
              >
                {issues.some((i) => i.severity === "cruce")
                  ? "Pérdida de selectividad"
                  : issues.length
                    ? "Margen ajustado"
                    : "Sin conflictos"}
              </span>
            </h2>
            {issues.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No se detectan cruces ni márgenes menores a 1,5× entre las protecciones cargadas.
              </p>
            ) : (
              <ul className="space-y-2">
                {issues.map((i, k) => (
                  <li
                    key={k}
                    className={`rounded-md border p-2.5 text-[0.72rem] leading-relaxed ${
                      i.severity === "cruce" ? toneClass.bad : toneClass.warn
                    }`}
                  >
                    <strong>
                      {i.up.name} (aguas arriba) vs {i.down.name} (aguas abajo)
                    </strong>
                    <br />
                    {i.detail}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel overflow-x-auto p-4">
            <h2 className="mb-3 text-sm font-semibold">Protecciones cargadas ({devices.length})</h2>
            {devices.length === 0 ? (
              <p className="text-xs text-muted-foreground">Todavía no cargaste equipos.</p>
            ) : (
              <table className="w-full min-w-[820px] text-left text-[0.72rem]">
                <thead className="text-[0.62rem] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2">Equipo</th>
                    <th className="py-2">Tipo</th>
                    <th className="py-2">In</th>
                    <th className="py-2">Curva</th>
                    <th className="py-2">kA</th>
                    <th className="py-2">Cable</th>
                    <th className="py-2">Estado</th>
                    <th className="py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {[...devices]
                    .sort((a, b) => b.In - a.In)
                    .map((d) => {
                      const v = verdict(d);
                      return (
                        <tr key={d.id} className="border-b border-border/50">
                          <td className="py-2">
                            <span className="flex items-center gap-2">
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: d.color }}
                              />
                              {d.name}
                            </span>
                          </td>
                          <td className="py-2 text-muted-foreground">
                            {TYPES.find((t) => t.value === d.type)?.label}
                          </td>
                          <td className="py-2">{d.In} A</td>
                          <td className="py-2">{d.curve}</td>
                          <td className="py-2">{d.kA}</td>
                          <td className="py-2 text-muted-foreground">
                            {d.section} mm² · {d.cableType === "unipolar" ? "uni" : "multi"} ·{" "}
                            {d.install === "aire" ? "aire" : "subt."} · Iz {d.cableIz} A
                          </td>
                          <td className="py-2">
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
                                onClick={() => {
                                  setDevices((ds) => ds.filter((x) => x.id !== d.id));
                                  if (editing === d.id) setEditing(null);
                                }}
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
