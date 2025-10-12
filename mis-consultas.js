// mis-consultas.js (v3)
// -------------------------------------------------
import supabase from './supabaseClient.js';

const TAG = '[MisConsultas]';
const log  = (...a)=>console.log(TAG, ...a);
const warn = (...a)=>console.warn(TAG, ...a);
const error= (...a)=>console.error(TAG, ...a);

// =============== helpers ===============
const pad2 = n => (n<10?'0'+n:''+n);
const isoToday = () => {
  const d=new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
};
const isoFirstDayOfMonth = (d=new Date()) =>
  `${d.getFullYear()}-${pad2(d.getMonth()+1)}-01`;

const isUUID = v => typeof v==='string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

const toNumber = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = n => new Intl.NumberFormat('es-AR', {
  style:'currency', currency:'ARS', maximumFractionDigits:0
}).format(toNumber(n));

// =============== estado UI ===============
let UI = {
  root:null,
  desde:null, hasta:null, centro:null, btn:null,
  kpiCons:null, kpiCobrado:null, kpiPend:null,
  legend:null, tbody:null, empty:null, dbg:null
};
let profesionalId = null;

// =============== scaffold si falta ===============
function ensureScaffold(root){
  // si ya está, solo tomar refs
  if (root.querySelector('#mc-desde')) {
    bindRefs(root);
    ensureOptionalBlocks(root);
    return;
  }

  // crea controles básicos
  root.innerHTML = `
    <div class="mc-wrap">
      <h2 style="margin:0 0 12px;color:#381e60">Mis Consultas</h2>
      <div class="mc-controls" style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
        <div><label>Desde<br><input id="mc-desde" type="date"></label></div>
        <div><label>Hasta<br><input id="mc-hasta" type="date"></label></div>
        <div style="min-width:220px"><label>Centro<br>
          <select id="mc-centro">
            <option value="">Todos los centros</option>
          </select>
        </label></div>
        <button id="mc-refresh" class="btn" style="height:36px;background:#7656b0;color:#fff;border:none;border-radius:7px;padding:0 12px;cursor:pointer">Actualizar</button>
      </div>
      <hr style="margin:14px 0 12px;border:none;border-top:1px solid #ece5fc">

      <div id="mc-kpis" class="kpis" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:10px">
        <div class="card" style="background:#fff;border-radius:10px;padding:12px;box-shadow:0 1px 8px rgba(60,40,140,.08)">
          <div style="font-size:12px;color:#6b6480">Consultas atendidas</div>
          <div id="mc-kpi-consultas" style="font-size:20px;color:#381e60;font-weight:700">—</div>
        </div>
        <div class="card" style="background:#fff;border-radius:10px;padding:12px;box-shadow:0 1px 8px rgba(60,40,140,.08)">
          <div style="font-size:12px;color:#6b6480">Cobrado</div>
          <div id="mc-kpi-cobrado" style="font-size:20px;color:#381e60;font-weight:700">—</div>
        </div>
        <div class="card" style="background:#fff;border-radius:10px;padding:12px;box-shadow:0 1px 8px rgba(60,40,140,.08)">
          <div style="font-size:12px;color:#6b6480">Pendiente</div>
          <div id="mc-kpi-pendiente" style="font-size:20px;color:#381e60;font-weight:700">—</div>
        </div>
      </div>

      <div id="mc-legend" style="font-size:12px;color:#6b6480;margin-bottom:6px">—</div>

      <div class="table-wrap" style="overflow:auto;border-radius:10px;background:#fff;box-shadow:0 1px 8px rgba(60,40,140,.08)">
        <table style="width:100%;border-collapse:collapse">
          <thead style="background:#f5f2ff;color:#4f3b7a">
            <tr>
              <th style="text-align:left;padding:8px 10px">Fecha</th>
              <th style="text-align:left;padding:8px 10px">Hora</th>
              <th style="text-align:left;padding:8px 10px">Centro</th>
              <th style="text-align:left;padding:8px 10px">Paciente</th>
              <th style="text-align:left;padding:8px 10px">Estado</th>
              <th style="text-align:right;padding:8px 10px">Copago</th>
              <th style="text-align:right;padding:8px 10px">Pagado</th>
            </tr>
          </thead>
          <tbody id="mc-tbody"></tbody>
        </table>
        <div id="mc-empty" style="display:none;padding:14px;color:#6b6480">Sin resultados.</div>
      </div>

      <details style="margin-top:10px">
        <summary>Ver debug</summary>
        <pre id="mc-debug" style="background:#0b1020;color:#bfe4ff;padding:10px;border-radius:8px;overflow:auto;max-height:260px"></pre>
      </details>
    </div>
  `;

  bindRefs(root);
}

// toma referencias a IDs esperados
function bindRefs(root){
  UI.root       = root;
  UI.desde      = root.querySelector('#mc-desde');
  UI.hasta      = root.querySelector('#mc-hasta');
  UI.centro     = root.querySelector('#mc-centro');
  UI.btn        = root.querySelector('#mc-refresh');
  UI.kpiCons    = root.querySelector('#mc-kpi-consultas');
  UI.kpiCobrado = root.querySelector('#mc-kpi-cobrado');
  UI.kpiPend    = root.querySelector('#mc-kpi-pendiente');
  UI.legend     = root.querySelector('#mc-legend');
  UI.tbody      = root.querySelector('#mc-tbody');
  UI.empty      = root.querySelector('#mc-empty');
  UI.dbg        = root.querySelector('#mc-debug');
}

// si faltan bloques opcionales en tu HTML, los crea
function ensureOptionalBlocks(root){
  if (!root.querySelector('#mc-kpi-consultas')) {
    const kpis = document.createElement('div');
    kpis.id = 'mc-kpis';
    kpis.innerHTML = `
      <div id="mc-kpi-consultas"></div>
      <div id="mc-kpi-cobrado"></div>
      <div id="mc-kpi-pendiente"></div>`;
    root.prepend(kpis);
  }
  if (!root.querySelector('#mc-tbody')){
    const tbl = document.createElement('table');
    tbl.innerHTML = `<tbody id="mc-tbody"></tbody>`;
    root.appendChild(tbl);
  }
  if (!root.querySelector('#mc-empty')){
    const dv = document.createElement('div');
    dv.id='mc-empty'; dv.style.display='none'; dv.textContent='Sin resultados.';
    root.appendChild(dv);
  }
  if (!root.querySelector('#mc-debug')){
    const det = document.createElement('details');
    det.innerHTML = `<summary>Ver debug</summary><pre id="mc-debug"></pre>`;
    root.appendChild(det);
  }
  bindRefs(root);
}

function dbgAppend(obj){
  if (!UI.dbg) return;
  try {
    const line = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    UI.dbg.textContent += (line + '\n');
  } catch { /* ignore */ }
}

// =============== datos: centros ===============
async function loadCentros(profId){
  const sel = UI.centro;
  if (!sel) return;

  sel.innerHTML = `<option value="">Todos los centros</option>`;

  let centros = [];
  try {
    // intento 1: join anidado
    const { data, error } = await supabase
      .from('profesional_centro')
      .select('centro_id, centros_medicos(id,nombre)')
      .eq('profesional_id', profId)
      .eq('activo', true);

    if (!error) {
      centros = (data || []).map(r => r.centros_medicos).filter(Boolean);
    } else {
      warn('join centros_medicos error:', error);
      dbgAppend({ join_error: error.message || error });
    }

    // intento 2: dos pasos
    if (!centros.length) {
      const { data: links=[] } = await supabase
        .from('profesional_centro')
        .select('centro_id')
        .eq('profesional_id', profId)
        .eq('activo', true);

      const ids = [...new Set(links.map(r=>r.centro_id).filter(Boolean))];
      if (ids.length){
        const { data: cms=[], error: cmErr } = await supabase
          .from('centros_medicos')
          .select('id,nombre')
          .in('id', ids)
          .order('nombre', { ascending: true });
        if (!cmErr) centros = cms;
      }
    }

    // pintar
    const seen = new Set();
    centros.forEach(c=>{
      if (!c?.id || seen.has(String(c.id))) return;
      seen.add(String(c.id));
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.nombre || c.id;
      sel.appendChild(opt);
    });

    dbgAppend({ centros_cargados: centros.map(c=>({id:c.id,nombre:c.nombre})) });
    log('centros cargados:', centros.length);
  } catch (e) {
    error('loadCentros error:', e);
    dbgAppend({ loadCentros_error: String(e?.message||e) });
  }
}

// =============== datos: turnos + pagos ===============
async function fetchTurnos({ desde, hasta, profId, centroId }){
  let q = supabase
    .from('turnos')
    .select(`
      id, fecha, hora_inicio, hora_fin, estado, copago,
      centro_id,
      pacientes(id, apellido, nombre),
      centros_medicos(id, nombre)
    `)
    .eq('profesional_id', profId)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending:true })
    .order('hora_inicio', { ascending:true });

  if (centroId) q = q.eq('centro_id', centroId);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function fetchPagosMap(turnoIds){
  const ids = [...new Set((turnoIds||[]).filter(Boolean))];
  if (!ids.length) return {};
  const { data = [], error } = await supabase
    .from('turnos_pagos')
    .select('turno_id, importe')
    .in('turno_id', ids);
  if (error) throw error;
  const map = {};
  for (const r of data) map[r.turno_id] = (map[r.turno_id] || 0) + toNumber(r.importe);
  return map;
}

// =============== render ===============
function setLegend(){
  if (!UI.legend) return;
  const desde = UI.desde?.value || '—';
  const hasta = UI.hasta?.value || '—';
  const centroTxt = UI.centro?.selectedOptions?.[0]?.textContent || 'Todos los centros';
  UI.legend.textContent = `${centroTxt} · ${desde} → ${hasta}`;
}

function setKPIs(turnos, pagosMap){
  const atendidos = turnos.filter(t=>t.estado==='atendido').length;
  const totalCopago = turnos.reduce((a,t)=>a+toNumber(t.copago),0);
  const totalPagos  = Object.values(pagosMap).reduce((a,b)=>a+toNumber(b),0);
  const pendiente   = Math.max(0, totalCopago - totalPagos);

  if (UI.kpiCons)    UI.kpiCons.textContent    = String(atendidos);
  if (UI.kpiCobrado) UI.kpiCobrado.textContent = money(totalPagos);
  if (UI.kpiPend)    UI.kpiPend.textContent    = money(pendiente);
}

function renderRows(turnos, pagosMap){
  if (!UI.tbody) return;
  if (!turnos.length){
    UI.tbody.innerHTML = '';
    if (UI.empty) { UI.empty.style.display=''; UI.empty.textContent='Sin resultados en el período.'; }
    return;
  }
  if (UI.empty) UI.empty.style.display='none';

  UI.tbody.innerHTML = turnos.map(t=>{
    const p = t.pacientes || {};
    const paciente = [p.apellido, p.nombre].filter(Boolean).join(', ') || '—';
    const fecha = t.fecha || '—';
    const hora  = String(t.hora_inicio||'').slice(0,5) || '—';
    const centro= t.centros_medicos?.nombre || '—';
    const estado= String(t.estado||'—').replaceAll('_',' ');
    const copago= money(t.copago||0);
    const pagado= money(pagosMap[t.id] || 0);
    return `
      <tr>
        <td style="padding:8px 10px;border-top:1px solid #f1ecff">${fecha}</td>
        <td style="padding:8px 10px;border-top:1px solid #f1ecff">${hora}</td>
        <td style="padding:8px 10px;border-top:1px solid #f1ecff">${centro}</td>
        <td style="padding:8px 10px;border-top:1px solid #f1ecff">${paciente}</td>
        <td style="padding:8px 10px;border-top:1px solid #f1ecff">${estado}</td>
        <td style="padding:8px 10px;border-top:1px solid #f1ecff;text-align:right">${copago}</td>
        <td style="padding:8px 10px;border-top:1px solid #f1ecff;text-align:right">${pagado}</td>
      </tr>
    `;
  }).join('');
}

// =============== refresh ===============
async function refresh(){
  const desde = UI.desde?.value || isoFirstDayOfMonth();
  const hasta = UI.hasta?.value || isoToday();
  const centroId = (UI.centro?.value || '').trim() || null;

  dbgAppend({ refresh_params:{ desde, hasta, profesionalId, centroId } });
  log('refresh', { desde, hasta, profesionalId, centroId });

  if (UI.empty){ UI.empty.style.display=''; UI.empty.textContent='Cargando…'; }

  try{
    console.time(`${TAG} refresh`);
    const turnos = await fetchTurnos({ desde, hasta, profId: profesionalId, centroId });
    dbgAppend({ turnos_len: turnos.length });
    log('turnos', turnos.length);

    const pagosMap = await fetchPagosMap(turnos.map(t=>t.id));
    dbgAppend({ pagosMap_keys: Object.keys(pagosMap).length });

    setKPIs(turnos, pagosMap);
    renderRows(turnos, pagosMap);
    setLegend();

    console.timeEnd(`${TAG} refresh`);
    if (UI.empty) UI.empty.style.display='none';
  }catch(e){
    error('refresh error', e);
    dbgAppend({ refresh_error: String(e?.message||e) });
    if (UI.empty){ UI.empty.style.display=''; UI.empty.textContent='Error cargando datos.'; }
  }
}

// =============== init público ===============
export async function initMisConsultas(root){
  try{
    log('init');
    ensureScaffold(root || document);
    // fechas por defecto
    if (UI.desde && !UI.desde.value) UI.desde.value = isoFirstDayOfMonth();
    if (UI.hasta && !UI.hasta.value) UI.hasta.value = isoToday();
    dbgAppend({ defaults:{ desde:UI.desde?.value, hasta:UI.hasta?.value } });

    // profesional
    const pid = localStorage.getItem('profesional_id');
    profesionalId = isUUID(pid) ? pid : null;
    dbgAppend({ profesional_id: profesionalId });
    log('profesionalId:', profesionalId);

    if (!profesionalId){
      if (UI.empty){ UI.empty.style.display=''; UI.empty.textContent='No se detectó el profesional logueado.'; }
      return;
    }

    await loadCentros(profesionalId);

    // listeners
    if (UI.btn)    UI.btn.onclick    = refresh;
    if (UI.centro) UI.centro.onchange= refresh;
    if (UI.desde)  UI.desde.onchange = refresh;
    if (UI.hasta)  UI.hasta.onchange = refresh;

    // primera carga
    await refresh();
  }catch(e){
    error('init error', e);
    dbgAppend({ init_error: String(e?.message||e) });
    if (UI.empty){ UI.empty.style.display=''; UI.empty.textContent='No se pudo iniciar Mis Consultas.'; }
  }
}
