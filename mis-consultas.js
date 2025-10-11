// mis-consultas.js — solo para MÉDICOS (corregido)
import supabase from "./supabaseClient.js";

export async function initMisConsultas(root){
  const $desde   = root.querySelector("#mc-desde");
  const $hasta   = root.querySelector("#mc-hasta");
  const $centro  = root.querySelector("#mc-centro");
  const $aplicar = root.querySelector("#mc-aplicar");
  const $export  = root.querySelector("#mc-export");

  const $tbody   = root.querySelector("#mc-tbody");
  const $kAt     = root.querySelector("#mc-kpi-atenciones");
  const $kIng    = root.querySelector("#mc-kpi-ingresos");
  const $kPen    = root.querySelector("#mc-kpi-pendiente");
  const $kTick   = root.querySelector("#mc-kpi-ticket");
  const $mediosBody = root.querySelector("#mc-medios-body");

  // 1) Resolver médico logueado de manera robusta
  const profesionalId = await resolveProfesionalId();
  if (!profesionalId){
    $tbody.innerHTML = rowInfo("No se pudo identificar al profesional logueado. Revisá login/permisos.", 6);
    return;
  }

  // 2) Rango por defecto: 1º del mes → hoy
  const { d1, d2 } = defaultRangeCurrentMonth();
  $desde.value = d1;
  $hasta.value = d2;

  // 3) Centros vinculados a ESTE médico
  const allowedCentroIds = await loadCentrosDelMedico(profesionalId, $centro);

  $aplicar.onclick = () => cargar();
  $centro.onchange = () => cargar();
  $export.onclick  = () => exportCSV();

  await cargar();

  async function cargar(){
    const d1 = $desde.value;
    const d2 = $hasta.value;
    const centroSel = ($centro.value || "").trim();

    $tbody.innerHTML = rowInfo("Cargando…", 6);
    $kAt.textContent = $kIng.textContent = $kPen.textContent = $kTick.textContent = "—";
    $mediosBody.innerHTML = rowMedio("—", "—", "—");

    try{
      // 1) Turnos del período (de este profesional)
      const selectCols = `
        id, fecha, paciente_id, centro_id, profesional_id, copago, importe, estado,
        pacientes(id, apellido, nombre),
        centros_medicos(id, nombre)
      `.replace(/\s+/g,' ');

      let qTurnos = supabase
        .from("turnos")
        .select(selectCols)
        .gte("fecha", d1).lte("fecha", d2)
        .eq("profesional_id", profesionalId)
        .not("paciente_id", "is", null)
        .neq("estado", "cancelado")
        .order("fecha", { ascending: false })
        .limit(5000);

      // Si selecciona 1 centro → filtro por ese
      if (centroSel) {
        qTurnos = qTurnos.eq("centro_id", centroSel);
      } else {
        // "Todos los centros": si tenemos lista, la uso; si no, NO agrego .in() (para no vaciar resultados)
        if (allowedCentroIds.length) {
          qTurnos = qTurnos.in("centro_id", allowedCentroIds);
        }
      }

      const { data: turnos = [], error: eT } = await qTurnos;
      if (eT) throw eT;

      const turnoIds = turnos.map(t => t.id);

      // 2) Pagos del PERÍODO (KPIs "Cobrado" y medios)
      const pagosPeriodoPorTurno = {};
      const pagosPeriodoPorMedio = {};
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

      // 3) Pagos TOTALES (históricos) para saldo pendiente real
      const pagosTotalesPorTurno = {};
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

      // Helpers p/ UI
      const nombreCentro = t => t?.centros_medicos?.nombre || "—";
      const nombrePaciente = t => {
        const p = t?.pacientes;
        return p ? `${(p.apellido||"").trim()}, ${(p.nombre||"").trim()}`.replace(/,\s*$/,"") || "—" : "—";
      };
      const esperado = t => { // copago si hay; si no, importe
        const c = Number(t?.copago ?? 0);
        const i = Number(t?.importe ?? 0);
        return isFinite(c) && c > 0 ? c : (isFinite(i) ? i : 0);
      };

      // KPIs
      const atenciones = turnos.length;
      const cobradoPeriodo = sum(Object.values(pagosPeriodoPorTurno));
      const pendiente = sum(turnos.map(t => Math.max(esperado(t) - (pagosTotalesPorTurno[t.id] || 0), 0)));
      const ticket = atenciones ? (cobradoPeriodo / atenciones) : 0;

      $kAt.textContent  = atenciones;
      $kIng.textContent = money(cobradoPeriodo);
      $kPen.textContent = money(pendiente);
      $kTick.textContent= atenciones ? money(ticket) : "—";

      // Detalle
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

      // Medios (en el período)
      const tot = cobradoPeriodo || 0;
      const medios = Object.entries(pagosPeriodoPorMedio).sort((a,b)=> b[1]-a[1]);
      $mediosBody.innerHTML = medios.length
        ? medios.map(([m, imp]) => rowMedio(ucfirst(m), money(imp), tot ? ((imp/tot)*100).toFixed(1)+"%" : "0.0%")).join("")
        : rowMedio("Sin datos.", "—", "—");

      // Export cache
      _export.rows = turnos.map(t => {
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
      _export.kpis = {
        Atenciones: atenciones,
        "Cobrado (período)": cobradoPeriodo,
        "Pendiente": pendiente,
        "Ticket promedio": ticket
      };

    } catch(e){
      console.error("[MisConsultas] error:", e);
      $tbody.innerHTML = rowInfo("Error: " + (e.message || String(e)), 6);
      $mediosBody.innerHTML = rowMedio("—", "—", "—");
    }
  }

  // === Resolución robusta del profesional logueado ===
  async function resolveProfesionalId(){
    let id = localStorage.getItem("profesional_id");
    if (isUUID(id)) return id;

    const profileId = localStorage.getItem("profile_id");
    if (isUUID(profileId)) {
      const { data, error } = await supabase
        .from("profesionales")
        .select("id")
        .eq("profile_id", profileId)
        .maybeSingle();
      if (data?.id) {
        localStorage.setItem("profesional_id", data.id);
        return data.id;
      }
    }

    const email = localStorage.getItem("user_email") || localStorage.getItem("user_mail");
    if (email) {
      const { data, error } = await supabase
        .from("profesionales")
        .select("id, email")
        .eq("email", email)
        .maybeSingle();
      if (data?.id) {
        localStorage.setItem("profesional_id", data.id);
        return data.id;
      }
    }
    return null;
  }

  // Centros vinculados a este médico (join como en tu inicio)
  async function loadCentrosDelMedico(profId, selectEl){
    const { data = [], error } = await supabase
      .from("profesional_centro")
      .select("centros_medicos(id, nombre)")
      .eq("profesional_id", profId)
      .eq("activo", true)
      .order("prioridad", { ascending: true });

    const ids = [];
    selectEl.innerHTML = `<option value="">Todos los centros</option>`;
    if (!error){
      const seen = new Set();
      for (const r of data){
        const c = r?.centros_medicos;
        if (!c?.id || seen.has(c.id)) continue;
        seen.add(c.id);
        ids.push(String(c.id));
        const opt = document.createElement("option");
        opt.value = String(c.id);
        opt.textContent = c.nombre || "(sin nombre)";
        selectEl.appendChild(opt);
      }
    }
    return ids;
  }

  // ==== Export CSV
  const _export = { rows: [], kpis: {} };
  function exportCSV(){
    if (!_export.rows.length){ alert("No hay datos para exportar."); return; }
    const lines = [];
    lines.push("KPIs");
    for (const [k,v] of Object.entries(_export.kpis)) lines.push(`${k};${formatCsvNum(v)}`);
    lines.push("");
    const headers = Object.keys(_export.rows[0]);
    lines.push(headers.join(";"));
    for (const r of _export.rows) lines.push(headers.map(h => csvCell(r[h])).join(";"));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url, download: `mis-consultas_${$desde.value}_${$hasta.value}.csv`
    });
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  // ==== Helpers
  function defaultRangeCurrentMonth(){ const n=new Date(); const f=new Date(n.getFullYear(),n.getMonth(),1); return { d1: iso(f), d2: iso(n) }; }
  const iso = d => new Date(d).toISOString().slice(0,10);
  const num = x => Number(x || 0);
  const sum = a => (a||[]).reduce((s,v)=> s + (Number(v)||0), 0);
  const money = n => Number(n||0).toLocaleString("es-AR",{ style:"currency", currency:"ARS", maximumFractionDigits:0 });
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fdate = iso => { try{ const d=new Date(iso+"T00:00:00"); return d.toLocaleDateString("es-AR"); }catch{return iso} };
  const ucfirst = s => (s = String(s||"")) ? s[0].toUpperCase()+s.slice(1) : s;
  const isUUID = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

  function rowInfo(msg, cols){ return `<tr><td colspan="${cols}" style="padding:12px;color:#6b6480;">${esc(msg)}</td></tr>`; }
  function rowDetalle({ fecha, centro, paciente, importe, pagado, pendiente }){
    return `<tr style="background:#fff;">
      <td style="padding:10px 8px;">${fdate(fecha)}</td>
      <td style="padding:10px 8px;">${esc(centro)}</td>
      <td style="padding:10px 8px;">${esc(paciente)}</td>
      <td style="padding:10px 8px; text-align:right;">${money(importe)}</td>
      <td style="padding:10px 8px; text-align:right;">${money(pagado)}</td>
      <td style="padding:10px 8px; text-align:right;">${money(pendiente)}</td>
    </tr>`;
  }
  function rowMedio(medio, imp, pct){ return `<tr><td style="padding:10px 8px;">${esc(medio)}</td><td style="padding:10px 8px;text-align:right;">${imp}</td><td style="padding:10px 8px;text-align:right;">${pct}</td></tr>`; }
  function csvCell(v){ if (typeof v === "number") return String(v).replace(".", ","); const s=String(v??""); return (/[;"\n]/.test(s)) ? `"${s.replace(/"/g,'""')}"` : s; }
  function formatCsvNum(v){ return (typeof v === "number") ? String(v).replace(".", ",") : String(v ?? ""); }
}
