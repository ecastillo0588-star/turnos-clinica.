// mis-consultas.js (v5: AR dates + multifiltros + safe charts)
import supabase from './supabaseClient.js';

const TAG = '[MisConsultas]';
const log = (...a)=>console.log(TAG, ...a);
const dbg=[]; const dpush=o=>{try{dbg.push(o);const pre=document.getElementById('mc-debug-pre');if(pre){pre.textContent=dbg.map(x=>typeof x==='string'?x:JSON.stringify(x,null,2)).join('\n');}}catch{}};

const pad2=n=>(n<10?'0'+n:''+n);
const isoToday = () => { const d=new Date(); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; };
const isoFirstDayOfMonth = (d=new Date()) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-01`;
const isUUID = v => typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const money = n => new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(n||0));

// ======= Formateos AR =======
const fmtDateARShort = (iso)=> {
  if(!iso) return '—';
  const [y,m,d]=iso.split('-');
  return `${d}/${m}/${String(y).slice(2)}`; // dd/mm/yy
};
const fmtMonthAR = (iso)=>{ // yyyy-mm-dd | yyyy-mm
  const [y,m]=iso.split('-');
  return `${m}/${String(y).slice(2)}`; // mm/yy
};

// key por granularidad (para timeline y filtros)
function weekKey(iso){ // S##/yy
  const dt = new Date(iso+'T00:00:00');
  const y = dt.getFullYear();
  const oneJan = new Date(y,0,1);
  const days = Math.floor((dt - oneJan)/86400000)+1;
  const wk = Math.ceil(days/7);
  return `S${wk}/${String(y).slice(2)}`;
}
function keyFromDate(iso, gran){
  if (gran==='day')   return fmtDateARShort(iso);  // dd/mm/yy
  if (gran==='week')  return weekKey(iso);
  return fmtMonthAR(iso);                          // month
}

// ======= Estado UI/Charts/Filtros =======
let UI = {};
let profesionalId = null;
let Charts = { timeline:null, os:null, centros:null, estados:null };

// dataset crudo de la última consulta
const State = {
  baseTurnos: [],
  basePagosMap: {},
  gran: 'day'
};

// filtros activos (multifiltro)
const Filters = {
  timeline: null,           // { gran:'day|week|month', label:'...' }
  os: new Set(),            // etiquetas (paciente.obra_social)
  centro: new Set(),        // nombres de centro
  estado: new Set()         // 'asignado' | ...
};

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
    chips:  document.getElementById('mc-chips'),
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
  try{
    let centros = [];
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

function buildPorOS(turnos){
  const labelOf = (t)=> t.pacientes?.obra_social || 'Sin OS';
  const m = groupBy(turnos, labelOf);
  const labels = [...m.keys()];
  const values = labels.map(l => m.get(l).filter(x=>x.estado==='atendido').length);
  return { labels, values };
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

/* ===== helpers de agrupación ===== */
function groupBy(arr, keyFn){
  const m = new Map();
  for (const it of arr){
    const k = keyFn(it);
    m.set(k, (m.get(k)||[]).concat(it));
  }
  return m;
}

function buildTimeline(turnos, gran='day'){
  const map = groupBy(turnos, t=> keyFromDate(t.fecha, gran));
  const labels = [...map.keys()];
  labels.sort((a,b)=>{
    // ordenar por valor real, no por string (reconstruimos a ISO para comparar)
    const toIso = (lbl)=>{
      if (gran==='day'){ const [d,m,y]=lbl.split('/'); return `20${y}-${m}-${d}`; }
      if (gran==='week'){ // S##/yy -> yyyy-## (comparación simple por año/semana)
        const [s,yy]=lbl.split('/'); return `20${yy}-${s.slice(1).padStart(2,'0')}`;
      }
      // month mm/yy
      const [m,yy]=lbl.split('/'); return `20${yy}-${m}-01`;
    };
    return toIso(a) < toIso(b) ? -1 : 1;
  });
  const values = labels.map(l => map.get(l).filter(x=>x.estado==='atendido').length);
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
  const d = fmtDateARShort(UI.desde.value), h = fmtDateARShort(UI.hasta.value);
  const c = UI.centro.selectedOptions?.[0]?.textContent || 'Todos los centros';
  UI.legend.textContent = `${c} · ${d} → ${h}`;
}

function renderTable(turnos, pagosMap){
  if (!turnos.length){ UI.tbody.innerHTML=''; UI.empty.style.display=''; return; }
  UI.empty.style.display='none';
  UI.tbody.innerHTML = turnos.map(t=>{
    const p = t.pacientes || {};
    const nombre = [p.apellido, p.nombre].filter(Boolean).join(', ') || '—';
    const fecha = fmtDateARShort(t.fecha);
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

/* ====== gráficos ====== */
function barConfig({labels, values}, title, onPointClick){
  return {
    type: 'bar',
    data: { labels, datasets: [{ label: title, data: values }] },
    options: { responsive:true, maintainAspectRatio:false,
      onClick(evt, activeEls){
        if (!activeEls?.length) return;
        const idx = activeEls[0].index;
        onPointClick?.(labels[idx]);
      },
      scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } },
      plugins:{ legend:{ display:false } }
    }
  };
}
function pieConfig({labels, values}, onSliceClick){
  return {
    type:'pie',
    data:{ labels, datasets:[{ data: values }] },
    options:{ responsive:true, maintainAspectRatio:false,
      onClick(evt, activeEls){
        if (!activeEls?.length) return;
        const idx = activeEls[0].index;
        onSliceClick?.(labels[idx]);
      },
      plugins:{ legend:{ position:'bottom' } }
    }
  };
}

function ensureOrUpdateChart(instRef, canvas, cfg){
  if (!canvas || !window.Chart) return null;

  const invalid =
    (instRef && (!instRef.canvas || !document.contains(instRef.canvas))) ||
    (instRef && instRef.canvas && instRef.canvas !== canvas);

  if (invalid) { try{instRef.destroy();}catch{} instRef=null; }

  if (!instRef) return new window.Chart(canvas.getContext('2d'), cfg);

  // update
  instRef.config.type   = cfg.type;
  instRef.data.labels   = cfg.data.labels;
  instRef.data.datasets = cfg.data.datasets;
  instRef.options       = { ...instRef.options, ...cfg.options };
  instRef.update();
  return instRef;
}

function destroyCharts(){
  try { Charts.timeline?.destroy(); } catch {}
  try { Charts.os?.destroy(); } catch {}
  try { Charts.centros?.destroy(); } catch {}
  try { Charts.estados?.destroy(); } catch {}
  Charts = { timeline:null, os:null, centros:null, estados:null };
}

/* ====== Multifiltros ====== */
function toggleFilter(type, payload){
  if (type==='timeline'){
    const same = Filters.timeline && Filters.timeline.label===payload.label && Filters.timeline.gran===payload.gran;
    Filters.timeline = same ? null : { ...payload };
  } else {
    const set = Filters[type];
    if (set.has(payload)) set.delete(payload); else set.add(payload);
  }
  renderEverything(); // re-pinta todo con filtros
}

function removeFilter(type, label){
  if (type==='timeline') { Filters.timeline=null; }
  else { Filters[type].delete(label); }
  renderEverything();
}
function clearAllFilters(){
  Filters.timeline=null;
  Filters.os.clear(); Filters.centro.clear(); Filters.estado.clear();
  renderEverything();
}

function renderChips(){
  const wrap = UI.chips;
  if (!wrap) return;
  const chips = [];

  if (Filters.timeline) chips.push({ type:'timeline', label: Filters.timeline.label, show:`Período: ${Filters.timeline.label}` });
  for (const v of Filters.os)     chips.push({ type:'os', label: v, show:`OS: ${v}` });
  for (const v of Filters.centro) chips.push({ type:'centro', label: v, show:`Centro: ${v}` });
  for (const v of Filters.estado) chips.push({ type:'estado', label: v, show:`Estado: ${v}` });

  if (!chips.length){ wrap.innerHTML=''; return; }

  wrap.innerHTML = chips.map(c=>`
    <span class="chip" data-type="${c.type}" data-label="${c.label}">
      ${c.show} <button title="Quitar">×</button>
    </span>`).join('') + `
    <button class="btn" id="mc-clear" style="padding:6px 10px;font-size:12px;margin-left:8px;">Limpiar</button>`;

  wrap.querySelectorAll('.chip button').forEach(btn=>{
    btn.onclick = (e)=>{
      const chip = e.currentTarget.closest('.chip');
      removeFilter(chip.dataset.type, chip.dataset.label);
    };
  });
  document.getElementById('mc-clear')?.addEventListener('click', clearAllFilters);
}

// Aplica filtros sobre State.baseTurnos
function getFilteredTurnos(){
  const { timeline } = Filters;
  return State.baseTurnos.filter(t=>{
    if (timeline){
      const key = keyFromDate(t.fecha, timeline.gran);
      if (key !== timeline.label) return false;
    }
    if (Filters.os.size){
      const lbl = t.pacientes?.obra_social || 'Sin OS';
      if (!Filters.os.has(lbl)) return false;
    }
    if (Filters.centro.size){
      const c = t.centros_medicos?.nombre || '—';
      if (!Filters.centro.has(c)) return false;
    }
    if (Filters.estado.size){
      if (!Filters.estado.has(t.estado)) return false;
    }
    return true;
  });
}

function pagosSubsetMap(turnos){
  const ids = new Set(turnos.map(t=>t.id));
  const map = {};
  for (const [id,imp] of Object.entries(State.basePagosMap)){
    if (ids.has(id)) map[id]=imp;
  }
  return map;
}

/* ===== ciclo principal ===== */
// Renderiza TODO (kpis, tabla, charts) desde State + Filters
function renderEverything(){
  const turnos = getFilteredTurnos();
  const pagosMap = pagosSubsetMap(turnos);

  setLegend();
  setKPIs(turnos, pagosMap);
  renderTable(turnos, pagosMap);
  renderChips();

  // gráficos (se alimentan del subconjunto filtrado)
  const tl  = buildTimeline(turnos, State.gran);
  Charts.timeline = ensureOrUpdateChart(
    Charts.timeline, UI.canvases.timeline,
    barConfig(tl, 'Atendidos', (label)=> toggleFilter('timeline', { label, gran: State.gran }))
  );

  const os  = buildPorOS(turnos);
  Charts.os = ensureOrUpdateChart(
    Charts.os, UI.canvases.os,
    pieConfig(os, (label)=> toggleFilter('os', label))
  );

  const cen = buildPorCentro(turnos);
  Charts.centros = ensureOrUpdateChart(
    Charts.centros, UI.canvases.centros,
    barConfig(cen, 'Atendidos', (label)=> toggleFilter('centro', label))
  );

  const st  = buildPorEstado(turnos);
  Charts.estados = ensureOrUpdateChart(
    Charts.estados, UI.canvases.estados,
    pieConfig(st, (label)=> toggleFilter('estado', label))
  );

  // estado vacío
  if (UI.empty){
    if ((turnos||[]).length===0){ UI.empty.style.display=''; UI.empty.textContent='Sin resultados para el período.'; }
    else { UI.empty.style.display='none'; }
  }

  // reflow suave
  requestAnimationFrame(()=>{
    try{Charts.timeline?.resize();}catch{}
    try{Charts.os?.resize();}catch{}
    try{Charts.centros?.resize();}catch{}
    try{Charts.estados?.resize();}catch{}
  });
}

// Consulta a Supabase y actualiza State, luego renderEverything()
async function refresh(){
  const desde    = UI.desde.value || isoFirstDayOfMonth();
  const hasta    = UI.hasta.value || isoToday();
  const gran     = UI.gran?.value || 'day';
  const centroId = UI.centro?.value || null;

  if (UI.empty){ UI.empty.style.display=''; UI.empty.textContent='Cargando…'; }
  dpush({ refresh_params: {desde, hasta, gran, profesionalId, centroId} });

  try{
    const turnos   = await fetchTurnos({ desde, hasta, profId: profesionalId, centroId });
    const pagosMap = await fetchPagosMap(turnos.map(t=>t.id));

    State.baseTurnos   = turnos;
    State.basePagosMap = pagosMap;
    State.gran         = gran;

    // al cambiar de intervalo re-render con filtros actuales
    renderEverything();
  }catch(e){
    console.error('[MisConsultas] refresh error:', e);
    dpush({ refresh_error: e?.message || e });
    if (UI.empty){ UI.empty.style.display=''; UI.empty.textContent='Error: '+(e?.message||e); }
  }
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
  UI.gran.onchange = ()=>{ refresh(); };   // cambia gran → timeline y filtro timeline usan “S”
  UI.centro.onchange = refresh;
  UI.desde.onchange = refresh;
  UI.hasta.onchange = refresh;

  // auto-limpieza (SPA)
  const onResize = ()=>{ Charts.timeline?.resize(); Charts.os?.resize(); Charts.centros?.resize(); Charts.estados?.resize(); };
  window.addEventListener('resize', onResize);

  const mo = new MutationObserver(()=>{
    if (UI.root && !document.body.contains(UI.root)){
      window.removeEventListener('resize', onResize);
      destroyCharts();
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList:true, subtree:true });

  // primera carga
  await refresh();
  log('ready');
}
