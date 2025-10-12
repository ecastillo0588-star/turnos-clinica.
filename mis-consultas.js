// mis-consultas.js (v4 con gráficos)
import supabase from './supabaseClient.js';

const TAG = '[MisConsultas]';
const log   = (...a)=>console.log(TAG, ...a);
const dbg   = [];
const dpush = (o)=>{ try{ dbg.push(o); const pre=document.getElementById('mc-debug-pre'); if(pre){ pre.textContent = dbg.map(x=> typeof x==='string'?x:JSON.stringify(x,null,2)).join('\n'); } }catch{} };

const pad2 = n => (n<10?'0'+n:''+n);
const isoToday = () => { const d=new Date(); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; };
const isoFirstDayOfMonth = (d=new Date()) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-01`;
const isUUID = v => typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const money = n => new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(n||0));

let UI = {};
let profesionalId = null;
let Charts = { timeline:null, os:null, centros:null, estados:null }; // instancias Chart.js

function bind() {
  UI = {
    root:   document.getElementById('mc'),
    desde:  document.getElementById('mc-desde'),
    hasta:  document.getElementById('mc-hasta'),
    centro: document.getElementById('mc-centro'),
    gran:   document.getElementById('mc-gran'),
    btn:    document.getElementById('mc-refresh'),
    kCons:  document.getElementById('mc-kpi-consultas'),
    kCob:   document.getElementById('mc-kpi-cobrado'),
    kPen:   document.getElementById('mc-kpi-pendiente'),
    legend: document.getElementById('mc-legend'),
    tbody:  document.getElementById('mc-tbody'),
    empty:  document.getElementById('mc-empty'),
    canvases: {
      timeline: document.getElementById('mc-chart-timeline'),
      os:       document.getElementById('mc-chart-os'),
      centros:  document.getElementById('mc-chart-centros'),
      estados:  document.getElementById('mc-chart-estados'),
    },
  };
}

async function loadChartJS(){
  if (window.Chart) return window.Chart;
  await new Promise((res, rej)=>{
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
    s.onload = res; s.onerror = ()=>rej(new Error('No se pudo cargar Chart.js'));
    document.head.appendChild(s);
  });
  return window.Chart;
}

/* ===== centros del profesional ===== */
async function loadCentrosFor(profId){
  const sel = UI.centro;
  sel.innerHTML = `<option value="">Todos los centros</option>`;
  let centros = [];
  try{
    const { data, error } = await supabase
      .from('profesional_centro')
      .select('centro_id, centros_medicos(id,nombre)')
      .eq('profesional_id', profId)
      .eq('activo', true);

    if (!error) centros = (data||[]).map(r=>r.centros_medicos).filter(Boolean);

    if (!centros.length){
      const { data:links=[] } = await supabase
        .from('profesional_centro')
        .select('centro_id')
        .eq('profesional_id', profId)
        .eq('activo', true);
      const ids = [...new Set(links.map(r=>r.centro_id).filter(Boolean))];
      if (ids.length){
        const { data:cms=[] } = await supabase
          .from('centros_medicos')
          .select('id,nombre')
          .in('id', ids)
          .order('nombre');
        centros = cms;
      }
    }

    const used = new Set();
    centros.forEach(c=>{
      if (!c?.id || used.has(String(c.id))) return;
      used.add(String(c.id));
      const opt=document.createElement('option');
      opt.value=c.id; opt.textContent=c.nombre || c.id;
      sel.appendChild(opt);
    });

    dpush({ centros: centros.map(c=>({id:c.id,nombre:c.nombre})) });
  }catch(e){
    dpush({ loadCentros_error: e?.message||e });
  }
}

/* ===== turnos + pagos ===== */
// --- reemplazá fetchTurnos por este ---
async function fetchTurnos({ desde, hasta, profId, centroId }){
  let q = supabase
    .from('turnos')
    .select(`
      id, fecha, hora_inicio, hora_fin, estado, copago,
      centro_id, obra_social_id,
      pacientes(id, apellido, nombre, obra_social),
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

// --- reemplazá buildPorOS por este (sin referencia a obras_sociales) ---
function buildPorOS(turnos){
  const labelOf = (t)=> t.pacientes?.obra_social || 'Sin OS';
  const m = groupBy(turnos, labelOf);
  const labels = [...m.keys()];
  const values = labels.map(l => m.get(l).filter(x=>x.estado==='atendido').length);
  return { labels, values };
}

// --- en refresh(), envolvé todo en try/catch (o reemplazá la función completa) ---
async function refresh(){
  const desde = UI.desde.value || isoFirstDayOfMonth();
  const hasta = UI.hasta.value || isoToday();
  const gran  = UI.gran.value || 'day';
  const centroId = UI.centro.value || null;

  UI.empty.style.display=''; UI.empty.textContent='Cargando…';
  dpush({ refresh_params: {desde, hasta, gran, profesionalId, centroId} });

  try {
    const turnos = await fetchTurnos({ desde, hasta, profId: profesionalId, centroId });
    const pagosMap = await fetchPagosMap(turnos.map(t=>t.id));

    setKPIs(turnos, pagosMap);
    renderTable(turnos, pagosMap);
    setLegend();

    const tl = buildTimeline(turnos, gran);
    Charts.timeline = ensureOrUpdateChart(Charts.timeline, UI.canvases.timeline,
      barConfig(tl, 'Atendidos'));

    const os = buildPorOS(turnos);
    Charts.os = ensureOrUpdateChart(Charts.os, UI.canvases.os, pieConfig(os));

    const byC = buildPorCentro(turnos);
    Charts.centros = ensureOrUpdateChart(Charts.centros, UI.canvases.centros, barConfig(byC, 'Atendidos'));

    const est = buildPorEstado(turnos);
    Charts.estados = ensureOrUpdateChart(Charts.estados, UI.canvases.estados, pieConfig(est));

    UI.empty.style.display='none';
  } catch (e){
    console.error('[MisConsultas] refresh error:', e);
    UI.empty.style.display=''; 
    UI.empty.textContent = 'Error: ' + (e?.message || e);
    dpush({ refresh_error: e });
  }
}


async function fetchPagosMap(ids){
  const uniq = [...new Set(ids || [])];
  if (!uniq.length) return {};
  const { data = [] } = await supabase
    .from('turnos_pagos')
    .select('turno_id, importe')
    .in('turno_id', uniq);
  const map = {};
  for (const r of data) map[r.turno_id] = (map[r.turno_id] || 0) + Number(r.importe||0);
  return map;
}

/* ===== agregados para gráficos ===== */
function groupBy(arr, keyFn){
  const m = new Map();
  for (const it of arr){
    const k = keyFn(it);
    m.set(k, (m.get(k)||[]).concat(it));
  }
  return m;
}

function buildTimeline(turnos, gran='day'){
  const formatDay = (d)=>d;
  const toWeek = (d)=>{ const dt=new Date(d); const y=dt.getFullYear(); 
    const oneJan=new Date(y,0,1); const days=Math.floor((dt-oneJan)/86400000)+1;
    const wk = Math.ceil(days/7); return `${y}-W${wk}`; };
  const toMonth = (d)=> d.slice(0,7);

  const keyer = gran==='day'? formatDay : gran==='week'? toWeek : toMonth;
  const map = groupBy(turnos, t=> keyer(t.fecha));
  const labels = [...map.keys()].sort();
  const values = labels.map(l => map.get(l).filter(x=>x.estado==='atendido').length);
  return { labels, values };
}

function buildPorOS(turnos){
  const labelOf = (t)=> t.obras_sociales?.obra_social || t.pacientes?.obra_social || 'Sin OS';
  const m = groupBy(turnos, labelOf);
  const labels = [...m.keys()];
  const values = labels.map(l => m.get(l).filter(x=>x.estado==='atendido').length);
  return { labels, values };
}

function buildPorCentro(turnos){
  const labelOf = (t)=> t.centros_medicos?.nombre || '—';
  const m = groupBy(turnos, labelOf);
  const labels = [...m.keys()];
  const values = labels.map(l => m.get(l).filter(x=>x.estado==='atendido').length);
  return { labels, values };
}

function buildPorEstado(turnos){
  const labels = ['asignado','en_espera','en_atencion','atendido','cancelado','confirmado'];
  const cnt = (st)=> turnos.filter(t=>t.estado===st).length;
  const values = labels.map(cnt);
  return { labels, values };
}

/* ===== render ===== */
function setLegend(){
  const d = UI.desde.value, h = UI.hasta.value;
  const c = UI.centro.selectedOptions?.[0]?.textContent || 'Todos los centros';
  UI.legend.textContent = `${c} · ${d} → ${h}`;
}

function renderTable(turnos, pagosMap){
  if (!turnos.length){ UI.tbody.innerHTML=''; UI.empty.style.display=''; return; }
  UI.empty.style.display='none';
  UI.tbody.innerHTML = turnos.map(t=>{
    const p = t.pacientes || {};
    const nombre = [p.apellido, p.nombre].filter(Boolean).join(', ') || '—';
    const fecha = t.fecha || '—';
    const hora  = String(t.hora_inicio||'').slice(0,5) || '—';
    const centro= t.centros_medicos?.nombre || '—';
    const estado= String(t.estado||'—').replaceAll('_',' ');
    const cop   = money(t.copago || 0);
    const pag   = money(pagosMap[t.id] || 0);
    return `<tr>
      <td>${fecha}</td><td>${hora}</td><td>${centro}</td>
      <td>${nombre}</td><td>${estado}</td>
      <td style="text-align:right">${cop}</td>
      <td style="text-align:right">${pag}</td>
    </tr>`;
  }).join('');
}

function setKPIs(turnos, pagosMap){
  const atendidos = turnos.filter(t=>t.estado==='atendido').length;
  const totalCop  = turnos.reduce((a,t)=> a + Number(t.copago||0), 0);
  const totalPag  = Object.values(pagosMap).reduce((a,b)=> a + Number(b||0), 0);
  const pend      = Math.max(0, totalCop - totalPag);

  UI.kCons.textContent = String(atendidos);
  UI.kCob.textContent  = money(totalPag);
  UI.kPen.textContent  = money(pend);
}

function barConfig({labels, values}, title){
  return {
    type: 'bar',
    data: { labels, datasets: [{ label: title, data: values }] },
    options: { responsive:true, maintainAspectRatio:false,
      scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } },
      plugins:{ legend:{ display:false } }
    }
  };
}
function pieConfig({labels, values}){
  return {
    type:'pie',
    data:{ labels, datasets:[{ data: values }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } } }
  };
}

function ensureOrUpdateChart(instRef, canvas, cfg){
  if (!canvas) return null;
  if (instRef?.data){
    // update
    instRef.config.type = cfg.type;
    instRef.data.labels = cfg.data.labels;
    instRef.data.datasets = cfg.data.datasets;
    instRef.update();
    return instRef;
  }
  // create
  return new window.Chart(canvas.getContext('2d'), cfg);
}

/* ===== ciclo principal ===== */
async function refresh(){
  const desde = UI.desde.value || isoFirstDayOfMonth();
  const hasta = UI.hasta.value || isoToday();
  const gran  = UI.gran.value || 'day';
  const centroId = UI.centro.value || null;

  UI.empty.style.display=''; UI.empty.textContent='Cargando…';
  dpush({ refresh_params: {desde, hasta, gran, profesionalId, centroId} });

  const turnos = await fetchTurnos({ desde, hasta, profId: profesionalId, centroId });
  const pagosMap = await fetchPagosMap(turnos.map(t=>t.id));

  setKPIs(turnos, pagosMap);
  renderTable(turnos, pagosMap);
  setLegend();

  // gráficos
  const tl = buildTimeline(turnos, gran);
  Charts.timeline = ensureOrUpdateChart(Charts.timeline, UI.canvases.timeline,
    barConfig(tl, 'Atendidos'));

  const os = buildPorOS(turnos);
  Charts.os = ensureOrUpdateChart(Charts.os, UI.canvases.os, pieConfig(os));

  const byC = buildPorCentro(turnos);
  Charts.centros = ensureOrUpdateChart(Charts.centros, UI.canvases.centros, barConfig(byC, 'Atendidos'));

  const est = buildPorEstado(turnos);
  Charts.estados = ensureOrUpdateChart(Charts.estados, UI.canvases.estados, pieConfig(est));

  UI.empty.style.display='none';
}

/* ===== init ===== */
export async function initMisConsultas(root){
  bind();

  // defaults de fecha
  if (!UI.desde.value) UI.desde.value = isoFirstDayOfMonth();
  if (!UI.hasta.value) UI.hasta.value = isoToday();

  // profesional
  const pid = localStorage.getItem('profesional_id');
  if (!isUUID(pid)){
    UI.empty.style.display=''; UI.empty.textContent='No se detectó el profesional logueado.';
    dpush({ error:'profesional_id inválido', pid });
    return;
  }
  profesionalId = pid;

  await loadCentrosFor(profesionalId);
  await loadChartJS();

  // listeners
  UI.btn.onclick = refresh;
  UI.gran.onchange = refresh;
  UI.centro.onchange = refresh;
  UI.desde.onchange = refresh;
  UI.hasta.onchange = refresh;

  // primera carga
  await refresh();
  log('ready');
}
