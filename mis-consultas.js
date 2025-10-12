// mis-consultas.js
// =======================
// Panel "Mis Consultas"
// =======================
import supabase from './supabaseClient.js';

// ---------- Helpers de log ----------
const TAG = '[MisConsultas]';
const log  = (...a) => console.log(TAG, ...a);
const warn = (...a) => console.warn(TAG, ...a);
const err  = (...a) => console.error(TAG, ...a);

// ---------- Helpers básicos ----------
const pad2 = n => (n < 10 ? '0' + n : '' + n);

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function isoFirstDayOfMonth(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function isUUID(v) {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function money(n) {
  const val = Number(n || 0);
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0
  }).format(isFinite(val) ? val : 0);
}

function toPeso(n) {
  if (n === null || n === undefined) return 0;
  const x = Number(n);
  return isFinite(x) ? x : 0;
}

// ---------- Estado interno ----------
let E = {
  root: null,
  el: {
    desde: null, hasta: null, centro: null, refresh: null,
    kpiConsultas: null, kpiCobrado: null, kpiPendiente: null,
    legend: null, tbody: null, empty: null
  },
  profesionalId: null
};

// ---------- Carga centros del profesional ----------
async function loadCentrosDelProfesional(profesionalId) {
  const sel = E.el.centro;
  if (!sel || !profesionalId) return;

  sel.innerHTML = `<option value="">Todos los centros</option>`;
  let centros = [];
  try {
    // Join directo
    const { data, error } = await supabase
      .from('profesional_centro')
      .select('centro_id, centros_medicos(id,nombre)')
      .eq('profesional_id', profesionalId)
      .eq('activo', true);

    if (!error) {
      centros = (data || []).map(r => r.centros_medicos).filter(Boolean);
    } else {
      warn('join centros_medicos error:', error);
    }

    // Fallback: doble llamada
    if (!centros.length) {
      const { data: links = [] } = await supabase
        .from('profesional_centro')
        .select('centro_id')
        .eq('profesional_id', profesionalId)
        .eq('activo', true);

      const ids = [...new Set(links.map(x => x.centro_id).filter(Boolean))];
      if (ids.length) {
        const { data: cms = [] } = await supabase
          .from('centros_medicos')
          .select('id,nombre')
          .in('id', ids)
          .order('nombre', { ascending: true });
        centros = cms;
      }
    }

    // De-dup + orden
    const seen = new Set();
    const final = [];
    for (const c of centros) {
      if (!c?.id || seen.has(String(c.id))) continue;
      seen.add(String(c.id));
      final.push(c);
    }
    final.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

    // Pintar opciones
    for (const c of final) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.nombre || c.id;
      sel.appendChild(opt);
    }

    log('centros cargados:', final.length);
  } catch (e) {
    err('loadCentrosDelProfesional error:', e);
  }
}

// ---------- Datos ----------
async function fetchTurnos({ desde, hasta, profesionalId, centroId = null }) {
  let q = supabase
    .from('turnos')
    .select(`
      id, fecha, hora_inicio, hora_fin, estado, copago, centro_id,
      pacientes(id, apellido, nombre),
      centros_medicos(id, nombre)
    `)
    .eq('profesional_id', profesionalId)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: true })
    .order('hora_inicio', { ascending: true });

  if (centroId) q = q.eq('centro_id', centroId);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function fetchPagosMap(turnoIds = []) {
  const ids = [...new Set(turnoIds)].filter(Boolean);
  if (!ids.length) return {};
  const { data = [], error } = await supabase
    .from('turnos_pagos')
    .select('turno_id, importe');
  if (error) throw error;

  const map = {};
  for (const r of data) {
    const id = r.turno_id;
    if (!ids.includes(id)) continue; // reducir a los turnos de la vista
    map[id] = (map[id] || 0) + toPeso(r.importe);
  }
  return map;
}

// ---------- Render ----------
function renderEmpty(msg = 'Sin resultados en el período') {
  if (E.el.tbody) E.el.tbody.innerHTML = '';
  if (E.el.empty) {
    E.el.empty.style.display = '';
    E.el.empty.textContent = msg;
  }
}

function renderTable(turnos, pagosMap) {
  const tbody = E.el.tbody;
  if (!tbody) return;

  if (!turnos.length) {
    renderEmpty();
    return;
  }
  if (E.el.empty) E.el.empty.style.display = 'none';

  const rows = turnos.map(t => {
    const p = t.pacientes || {};
    const paciente = [p.apellido, p.nombre].filter(Boolean).join(', ') || '—';
    const fecha = t.fecha || '—';
    const hora = String(t.hora_inicio || '').slice(0,5) || '—';
    const centro = t.centros_medicos?.nombre || '—';
    const estado = String(t.estado || '—').replaceAll('_', ' ');
    const copago = toPeso(t.copago);
    const pagado = toPeso(pagosMap[t.id] || 0);

    return `
      <tr>
        <td>${fecha}</td>
        <td>${hora}</td>
        <td>${centro}</td>
        <td>${paciente}</td>
        <td>${estado}</td>
        <td style="text-align:right;">${money(copago)}</td>
        <td style="text-align:right;">${money(pagado)}</td>
      </tr>
    `;
  }).join('');

  tbody.innerHTML = rows;
}

function renderKPIs(turnos, pagosMap) {
  const totalAtendidos = turnos.filter(t => t.estado === 'atendido').length;
  const totalCopagos = turnos.reduce((acc, t) => acc + toPeso(t.copago), 0);
  const totalPagos = Object.values(pagosMap).reduce((a, b) => a + toPeso(b), 0);
  const totalPend = Math.max(0, totalCopagos - totalPagos);

  if (E.el.kpiConsultas) E.el.kpiConsultas.textContent = `${totalAtendidos} atendidas`;
  if (E.el.kpiCobrado)   E.el.kpiCobrado.textContent   = money(totalPagos);
  if (E.el.kpiPendiente) E.el.kpiPendiente.textContent = money(totalPend);
}

function renderLegend() {
  if (!E.el.legend) return;
  const desde = E.el.desde?.value || '—';
  const hasta = E.el.hasta?.value || '—';
  const centroSel = E.el.centro?.selectedOptions?.[0]?.textContent || 'Todos los centros';
  E.el.legend.textContent = `${centroSel} · ${desde} → ${hasta}`;
}

// ---------- Refresh principal ----------
async function refresh() {
  try {
    const desde = E.el.desde?.value || isoFirstDayOfMonth();
    const hasta = E.el.hasta?.value || isoToday();
    const centroId = (E.el.centro?.value || '').trim() || null;

    if (!E.profesionalId) {
      renderEmpty('No se detectó el profesional logueado.');
      return;
    }

    log('refresh params:', { desde, hasta, profesionalId: E.profesionalId, centroId });
    console.time(`${TAG} refresh`);

    const turnos = await fetchTurnos({
      desde, hasta, profesionalId: E.profesionalId, centroId
    });
    log('turnos recibidos:', turnos.length);

    const pagosMap = await fetchPagosMap(turnos.map(t => t.id));
    log('pagosMap size:', Object.keys(pagosMap).length);

    renderKPIs(turnos, pagosMap);
    renderTable(turnos, pagosMap);
    renderLegend();

    console.timeEnd(`${TAG} refresh`);
  } catch (e) {
    err('refresh error:', e);
    renderEmpty('Error cargando datos.');
  }
}

// ---------- Resolver profesional ----------
function resolveProfesionalId() {
  const ls = {
    profesional_id: localStorage.getItem('profesional_id'),
    user_role: localStorage.getItem('user_role'),
    user_name: localStorage.getItem('user_name'),
  };
  log('localStorage snapshot:', ls);

  const pid = ls.profesional_id;
  if (isUUID(pid)) {
    log('resolve by localStorage.profesional_id:', pid);
    return pid;
  }
  warn('No hay profesional_id en localStorage o es inválido.');
  return null;
}

// ---------- INIT ----------
export async function initMisConsultas(root) {
  try {
    log('init');

    // Referencias
    E.root            = root || document;
    E.el.desde        = E.root.querySelector('#mc-desde');
    E.el.hasta        = E.root.querySelector('#mc-hasta');
    E.el.centro       = E.root.querySelector('#mc-centro');
    E.el.refresh      = E.root.querySelector('#mc-refresh');
    E.el.kpiConsultas = E.root.querySelector('#mc-kpi-consultas');
    E.el.kpiCobrado   = E.root.querySelector('#mc-kpi-cobrado');
    E.el.kpiPendiente = E.root.querySelector('#mc-kpi-pendiente');
    E.el.legend       = E.root.querySelector('#mc-legend');
    E.el.tbody        = E.root.querySelector('#mc-tbody');
    E.el.empty        = E.root.querySelector('#mc-empty');

    // Fechas por defecto
    const defDesde = isoFirstDayOfMonth();
    const defHasta = isoToday();
    if (E.el.desde && !E.el.desde.value) E.el.desde.value = defDesde;
    if (E.el.hasta && !E.el.hasta.value) E.el.hasta.value = defHasta;
    log('default dates:', { defDesde, defHasta });

    // Profesional logueado
    E.profesionalId = resolveProfesionalId();
    if (!E.profesionalId) {
      renderEmpty('No se detectó el profesional. Cerrá sesión e iniciá nuevamente.');
      return;
    }
    log('resolved profesionalId:', E.profesionalId);

    // Centros del profesional
    await loadCentrosDelProfesional(E.profesionalId);

    // Listeners
    if (E.el.refresh) E.el.refresh.onclick = () => refresh();
    if (E.el.centro)  E.el.centro.onchange = () => refresh();
    if (E.el.desde)   E.el.desde.onchange  = () => refresh();
    if (E.el.hasta)   E.el.hasta.onchange  = () => refresh();

    // Primera carga
    await refresh();
  } catch (e) {
    err('init error:', e);
    renderEmpty('No se pudo iniciar Mis Consultas.');
  }
}

// Por si querés testear manual desde consola:
// window.__misConsultasRefresh = refresh;
