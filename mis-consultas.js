// mis-consultas.js
import supabase from "./supabaseClient.js";

export function initMisConsultas(rootEl){
  // Fechas por defecto: últimos 30 días
  const hoy = new Date();
  const desde = new Date(hoy); desde.setDate(hoy.getDate() - 30);

  const $desde = rootEl.querySelector("#mc-desde");
  const $hasta = rootEl.querySelector("#mc-hasta");
  const $aplicar = rootEl.querySelector("#mc-aplicar");
  const $tbody = rootEl.querySelector("#mc-tbody");
  const $kAt = rootEl.querySelector("#mc-kpi-atenciones");
  const $kIng = rootEl.querySelector("#mc-kpi-ingresos");
  const $kPen = rootEl.querySelector("#mc-kpi-pendiente");
  const $centroLabel = rootEl.querySelector("#mc-centro-label");

  $desde.value = isoDate(desde);
  $hasta.value = isoDate(hoy);
  $centroLabel.textContent = localStorage.getItem("centro_medico_nombre") || "—";

  // recarga cuando cambie el centro
  window.addEventListener("centro-cambiado", (ev) => {
    $centroLabel.textContent = ev?.detail?.nombre || localStorage.getItem("centro_medico_nombre") || "—";
    cargar();
  });

  $aplicar.onclick = () => cargar();

  // primera carga
  cargar();

  async function cargar(){
    const profesionalId = localStorage.getItem("profesional_id");
    const centroId = localStorage.getItem("centro_medico_id");
    const d1 = $desde.value;
    const d2 = $hasta.value;

    if (!profesionalId || !centroId){
      renderError("Falta profesional o centro en sesión.");
      return;
    }

    // Limpio UI
    $tbody.innerHTML = `<tr><td colspan="5" style="padding:12px;color:#6b6480;">Cargando…</td></tr>`;
    $kAt.textContent = "—"; $kIng.textContent = "—"; $kPen.textContent = "—";

    try {
      // 1) Turnos del período para este profesional y centro
      const { data: turnos, error: e1 } = await supabase
        .from("turnos")
        .select("id, fecha, paciente_id, importe")
        .eq("profesional_id", profesionalId)
        .eq("centro_id", centroId)
        .gte("fecha", d1).lte("fecha", d2)
        .not("paciente_id", "is", null)          // excluye bloqueados
        .order("fecha", { ascending: false })
        .limit(500);
      if (e1) throw e1;

      const turnoIds = (turnos || []).map(t => t.id);
      const pacienteIds = uniq((turnos || []).map(t => t.paciente_id).filter(Boolean));

      // 2) Pagos del período sobre esos turnos (fecha de pago en el rango)
      let pagosPorTurno = {};
      if (turnoIds.length){
        const { data: pagos, error: e2 } = await supabase
          .from("turnos_pagos")
          .select("turno_id, importe, fecha")
          .in("turno_id", turnoIds)
          .gte("fecha", d1 + "T00:00:00")  // timestamptz
          .lte("fecha", d2 + "T23:59:59");
        if (e2) throw e2;

        pagosPorTurno = (pagos || []).reduce((acc, p) => {
          acc[p.turno_id] = (acc[p.turno_id] || 0) + Number(p.importe || 0);
          return acc;
        }, {});
      }

      // 3) Nombres de pacientes
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
      const ingresos = sum(turnos?.map(t => pagosPorTurno[t.id] || 0));
      const pendiente = sum(turnos?.map(t => Math.max(Number(t.importe || 0) - (pagosPorTurno[t.id] || 0), 0)));

      $kAt.textContent = atenciones;
      $kIng.textContent = money(ingresos);
      $kPen.textContent = money(pendiente);

      // Tabla
      if (!turnos || turnos.length === 0){
        $tbody.innerHTML = `<tr><td colspan="5" style="padding:12px;color:#6b6480;">Sin resultados para el rango seleccionado.</td></tr>`;
      } else {
        $tbody.innerHTML = turnos.map(t => {
          const nombre = pacientesById[t.paciente_id] || "—";
          const imp = Number(t.importe || 0);
          const pag = Number(pagosPorTurno[t.id] || 0);
          const pen = Math.max(imp - pag, 0);
          return tr({ fecha: t.fecha, paciente: nombre, importe: imp, pagado: pag, pendiente: pen });
        }).join("");
      }
    } catch (e){
      console.error(e);
      renderError(e.message || String(e));
    }
  }

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

  // Utils
  function isoDate(d){ return new Date(d).toISOString().slice(0,10); }
  function formatDate(iso){ try{ const d=new Date(iso+"T00:00:00"); return d.toLocaleDateString(); }catch{return iso} }
  function sum(arr){ return (arr||[]).reduce((a,b)=> a + (Number(b)||0), 0); }
  function money(n){ return Number(n||0).toLocaleString(undefined,{ style:"currency", currency:"ARS" }); }
  function uniq(arr){ return [...new Set(arr)]; }
  function escapeHtml(s){ return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
}
