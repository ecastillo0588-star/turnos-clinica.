// mis-consultas.js — versión con LOGS para debug
import supabase from "./supabaseClient.js";

export async function initMisConsultas(root){
  const TAG = "%c[MisConsultas]";
  const CSS = "color:#7656b0;font-weight:600";
  const warn = (...a)=> console.warn(TAG, CSS, ...a);
  const info = (...a)=> console.info(TAG, CSS, ...a);
  const log  = (...a)=> console.log(TAG, CSS, ...a);
  const err  = (...a)=> console.error(TAG, CSS, ...a);

  console.groupCollapsed(TAG, CSS, "init");
  try {
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

    // Snapshot útil del LS
    const LS = {
      profesional_id: localStorage.getItem("profesional_id"),
      profile_id:     localStorage.getItem("profile_id"),
      user_email:     localStorage.getItem("user_email") || localStorage.getItem("user_mail"),
      user_role:      localStorage.getItem("user_role")
    };
    log("localStorage snapshot:", LS);

    // 1) Resolver médico logueado de manera robusta
    console.groupCollapsed(TAG, CSS, "resolveProfesionalId()");
    const profesionalId = await resolveProfesionalId();
    console.groupEnd();
    log("profesionalId resuelto:", profesionalId);

    if (!profesionalId){
      $tbody.innerHTML = rowInfo("No se pudo identificar al profesional logueado. Revisá login/permisos.", 6);
      console.groupEnd();
      return;
    }

    // 2) Rango por defecto: 1º del mes → hoy
    const { d1, d2 } = defaultRangeCurrentMonth();
    $desde.value = d1;
    $hasta.value = d2;
    log("default range:", { d1, d2 });

    // 3) Centros vinculados a ESTE médico
    console.groupCollapsed(TAG, CSS, "loadCentrosDelMedico()");
    const allowedCentroIds = await loadCentrosDelMedico(profesionalId, $centro);
    console.groupEnd();
    log("centros vinculados (ids):", allowedCentroIds);

    $aplicar.onclick = () => cargar();
    $centro.onchange = () => cargar();
    $export.onclick  = () => exportCSV();

    // expos debug global
    window.__MC_DEBUG = { last: null };

    await cargar();

    async function cargar(){
      console.groupCollapsed(TAG, CSS, "cargar()");
      const d1 = $desde.value;
      const d2 = $hasta.value;
      const centroSel = ($centro.value || "").trim();
      log("params:", { d1, d2, centroSel, allowedCentroIds });

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

        if (centroSel) {
          qTurnos = qTurnos.eq("centro_id", centroSel);
        } else {
          if (allowedCentroIds.length) qTurnos = qTurnos.in("centro_id", allowedCentroIds);
        }

        console.time("[MC] turnos query");
        const { data: turnos = [], error: eT } = await qTurnos;
        console.timeEnd("[MC] turnos query");
        if (eT) throw eT;

        log("turnos count:", turnos.length);
        if (turnos.length) {
          // Muestra compacta de primeras 3 filas
          log("turnos sample (3):", turnos.slice(0,3).map(t => ({
            id: t.id, fecha: t.fecha, centro: t?.centros_medicos?.nombre,
            paciente: t?.pacientes ? `${t.pacientes.apellido}, ${t.pacientes.nombre}` : null,
            copago: t.copago, importe: t.importe, estado: t.estado
          })));
        }

        const turnoIds = turnos.map(t => t.id);

        // 2) Pagos del PERÍODO (KPIs "Cobrado" y medios)
        const pagosPeriodoPorTurno = {};
        const pagosPeriodoPorMedio = {};
        let pagosP = [];
        if (turnoIds.length){
          console.time("[MC] pagos periodo query");
          const resP = await supabase
            .from("turnos_pagos")
            .select("turno_id, importe, medio_pago, fecha")
            .in("turno_id", turnoIds)
            .gte("fecha", d1 + "T00:00:00")
            .lte("fecha", d2 + "T23:59:59");
          console.timeEnd("[MC] pagos periodo query");
          if (resP.error) throw resP.error;
          pagosP = resP.data || [];
          log("pagos (en período) count:", pagosP.length);

          for (const p of pagosP){
            const imp = num(p.importe);
            pagosPeriodoPorTurno[p.turno_id] = (pagosPeriodoPorTurno[p.turno_id] || 0) + imp;
            const medio = (p.medio_pago || "—").toLowerCase();
            pagosPeriodoPorMedio[medio] = (pagosPeriodoPorMedio[medio] || 0) + imp;
          }
        }

        // 3) Pagos TOTALES (históricos) para saldo pendiente real
        const pagosTotalesPorTurno = {};
        let pagosT = [];
        if (turnoIds.length){
          console.time("[MC] pagos totales query");
          const resT = await supabase
            .from("turnos_pagos")
            .select("turno_id, importe")
            .in("turno_id", turnoIds);
          console.timeEnd("[MC] pagos totales query");
          if (resT.error) throw resT.error;
          pagosT = resT.data || [];
          log("pagos (histórico) count:", pagosT.length);

          for (const p of pagosT){
            pagosTotalesPorTurno[p.turno_id] = (pagosTotalesPorTurno[p.turno_id] || 0) + num(p.importe);
          }
        }

        // Helpers
        const nombreCentro = t => t?.centros_medicos?.nombre || "—";
        const nombrePaciente = t => {
          const p = t?.pacientes;
          return p ? `${(p.apellido||"").trim()}, ${(p.nombre||"").trim()}`.replace(/,\s*$/,"") || "—" : "—";
        };
        const esperado = t => {
          const c = Number(t?.copago ?? 0);
          const i = Number(t?.importe ?? 0);
          return isFinite(c) && c > 0 ? c : (isFinite(i) ? i : 0);
        };

        // KPIs
        const atenciones = turnos.length;
        const cobradoPeriodo = sum(Object.values(pagosPeriodoPorTurno));
        const pendiente = sum(turnos.map(t => Math.max(esperado(t) - (pagosTotalesPorTurno[t.id] || 0), 0)));
        const ticket = atenciones ? (cobradoPeriodo / atenciones) : 0;

        log("KPIs:", { atenciones, cobradoPeriodo, pendiente, ticket });
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

        // Export cache + debug global
        const exportRows = turnos.map(t => {
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
        _export.rows = exportRows;
        _export.kpis = {
          Atenciones: atenciones,
          "Cobrado (período)": cobradoPeriodo,
          "Pendiente": pendiente,
          "Ticket promedio": ticket
        };

        window.__MC_DEBUG.last = {
          params: { d1, d2, centroSel, profesionalId, allowedCentroIds },
          turnosCount: turnos.length,
          pagosPeriodoCount: pagosP.length,
          pagosHistoricoCount: pagosT.length,
          sampleTurnos: turnos.slice(0,5),
          kpis: _export.kpis
        };
        log("DEBUG window.__MC_DEBUG.last:", window.__MC_DEBUG.last);

      } catch(e){
        err("Error en cargar():", e);
        $tbody.innerHTML = rowInfo("Error: " + (e.message || String(e)), 6);
        $mediosBody.innerHTML = rowMedio("—", "—", "—");
      } finally {
        console.groupEnd();
      }
    }

    // === Resolución robusta del profesional logueado ===
    async function resolveProfesionalId(){
      const tryLog = (label, v)=> log(`resolve by ${label}:`, v);

      let id = localStorage.getItem("profesional_id");
      tryLog("localStorage.profesional_id", id);
      if (isUUID(id)) return id;

      const profileId = localStorage.getItem("profile_id");
      tryLog("localStorage.profile_id", profileId);
      if (isUUID(profileId)) {
        console.time("[MC] profesionales by profile_id");
        const { data, error } = await supabase
          .from("profesionales")
          .select("id")
          .eq("profile_id", profileId)
          .maybeSingle();
        console.timeEnd("[MC] profesionales by profile_id");
        if (error) warn("profile_id lookup error:", error);
        if (data?.id) {
          localStorage.setItem("profesional_id", data.id);
          tryLog("resolved via profile_id → profesionales.id", data.id);
          return data.id;
        }
      }

      const email = localStorage.getItem("user_email") || localStorage.getItem("user_mail");
      tryLog("localStorage.email", email);
      if (email) {
        console.time("[MC] profesionales by email");
        const { data, error } = await supabase
          .from("profesionales")
          .select("id, email")
          .eq("email", email)
          .maybeSingle();
        console.timeEnd("[MC] profesionales by email");
        if (error) warn("email lookup error:", error);
        if (data?.id) {
          localStorage.setItem("profesional_id", data.id);
          tryLog("resolved via email → profesionales.id", data.id);
          return data.id;
        }
      }
      warn("No se pudo resolver profesional (ni por LS, ni profile_id, ni email).");
      return null;
    }

    // Centros vinculados a este médico
    async function loadCentrosDelMedico(profId, selectEl){
      console.time("[MC] centros del médico");
      const { data = [], error } = await supabase
        .from("profesional_centro")
        .select("centros_medicos(id, nombre)")
        .eq("profesional_id", profId)
        .eq("activo", true)
        .order("prioridad", { ascending: true });
      console.timeEnd("[MC] centros del médico");

      if (error) {
        warn("centros lookup error:", error);
      }

      const ids = [];
      const seen = new Set();
      selectEl.innerHTML = `<option value="">Todos los centros</option>`;
      for (const r of (data || [])){
        const c = r?.centros_medicos;
        if (!c?.id || seen.has(c.id)) continue;
        seen.add(c.id);
        ids.push(String(c.id));
        const opt = document.createElement("option");
        opt.value = String(c.id);
        opt.textContent = c.nombre || "(sin nombre)";
        selectEl.appendChild(opt);
      }
      log("centros cargados:", ids.length, ids);
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
      log("CSV exportado:", { rows: _export.rows.length, kpis: _export.kpis });
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
  } catch (e) {
    err("init error:", e);
  } finally {
    console.groupEnd();
  }
}
