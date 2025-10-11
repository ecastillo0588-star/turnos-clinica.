// mis-consultas.js
import supabase from "./supabaseClient.js";

export async function initMisConsultas(rootEl){
  // Refs UI
  const $desde   = rootEl.querySelector("#mc-desde");
  const $hasta   = rootEl.querySelector("#mc-hasta");
  const $centro  = rootEl.querySelector("#mc-centro");
  const $aplicar = rootEl.querySelector("#mc-aplicar");
  const $export  = rootEl.querySelector("#mc-export");

  const $tbody   = rootEl.querySelector("#mc-tbody");
  const $kAt     = rootEl.querySelector("#mc-kpi-atenciones");
  const $kIng    = rootEl.querySelector("#mc-kpi-ingresos");
  const $kPen    = rootEl.querySelector("#mc-kpi-pendiente");
  const $kTick   = rootEl.querySelector("#mc-kpi-ticket");

  const $mediosBody = rootEl.querySelector("#mc-medios-body");

  // ===== Defaults: 1er día de mes hasta hoy
  const { d1, d2 } = defaultRangeCurrentMonth();
  $desde.value = d1;
  $hasta.value = d2;

  // ===== Centros del profesional (independiente del dashboard)
  const profesionalId = (localStorage.getItem("profesional_id") || "").trim();
  if (!profesionalId){
    renderError("Falta <b>profesional_id</b> en la sesión.");
    return;
  }
  await loadCentrosForProfesional(profesionalId, $centro);

  // ===== Eventos
  $aplicar.onclick = () => cargar();
  $export.onclick  = () => exportCSV();

  // ===== 1ra carga
  await cargar();

  // ---------- Núcleo ----------
  async function cargar(){
    const d1 = $desde.value;
    const d2 = $hasta.value;
    const centroId = ($centro.value || "").trim(); // "" => todos

    // Reset UI
    $tbody.innerHTML = rowInfo("Cargando…", 6);
    $kAt.textContent = "—"; $kIng.textContent = "—"; $kPen.textContent = "—"; $kTick.textContent = "—";
    $mediosBody.innerHTML = rowMedio("Sin datos.", "—", "—");

    try {
      // 1) Turnos en período (profesional + [centro?]), excluye cancelados y bloqueados
      const selectCols = `
        id, fecha, paciente_id, centro_id, copago, importe, estado,
        pacientes(id, apellido, nombre),
        centros_medicos(id, nombre)
      `.replace(/\s+/g,' ');
      let q = supabase.from("turnos")
        .select(selectCols)
        .eq("profesional_id", profesionalId)
        .gte("fecha", d1).lte("fecha", d2)
        .not("paciente_id", "is", null)
        .neq("estado", "cancelado")
        .order("fecha", { ascending: false })
        .limit(2000);
      if (centroId) q = q.eq("centro_id", centroId);

      const { data: turnos = [], error: eT } = await q;
      if (eT) throw eT;

      const turnoIds = turnos.map(t => t.id);
      // Mapas para mostrar nombres
      const nombreCentro = t => t?.centros_medicos?.nombre || "—";
      const nombrePaciente = t => {
        const p = t?.pacientes;
        return p ? `${(p.apellido||"").trim()}, ${(p.nombre||"").trim()}`.replace(/,\s*$/, "") || "—" : "—";
      };
      // Importe esperado: copago>importe>0
      const esperado = t => {
        const c = Number(t?.copago ?? 0);
        const i = Number(t?.importe ?? 0);
        return isFinite(c) && c > 0 ? c : (isFinite(i) ? i : 0);
      };

      // 2) Pagos del período (para KPI "Cobrado" y desglose por medio)
      let pagosPeriodoPorTurno = {};
      let pagosPeriodoPorMedio = {};
      if (turnoIds.length){
        const { data: pagosP = [], error: eP } = await supabase
          .from("turnos_pagos")
          .select("turno_id, importe, medio_pago, fecha")
          .in("turno_id", turnoIds)
          .gte("fecha", d1 + "T00:00:00")
          .lte("fecha", d2 + "T23:59:59");
        if (eP) throw eP;

        for (const p of pagosP){
          const imp = num(p.importe);
          pagosPeriodoPorTurno[p.turno_id] = (pagosPeriodoPorTurno[p.turno_id] || 0) + imp;
          const medio = (p.medio_pago || "—").toLowerCase();
          pagosPeriodoPorMedio[medio] = (pagosPeriodoPorMedio[medio] || 0) + imp;
        }
      }

      // 3) Pagos totales (para "Pagado" y cálculo de "Pendiente" real)
      let pagosTotalesPorTurno = {};
      if (turnoIds.length){
        const { data: pagosT = [], error: ePT } = await supabase
          .from("turnos_pagos")
          .select("turno_id, importe")
          .in("turno_id", turnoIds);
        if (ePT) throw ePT;

        for (const p of pagosT){
          pagosTotalesPorTurno[p.turno_id] = (pagosTotalesPorTurno[p.turno_id] || 0) + num(p.importe);
        }
      }

      // KPIs
      const atenciones = turnos.length;
      const cobradoPeriodo = sum(Object.values(pagosPeriodoPorTurno));
      const pendiente = sum(turnos.map(t => {
        const exp = esperado(t);
        const pag = pagosTotalesPorTurno[t.id] || 0;
        return Math.max(exp - pag, 0);
      }));
      const ticket = atenciones > 0 ? (cobradoPeriodo / atenciones) : 0;

      $kAt.textContent  = atenciones;
      $kIng.textContent = money(cobradoPeriodo);
      $kPen.textContent = money(pendiente);
      $kTick.textContent= atenciones ? money(ticket) : "—";

      // Tabla principal
      if (!turnos.length){
        $tbody.innerHTML = rowInfo("Sin resultados para el rango/centro seleccionado.", 6);
      } else {
        $tbody.innerHTML = turnos.map(t => {
          const exp = esperado(t);
          const pagTot = pagosTotalesPorTurno[t.id] || 0;
          const pen = Math.max(exp - pagTot, 0);
          return rowDetalle({
            fecha: t.fecha,
            centro: nombreCentro(t),
            paciente: nombrePaciente(t),
            importe: exp,
            pagado: pagTot,
            pendiente: pen
          });
        }).join("");
      }

      // Desglose por medio de pago (del período)
      const totalPeriodo = cobradoPeriodo || 0;
      const medios = Object.entries(pagosPeriodoPorMedio)
        .sort((a,b)=> b[1]-a[1]);
      if (!medios.length){
        $mediosBody.innerHTML = rowMedio("Sin datos.", "—", "—");
      } else {
        $mediosBody.innerHTML = medios.map(([medio, imp]) => {
          const pct = totalPeriodo ? ((imp / totalPeriodo) * 100) : 0;
          return rowMedio(ucfirst(medio), money(imp), pct.toFixed(1) + "%");
        }).join("");
      }

      // Guarda dataset para export
      _exportCache.rows = turnos.map(t => {
        const exp = esperado(t);
        const pagTot = pagosTotalesPorTurno[t.id] || 0;
        const pen = Math.max(exp - pagTot, 0);
        return {
          Fecha: t.fecha,
          Centro: nombreCentro(t),
          Paciente: nombrePaciente(t),
          "Importe esperado": exp,
          "Pagado total": pagTot,
          "Pendiente": pen
        };
      });
      _exportCache.kpis = {
        Atenciones: atenciones,
        "Cobrado (período)": cobradoPeriodo,
        "Pendiente": pendiente,
        "Ticket promedio": ticket
      };

    } catch (e){
      console.error("[MisConsultas] error:", e);
      renderError(e.message || String(e));
    }
  }

  // ---------- Export ----------
  const _exportCache = { rows: [], kpis: {} };
  function exportCSV(){
    if (!_exportCache.rows.length){
      alert("No hay datos para exportar.");
      return;
    }
    const lines = [];
    // Encabezado KPIs
    lines.push("KPIs");
    for (const [k,v] of Object.entries(_exportCache.kpis)){
      lines.push(`${k};${formatCsvNum(v)}`);
    }
    lines.push(""); // blank
    // Encabezado tabla
    const headers = Object.keys(_exportCache.rows[0]);
    lines.push(headers.join(";"));
    // Filas
    for (const r of _exportCache.rows){
      lines.push(headers.map(h => formatCsvCell(r[h])).join(";"));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mis-consultas_${$desde.value}_${$hasta.value}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  // ---------- Helpers ----------
  function defaultRangeCurrentMonth(){
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return { d1: toISO(first), d2: toISO(now) };
  }
  function toISO(d){ return new Date(d).toISOString().slice(0,10); }
  function num(x){ return Number(x || 0); }
  function sum(arr){ return (arr||[]).reduce((a,b)=> a + (Number(b)||0), 0); }
  function money(n){ return Number(n||0).toLocaleString("es-AR",{ style:"currency", currency:"ARS" }); }
  function escapeHtml(s){ return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function rowInfo(msg, cols){
    return `<tr><td colspan="${cols}" style="padding:12px;color:#6b6480;">${escapeHtml(msg)}</td></tr>`;
  }
  function rowDetalle({ fecha, centro, paciente, importe, pagado, pendiente }){
    return `
      <tr style="background:#fff;">
        <td style="padding:10px 8px;">${formatDate(fecha)}</td>
        <td style="padding:10px 8px;">${escapeHtml(centro)}</td>
        <td style="padding:10px 8px;">${escapeHtml(paciente)}</td>
        <td style="padding:10px 8px; text-align:right;">${money(importe)}</td>
        <td style="padding:10px 8px; text-align:right;">${money(pagado)}</td>
        <td style="padding:10px 8px; text-align:right;">${money(pendiente)}</td>
      </tr>`;
  }
  function rowMedio(medio, importeTxt, pctTxt){
    return `
      <tr style="background:#fff;">
        <td style="padding:10px 8px;">${escapeHtml(medio)}</td>
        <td style="padding:10px 8px; text-align:right;">${importeTxt}</td>
        <td style="padding:10px 8px; text-align:right;">${pctTxt}</td>
      </tr>`;
  }
  function formatDate(iso){
    try{ const d=new Date(iso+"T00:00:00"); return d.toLocaleDateString("es-AR"); }catch{return iso}
  }
  function ucfirst(s){ s=String(s||""); return s.charAt(0).toUpperCase()+s.slice(1); }
  function formatCsvCell(v){
    if (typeof v === "number") return String(v).replace(".", ",");
    const s = String(v ?? "");
    if (s.includes(";") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g,'""')}"`;
    }
    return s;
  }
  function formatCsvNum(v){
    return (typeof v === "number") ? String(v).replace(".", ",") : String(v ?? "");
  }
  function renderError(msg){
    $tbody.innerHTML = rowInfo(`Error: ${msg}`, 6);
    $mediosBody.innerHTML = rowMedio("—", "—", "—");
  }

  async function loadCentrosForProfesional(profId, selectEl){
    // Trae centros activos del profesional
    const { data = [], error } = await supabase
      .from("profesional_centro")
      .select("centro_id, centros_medicos!inner(id, nombre)")
      .eq("profesional_id", profId)
      .eq("activo", true)
      .order("prioridad", { ascending: true });

    if (error) {
      console.warn("[MisConsultas] centros error:", error);
      return; // dejamos sólo "Todos los centros"
    }
    // Limpia y pone “Todos”
    selectEl.innerHTML = `<option value="">Todos los centros</option>`;
    // Agrega opciones
    const seen = new Set();
    for (const r of (data || [])){
      const c = r?.centros_medicos;
      if (!c?.id || seen.has(c.id)) continue;
      seen.add(c.id);
      const opt = document.createElement("option");
      opt.value = String(c.id);
      opt.textContent = c.nombre || "(sin nombre)";
      selectEl.appendChild(opt);
    }
  }
}
