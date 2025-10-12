// mis-consultas.js (FIX: importar isUUID antes de usarla + fechas por defecto + logs)
import supabase from "./supabaseClient.js";
import { isUUID } from "./global.js";

const pad2 = n => (n < 10 ? "0" + n : "" + n);
const firstDayOfMonthISO = (d=new Date()) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-01`;
const todayISO = (d=new Date()) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

const NS = "[MisConsultas]";

export async function initMisConsultas(root){
  const $ = sel => (root || document).querySelector(sel);
  const dbg = $("#mc-debug");
  const log = (...a) => {
    console.log(NS, ...a);
    if (dbg) dbg.textContent += a.map(v => typeof v==="string" ? v : JSON.stringify(v,null,2)).join(" ") + "\n";
  };

  try {
    log("init");
    // Log de localStorage
    try {
      const snap = {};
      for (const k of Object.keys(localStorage)) snap[k]=localStorage.getItem(k);
      log("localStorage snapshot:", snap);
    } catch {}

    // --- Fechas por defecto SIEMPRE primero
    const inpDesde = $("#mc-desde");
    const inpHasta = $("#mc-hasta");
    if (inpDesde && !inpDesde.value) inpDesde.value = firstDayOfMonthISO();
    if (inpHasta && !inpHasta.value) inpHasta.value = todayISO();
    log("default dates:", { desde: inpDesde?.value, hasta: inpHasta?.value });

    // --- Resolver profesional
    log("resolveProfesionalId()");
    const profesionalId = await resolveProfesionalId(log);
    log("resolved profesionalId:", profesionalId);

    if (!profesionalId){
      $("#mc-out").innerHTML = `<div style="color:#b00020;">⚠️ No se pudo resolver <code>profesional_id</code>. Revisá el login o el vínculo con profesionales.</div>`;
      return;
    }

    // Handler
    $("#mc-refresh")?.addEventListener("click", () => refresh(profesionalId));

    // Primera carga
    await refresh(profesionalId);

  } catch (e) {
    console.warn(NS, "init error:", e);
    if (dbg) dbg.textContent += `INIT ERROR: ${e?.message||e}\n`;
  }

  // -------------------------
  async function refresh(profesionalId){
    const desde = ($("#mc-desde")?.value || firstDayOfMonthISO());
    const hasta = ($("#mc-hasta")?.value || todayISO());
    const out = $("#mc-out");
    const sum = $("#mc-summary");

    console.time(NS + " refresh");
    try {
      log("refresh params:", { desde, hasta, profesionalId });
      if (out) out.innerHTML = "Cargando…";
      if (sum) sum.innerHTML = "";

      // 1) Turnos del período (todos los centros) para el profesional
      const selectCols = `
        id, fecha, estado, copago, medio_pago, estado_pago, centro_id,
        pacientes(apellido, nombre)
      `;
      const { data: turnos = [], error: tErr } = await supabase
        .from("turnos")
        .select(selectCols)
        .eq("profesional_id", profesionalId)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha", { ascending: true });

      if (tErr) throw tErr;

      log(`turnos recibidos: ${turnos.length}`);
      if (turnos.length) log("sample turno[0]:", turnos[0]);

      // 2) Sumar pagos por turno
      const ids = [...new Set(turnos.map(t => t.id))];
      let pagosMap = {};
      if (ids.length){
        const { data: pagos = [], error: pErr } = await supabase
          .from("turnos_pagos")
          .select("turno_id, importe")
          .in("turno_id", ids);
        if (pErr) throw pErr;
        pagosMap = pagos.reduce((acc, r) => {
          acc[r.turno_id] = (acc[r.turno_id] || 0) + Number(r.importe || 0);
          return acc;
        }, {});
      }
      log("pagosMap size:", Object.keys(pagosMap).length);

      // 3) KPIs
      const sumCopago = turnos.reduce((a,t) => a + (Number(t.copago || 0)), 0);
      const sumPagado = ids.reduce((a,id) => a + (pagosMap[id] || 0), 0);
      const pendiente = Math.max(0, sumCopago - sumPagado);

      const atendidos = turnos.filter(t => t.estado === "atendido").length;
      const enEspera  = turnos.filter(t => t.estado === "en_espera").length;
      const cancelados= turnos.filter(t => t.estado === "cancelado").length;
      const asignados = turnos.filter(t => t.estado === "asignado" || t.estado === "confirmado").length;

      const money = n => new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(n||0);

      if (sum){
        const box = (label, val) => `<div style="padding:10px 12px;background:#fff;border:1px solid #eee;border-radius:10px;min-width:160px;"><div style="font-size:12px;color:#6b6480">${label}</div><div style="font-size:18px;font-weight:700;color:#381e60">${val}</div></div>`;
        sum.innerHTML =
          box("Consultas atendidas", atendidos) +
          box("Asignados/Confirmados", asignados) +
          box("En espera", enEspera) +
          box("Cancelados", cancelados) +
          box("Copagos del período", money(sumCopago)) +
          box("Pagado", money(sumPagado)) +
          box("Pendiente", money(pendiente));
      }

      // 4) Tabla detalle
      if ($("#mc-out")){
        const rows = turnos.map(t => {
          const pagado = pagosMap[t.id] || 0;
          const p = t.pacientes || {};
          const nom = [p.nombre, p.apellido].filter(Boolean).join(" ") || "—";
          return `
            <tr>
              <td>${t.fecha || "—"}</td>
              <td>${nom}</td>
              <td>${t.estado}</td>
              <td style="text-align:right">${money(t.copago || 0)}</td>
              <td style="text-align:right">${money(pagado)}</td>
            </tr>`;
        }).join("");

        $("#mc-out").innerHTML = `
          <table class="table" style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:#f6f3ff">
                <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Fecha</th>
                <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Paciente</th>
                <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Estado</th>
                <th style="text-align:right;padding:8px;border-bottom:1px solid #eee;">Copago</th>
                <th style="text-align:right;padding:8px;border-bottom:1px solid #eee;">Pagado</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="5" style="padding:10px;color:#6b6480;">Sin turnos en el período.</td></tr>`}
            </tbody>
          </table>`;
      }

      log("refresh OK");
    } catch (e) {
      console.warn(NS, "refresh error:", e);
      if ($("#mc-out")) $("#mc-out").innerHTML = `<div style="color:#b00020;">Error: ${e?.message||e}</div>`;
    } finally {
      console.timeEnd(NS + " refresh");
    }
  }
}

// ------------------------- helpers
async function resolveProfesionalId(log=()=>{}){
  // 1) ?prof=<uuid> en la URL (por si lo llamás directo)
  try {
    const qs = new URLSearchParams(location.search);
    const qp = qs.get("prof");
    if (qp && isUUID(qp)) {
      log("resolve by querystring ?prof:", qp);
      return qp;
    }
  } catch {}

  // 2) localStorage.professional_id (flujo normal)
  const ls = localStorage.getItem("profesional_id");
  if (ls && isUUID(ls)) {
    log("resolve by localStorage.profesional_id:", ls);
    return ls;
  }

  // 3) Fallback: si tenés profile_id en localStorage, buscá su profesional
  const profileId = localStorage.getItem("profile_id");
  if (profileId && isUUID(profileId)) {
    const { data: p, error } = await supabase
      .from("profesionales")
      .select("id")
      .eq("profile_id", profileId)
      .maybeSingle();
    if (!error && p?.id) {
      log("resolve by profesionales.profile_id:", p.id);
      return p.id;
    }
    log("fallback profesionales.profile_id error:", error);
  }

  log("resolveProfesionalId(): no encontrado");
  return null;
}
