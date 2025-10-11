// mis-consultas.js
import supabase from "./supabaseClient.js";

export function initMisConsultas(rootEl){
  console.debug("[MisConsultas] init");

  // ===== UI bootstrap (si el HTML es mínimo, inyectamos toda la vista)
  if (!rootEl.querySelector("#mc-desde")) {
    rootEl.innerHTML = `
      <section class="mis-consultas">
        <header style="display:flex; gap:12px; align-items:end; flex-wrap:wrap; margin-bottom:18px;">
          <div>
            <h2 style="margin:0; color:#381e60;">Mis Consultas</h2>
            <small style="color:#6b6480;">Consultas, cobranzas e indicadores por período</small>
          </div>
          <div style="margin-left:auto; display:flex; gap:8px; align-items:center;">
            <label>Desde <input id="mc-desde" type="date"></label>
            <label>Hasta <input id="mc-hasta" type="date"></label>
            <button id="mc-aplicar" class="settings-btn" style="width:auto;padding:8px 14px;">Aplicar</button>
          </div>
        </header>

        <div id="mc-kpis" style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:16px;">
          <div class="card"><div><b>Atenciones</b></div><div id="mc-kpi-atenciones" style="font-size:22px;">—</div></div>
          <div class="card"><div><b>Ingresos (pagos del período)</b></div><div id="mc-kpi-ingresos" style="font-size:22px;">—</div></div>
          <div class="card"><div><b>Pendiente (sobre turnos del período)</b></div><div id="mc-kpi-pendiente" style="font-size:22px;">—</div></div>
        </div>

        <div class="card">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <b>Atenciones</b>
            <span style="margin-left:auto;color:#6b6480;font-size:13px;">
              Centro: <span id="mc-centro-label">—</span>
            </span>
          </div>
          <div style="overflow:auto;">
            <table id="mc-tabla" style="width:100%; border-collapse:separate; border-spacing:0 6px;">
              <thead style="color:#6b6480; font-size:14px;">
                <tr>
                  <th style="text-align:left;">Fecha</th>
                  <th style="text-align:left;">Paciente</th>
                  <th style="text-align:right;">Importe</th>
                  <th style="text-align:right;">Pagado</th>
                  <th style="text-align:right;">Pendiente</th>
                </tr>
              </thead>
              <tbody id="mc-tbody">
                <tr><td colspan="5" style="padding:12px;color:#6b6480;">Elegí un período y presioná “Aplicar”.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }

  // ===== refs
  const $desde = rootEl.querySelector("#mc-desde");
  const $hasta = rootEl.querySelector("#mc-hasta");
  const $aplicar = rootEl.querySelector("#mc-aplicar");
  const $tbody = rootEl.querySelector("#mc-tbody");
  const $kAt = rootEl.querySelector("#mc-kpi-atenciones");
  const $kIng = rootEl.querySelector("#mc-kpi-ingresos");
  const $kPen = rootEl.querySelector("#mc-kpi-pendiente");
  const $centroLabel = rootEl.querySelector("#mc-centro-label");

  // Fechas por defecto: últimos 30 días
  const hoy = new Date();
  const desde = new Date(hoy); desde.setDate(hoy.getDate() - 30);
  if (!$desde.value) $desde.value = isoDate(desde);
  if (!$hasta.value) $hasta.value = isoDate(hoy);

  // Centro label inicial
  $centroLabel.textContent = localStorage.getItem("centro_medico_nombre") || "—";

  // Escucha cambios de centro desde la sidebar
  window.addEventListener("centro-cambiado", (ev) => {
    $centroLabel.textContent = ev?.detail?.nombre || localStorage.getItem("centro_medico_nombre") || "—";
    cargar();
  });

  $aplicar.onclick = () => cargar();

  // Primera carga
  cargar();

  // ===== núcleo
  async function cargar(){
    const profesionalId = (localStorage.getItem("profesional_id") || "").trim();
    let centroId = (localStorage.getItem("centro_medico_id") || "").trim();
    const d1 = $desde.value; // yyyy-mm-dd
    const d2 = $hasta.value; // yyyy-mm-dd

    console.debug("[MisConsultas] sesión", { profesionalId, centroId, d1, d2 });

    // Fallback de centro: toma el primer centro activo del profesional
    if (!centroId && profesionalId){
      try {
        const { data: pcs, error: ePc } = await supabase
          .from("profesional_centro")
          .select("centro_id, centros_medicos!inner(id, nombre)")
          .eq("profesional_id", profesionalId)
          .eq("activo", true)
          .limit(1);
        if (ePc) throw ePc;
        if (pcs && pcs.length){
          centroId = pcs[0].centro_id;
          const nombreCentro = pcs[0]?.centros_medicos?.nombre || "—";
          localStorage.setItem("centro_medico_id", centroId);
          localStorage.setItem("centro_medico_nombre", nombreCentro);
          $centroLabel.textContent = nombreCentro;
          window.dispatchEvent(new CustomEvent("centro-cambiado", { detail: { id: centroId, nombre: nombreCentro } }));
          console.debug("[MisConsultas] fallback centro", { centroId, nombreCentro });
        }
      } catch (e){
        console.warn("[MisConsultas] fallback centro error", e);
      }
    }

    if (!profesionalId){
      renderError("No se encontró <b>profesional_id</b> en la sesión.");
      return;
    }
    if (!centroId){
      renderError("No se encontró un <b>centro</b> activo para este profesional.");
      return;
    }

    // Limpio UI
    $tbody.innerHTML = `<tr><td colspan="5" style="padding:12px;color:#6b6480;">Cargando…</td></tr>`;
    $kAt.textContent = "—"; $kIng.textContent = "—"; $kPen.textContent = "—";

    try {
      // 1) Turnos del período (excluye bloqueados porque requieren paciente_id NULL)
      const { data: turnos, error: e1 } = await supabase
        .from("turnos")
        .select("id, fecha, paciente_id, importe")
        .eq("profesional_id", profesionalId)
        .eq("centro_id", centroId)
        .gte("fecha", d1).lte("fecha", d2)
        .not("paciente_id", "is", null)
        .order("fecha", { ascending: false })
        .limit(1000);
      if (e1) throw e1;
      console.debug("[MisConsultas] turnos", turnos?.length || 0);

      const turnoIds = (turnos || []).map(t => t.id);
      const pacienteIds = uniq((turnos || []).map(t => t.paciente_id).filter(Boolean));

      // 2a) Pagos del período (para KPI "Ingresos")
      let pagosPeriodoPorTurno = {};
      if (turnoIds.length){
        const { data: pagosP, error: e2a } = await supabase
          .from("turnos_pagos")
          .select("turno_id, importe, fecha")
          .in("turno_id", turnoIds)
          .gte("fecha", d1 + "T00:00:00")
          .lte("fecha", d2 + "T23:59:59");
        if (e2a) throw e2a;
        pagosPeriodoPorTurno = (pagosP || []).reduce((acc, p) => {
          acc[p.turno_id] = (acc[p.turno_id] || 0) + num(p.importe);
          return acc;
        }, {});
        console.debug("[MisConsultas] pagos (en período)", Object.keys(pagosPeriodoPorTurno).length);
      }

      // 2b) Pagos totales por turno (para calcular "Pendiente" real de esos turnos)
      let pagosTotalesPorTurno = {};
      if (turnoIds.length){
        const { data: pagosT, error: e2b } = await supabase
          .from("turnos_pagos")
          .select("turno_id, importe")
          .in("turno_id", turnoIds);
        if (e2b) throw e2b;
        pagosTotalesPorTurno = (pagosT || []).reduce((acc, p) => {
          acc[p.turno_id] = (acc[p.turno_id] || 0) + num(p.importe);
          return acc;
        }, {});
      }

      // 3) Pacientes (nombre/apellido)
      let pacientesById = {};
      if (pacienteIds.length){
        const { data: pacientes, error: e3 } = await supabase
          .from("pacientes")
          .select("id, apellido, nombre")
          .in("id", pacienteIds);
        if (e3) throw e3;
        pacientesById = Object.fromEntries((pacientes || []).map(p => [p.id, `${p.apellido}, ${p.nombre}`]));
      }

      // KPIs
      const atenciones = turnos?.length || 0;
      const ingresosPeriodo = sum(turnos?.map(t => pagosPeriodoPorTurno[t.id] || 0));
      const pendiente = sum(turnos?.map(t => {
        const imp = num(t.importe);
        const pagTotal = pagosTotalesPorTurno[t.id] || 0;
        return Math.max(imp - pagTotal, 0);
      }));

      $kAt.textContent = atenciones;
      $kIng.textContent = money(ingresosPeriodo);
      $kPen.textContent = money(pendiente);

      // Tabla
      if (!turnos || turnos.length === 0){
        $tbody.innerHTML = `<tr><td colspan="5" style="padding:12px;color:#6b6480;">Sin resultados para el rango seleccionado.</td></tr>`;
      } else {
        $tbody.innerHTML = turnos.map(t => {
          const nombre = pacientesById[t.paciente_id] || "—";
          const imp = num(t.importe);
          const pagTotal = pagosTotalesPorTurno[t.id] || 0;
          const pen = Math.max(imp - pagTotal, 0);
          return tr({ fecha: t.fecha, paciente: nombre, importe: imp, pagado: pagTotal, pendiente: pen });
        }).join("");
      }
    } catch (e){
      console.error(e);
      renderError(e.message || String(e));
    }
  }

  // ===== helpers de render
  function tr({ fecha, paciente, importe, pagado, pendiente }){
    return `
      <tr style="background:#fff;">
        <td style="padding:10px 8px;">${formatDate(fecha)}</td>
        <td style="padding:10px 8px;">${escapeHtml(paciente)}</td>
        <td style="padding:10px 8px; text-align:right;">${money(importe)}</td>
        <td style="padding:10px 8px; text-align:right;">${money(pagado)}</td>
        <td style="padding:10px 8px; text-align:right;">${money(pendiente)}</td>
      </tr>`;
  }

  function renderError(msg){
    $tbody.innerHTML = `<tr><td colspan="5" style="padding:12px;color:#b00020;">Error: ${escapeHtml(msg)}</td></tr>`;
  }

  // ===== utils
  function isoDate(d){ return new Date(d).toISOString().slice(0,10); }
  function formatDate(iso){ try{ const d=new Date(iso+"T00:00:00"); return d.toLocaleDateString(); }catch{return iso} }
  function sum(arr){ return (arr||[]).reduce((a,b)=> a + (Number(b)||0), 0); }
  function num(x){ return Number(x || 0); }
  function money(n){ return Number(n||0).toLocaleString(undefined,{ style:"currency", currency:"ARS" }); }
  function uniq(arr){ return [...new Set(arr)]; }
  function escapeHtml(s){ return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
}
