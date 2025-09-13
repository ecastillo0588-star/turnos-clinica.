import supabase from './supabaseClient.js';
import { applyRoleClasses, loadProfesionalesIntoSelect, roleAllows } from './global.js';

/* === ESTADOS === */
const EST = {
  ASIGNADO:'asignado',
  EN_ESPERA:'en_espera',
  EN_ATENCION:'en_atencion',
  CANCELADO:'cancelado',
  CONFIRMADO:'confirmado',
  ATENDIDO:'atendido'
};

/* Util para setear textContent si el nodo existe */
const safeSet = (el, text) => { if (el) el.textContent = text; };

const UI = {
  centroChip: document.getElementById('centro-chip'),
  profSelect: document.getElementById('prof-select'),
  fecha: document.getElementById('fecha'),
  btnHoy: document.getElementById('btn-hoy'),
  tblPend: document.getElementById('tbl-pend'),
  tblEsp: document.getElementById('tbl-esp'),
  tblAtencion: document.getElementById('tbl-atencion'),
  tblDone: document.getElementById('tbl-done'),
  kpiFree: document.getElementById('kpi-free'),
  kpiSub: document.getElementById('kpi-sub'), // eliminado del DOM; queda null
  massSearch: document.getElementById('mass-search'),
  massClear: document.getElementById('mass-clear'),
};
const H = {
  // spans de label para no borrar los botones
  pend: document.getElementById('hl-pend'),
  esp: document.getElementById('hl-esp'),
  atenc: document.getElementById('hl-atencion'),
  done: document.getElementById('hl-done'),
};

/* === Tipografía global (A− / A / A+) === */
const FONT = { key:'ui_fs_px', def:14, min:12, max:18, step:1 };
function applyFs(px){ document.documentElement.style.setProperty('--fs', `${px}px`); }
function loadFs(){
  const v = parseInt(localStorage.getItem(FONT.key), 10);
  const px = Number.isFinite(v) ? Math.min(FONT.max, Math.max(FONT.min, v)) : FONT.def;
  applyFs(px); return px;
}
let fsPx = loadFs();

/* Drawer refs */
const Drawer = {
  el: document.getElementById('fichaDrawer'),
  close: document.getElementById('fd-close'),
  status: document.getElementById('fd-status'),
  msg: document.getElementById('fd-msg'),
  title: document.getElementById('fd-title'),
  sub: document.getElementById('fd-sub'),
  osYear: document.getElementById('fd-os-year'),
  hc: document.getElementById('fd-hc'),
  prof: document.getElementById('fd-prof'),
  centro: document.getElementById('fd-centro'),
  fecha: document.getElementById('fd-fecha'),
  hora: document.getElementById('fd-hora'),
  estado: document.getElementById('fd-estado'),
  copago: document.getElementById('fd-copago'),
  dni: document.getElementById('fd-dni'),
  ape: document.getElementById('fd-apellido'),
  nom: document.getElementById('fd-nombre'),
  nac: document.getElementById('fd-nac'),
  tel: document.getElementById('fd-tel'),
  mail: document.getElementById('fd-mail'),
  obra: document.getElementById('fd-obra'),
  afiliado: document.getElementById('fd-afiliado'),
  cred: document.getElementById('fd-cred'),
  credLink: document.getElementById('fd-cred-link'),
  ecNom: document.getElementById('fd-ec-nom'),
  ecApe: document.getElementById('fd-ec-ape'),
  ecCel: document.getElementById('fd-ec-cel'),
  ecVin: document.getElementById('fd-ec-vin'),
  prox: document.getElementById('fd-prox'),
  renov: document.getElementById('fd-renov'),
  activo: document.getElementById('fd-activo'),
  notas: document.getElementById('fd-notas'),
  btnCerrar: document.getElementById('fd-cerrar'),
  btnGuardar: document.getElementById('fd-guardar'),
  btnFinalizar: document.getElementById('fd-finalizar'),
};

/* Preferencias / contexto */
let currentCentroId = localStorage.getItem('centro_medico_id');
let currentCentroNombre = localStorage.getItem('centro_medico_nombre') || '';
const userRole = String(localStorage.getItem('user_role') || '').toLowerCase(); // 'medico' | 'amp' | 'amc' | 'propietario'
const loggedProfesionalId = localStorage.getItem('profesional_id');
let selectedProfesionales = []; // multi-selección
let currentFechaISO = null;
let centroWatchTimer = null;

/* ====== Persistencia de selección de profesional ====== */
function profSelKey(){ return `inicio_prof_sel_${currentCentroId||'any'}`; }
function getSavedProfIds(){
  try{
    const s = localStorage.getItem(profSelKey());
    if(!s) return null;
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr.map(String) : null;
  }catch{ return null; }
}
function saveProfSelection(){
  const sel = UI.profSelect; if(!sel) return;
  const ids = sel.multiple
    ? Array.from(sel.selectedOptions).map(o=>o.value).filter(Boolean)
    : (sel.value ? [sel.value] : []);
  try{ localStorage.setItem(profSelKey(), JSON.stringify(ids)); }catch{}
}
function restoreProfSelection(){
  const sel = UI.profSelect; if(!sel) return false;
  const saved = getSavedProfIds();
  if(!saved || !saved.length) return false;
  const values = new Set(saved.map(String));
  let firstSelected = null;
  Array.from(sel.options).forEach(o=>{
    if(!o.value) return;
    if(values.has(String(o.value))){ o.selected = true; if(!firstSelected) firstSelected = o.value; }
    else if(sel.multiple){ o.selected = false; }
  });
  if(!sel.multiple){ sel.value = firstSelected || ''; }
  selectedProfesionales = sel.multiple
    ? Array.from(sel.selectedOptions).map(o=>o.value).filter(Boolean)
    : (sel.value ? [sel.value] : []);
  return selectedProfesionales.length>0;
}

/* Filtro global */
let filterText = '';

/* —— Helpers —— */
function pad2(n){return n<10?'0'+n:''+n}
function todayISO(){
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`
}
function toHM(t){return (t??'').toString().slice(0,5)}
function minutesDiff(start, end){
  const [h1,m1]=start.split(':').map(Number);
  const [h2,m2]=end.split(':').map(Number);
  return (h2*60+m2)-(h1*60+m1);
}
function nowHHMMSS(){
  const d=new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}
function fmtMoney(n){
  return new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(n||0))
}
function titleCase(s){
  return (s||'').split(' ').filter(Boolean).map(w=>w[0]?.toUpperCase()+w.slice(1).toLowerCase()).join(' ')
}
function calcEdad(f){
  if(!f) return null;
  const d=new Date(f); if(isNaN(d)) return null;
  const t=new Date();
  let a=t.getFullYear()-d.getFullYear();
  const m=t.getMonth()-d.getMonth();
  if(m<0||(m===0&&t.getDate()<d.getDate())) a--;
  return Math.max(a,0);
}
function norm(s){
  return (s??'').toString().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'');
}
function matchTurno(t){
  if(!filterText) return true;
  const p=t.pacientes||{};
  return norm(p.apellido).includes(filterText) || String(p.dni||'').includes(filterText);
}
function setDrawerMsg(msg,tone=''){
  if(Drawer.msg){ Drawer.msg.textContent=msg||''; Drawer.msg.className='msg '+(tone||''); }
}
function setDrawerStatus(msg,tone=''){
  if(Drawer.status){ Drawer.status.textContent=msg||''; Drawer.status.className='msg '+(tone||''); }
}

/* Aplica clases de rol al <body> */
applyRoleClasses(userRole);

/* === Mapa id -> nombre profesional (desde <select>) === */
let PROF_NAME = new Map();
function rebuildProfMap(){
  PROF_NAME.clear();
  Array.from(UI.profSelect.options).forEach(o=>{
    if(o.value) PROF_NAME.set(String(o.value), (o.textContent||'').trim());
  });
}
function profNameById(id){ return PROF_NAME.get(String(id)) || '—'; }

/* Drawer helpers */
function showDrawer(){ Drawer.el.classList.add('open'); Drawer.el.setAttribute('aria-hidden','false'); }
function hideDrawer(){ Drawer.el.classList.remove('open'); Drawer.el.setAttribute('aria-hidden','true'); }
if (Drawer.close) Drawer.close.onclick = hideDrawer;
if (Drawer.btnCerrar) Drawer.btnCerrar.onclick = hideDrawer;

/* centro */
async function fetchCentroById(id){
  const { data } = await supabase.from('centros_medicos').select('nombre').eq('id', id).maybeSingle();
  return data?.nombre || '';
}
function renderCentroChip(){ if (UI.centroChip) UI.centroChip.textContent = currentCentroNombre || '—'; }
async function syncCentroFromStorage(force=false){
  const id = localStorage.getItem('centro_medico_id');
  const nom = localStorage.getItem('centro_medico_nombre') || currentCentroNombre;
  if (force || id !== currentCentroId || nom !== currentCentroNombre){
    currentCentroId = id;
    currentCentroNombre = nom || await fetchCentroById(id);
    localStorage.setItem('centro_medico_nombre', currentCentroNombre);
    renderCentroChip();
    await loadProfesionales();
  // Restaurar selección de profesional guardada (por centro)
  if (!restoreProfSelection()) { saveProfSelection(); }
    await refreshAll();
  }
}
function startCentroWatcher(){ if (centroWatchTimer) clearInterval(centroWatchTimer); centroWatchTimer=setInterval(()=>syncCentroFromStorage(false), 1000); }
window.addEventListener('beforeunload', ()=>{ if (centroWatchTimer) clearInterval(centroWatchTimer); });

/* profesionales */
async function loadProfesionales(){
  const sel=UI.profSelect;

  // AMC: multiselección
  if (userRole === 'amc') {
    sel.multiple = true;
    sel.classList.remove('compact');
  }

  await loadProfesionalesIntoSelect(sel, {
    role: userRole,
    centroId: currentCentroId,
    loggedProfesionalId: loggedProfesionalId
  });

  // Mapa id->nombre
  rebuildProfMap();

  // Selección por defecto
  if (sel.multiple) {
    selectedProfesionales = Array.from(sel.options)
      .filter(o => o.value)
      .map(o => { o.selected = true; return o.value; });
    sel.size = Math.min(10, Math.max(4, selectedProfesionales.length || 6));
  } else {
    selectedProfesionales = sel.value ? [sel.value] : [];
  }
}
UI.profSelect.addEventListener('change', async ()=>{
  const sel=UI.profSelect;
  selectedProfesionales = sel.multiple
    ? Array.from(sel.selectedOptions).map(o => o.value).filter(Boolean)
    : (sel.value ? [sel.value] : []);
  saveProfSelection();
  await refreshAll();
});
  await refreshAll();
});

/* fecha */
UI.fecha.value=todayISO(); currentFechaISO=UI.fecha.value;
UI.fecha.addEventListener('change', ()=>{ currentFechaISO=UI.fecha.value||todayISO(); refreshAll(); });
UI.btnHoy.addEventListener('click', ()=>{ const h=todayISO(); UI.fecha.value=h; currentFechaISO=h; refreshAll(); });

/* data día (multi-profesional, sin join a profesionales) */
async function fetchDiaData(){
  if(!selectedProfesionales.length) return { pendientes:[], presentes:[], atencion:[], atendidos:[], agenda:[], turnos:[] };
  const profIds = selectedProfesionales.map(String);

  const selectCols = `
    id, fecha, hora_inicio, hora_fin, estado, hora_arribo, copago, paciente_id, profesional_id,
    pacientes(id, dni, nombre, apellido, obra_social, historia_clinica)
  `;

  const [pend, pres, atenc, done, agenda, turnos] = await Promise.all([
    supabase.from('turnos').select(selectCols)
      .eq('centro_id', currentCentroId).eq('fecha', currentFechaISO)
      .in('profesional_id', profIds).eq('estado', EST.ASIGNADO)
      .order('hora_inicio', {ascending:true}),
    supabase.from('turnos').select(selectCols)
      .eq('centro_id', currentCentroId).eq('fecha', currentFechaISO)
      .in('profesional_id', profIds).eq('estado', EST.EN_ESPERA)
      .order('hora_inicio', {ascending:true}),
    supabase.from('turnos').select(selectCols)
      .eq('centro_id', currentCentroId).eq('fecha', currentFechaISO)
      .in('profesional_id', profIds).eq('estado', EST.EN_ATENCION)
      .order('hora_inicio', {ascending:true}),
    supabase.from('turnos').select(selectCols)
      .eq('centro_id', currentCentroId).eq('fecha', currentFechaISO)
      .in('profesional_id', profIds).eq('estado', EST.ATENDIDO)
      .order('hora_inicio', {ascending:true}),
    supabase.from('agenda').select('id, fecha, hora_inicio, hora_fin, profesional_id')
      .eq('centro_id', currentCentroId).eq('fecha', currentFechaISO)
      .in('profesional_id', profIds).order('hora_inicio',{ascending:true}),
    supabase.from('turnos').select('id, hora_inicio, hora_fin, estado, profesional_id')
      .eq('centro_id', currentCentroId).eq('fecha', currentFechaISO)
      .in('profesional_id', profIds)
  ]);

  return {
    pendientes: pend.data||[],
    presentes:  pres.data||[],
    atencion:   atenc.data||[],
    atendidos:  done.data||[],
    agenda:     agenda.data||[],
    turnos:     turnos.data||[]
  };
}

/* —— Filtro —— */
function applyFilter(data){
  if (!filterText) return { pendientes:data.pendientes, presentes:data.presentes, atencion:data.atencion, atendidos:data.atendidos };
  return {
    pendientes:(data.pendientes||[]).filter(matchTurno),
    presentes:(data.presentes||[]).filter(matchTurno),
    atencion:(data.atencion||[]).filter(matchTurno),
    atendidos:(data.atendidos||[]).filter(matchTurno),
  };
}

/* Mostrar columna “Profesional” si hay multiselección o más de 1 seleccionado */
const showProfColumn = ()=> (UI.profSelect.multiple || selectedProfesionales.length > 1);

/* ===== Render: Por llegar ===== */
function renderPendientes(list){
  const withProf = showProfColumn();
  const grid = withProf
    ? `var(--w-hora) var(--w-dni) minmax(var(--minch-nombre),1fr) minmax(var(--minch-apellido),1fr) minmax(var(--minch-obra),1fr) var(--w-prof) var(--w-acc)`
    : `var(--w-hora) var(--w-dni) minmax(var(--minch-nombre),1fr) minmax(var(--minch-apellido),1fr) minmax(var(--minch-obra),1fr) var(--w-acc)`;
  const head=`<thead class="thead"><tr class="hrow" style="grid-template-columns:${grid}">
      <th class="cell">Hora</th><th class="cell">DNI</th>
      <th class="cell">Nombre</th><th class="cell">Apellido</th><th class="cell">Obra social</th>
      ${withProf?'<th class="cell">Profesional</th>':''}
      <th class="cell right">Acciones</th></tr></thead>`;

  const puedeCancelar = roleAllows('cancelar', userRole);
  const puedeArribo   = roleAllows('arribo', userRole);

  const rows=(list||[]).map(t=>{
    const p=t.pacientes||{};
    const hora=`<b>${toHM(t.hora_inicio)}</b>${t.hora_fin?' — '+toHM(t.hora_fin):''}`;
    const acciones = `
      <div class="actions">
        ${puedeCancelar ? `<button class="icon" data-id="${t.id}" data-act="cancel" title="Anular" data-role-guard>🗑️</button>` : ''}
        ${puedeArribo   ? `<button class="icon" data-id="${t.id}" data-act="arribo" title="Pasar a En espera" data-role-guard>🟢</button>` : ''}
      </div>`;
    return `<tr class="row" style="grid-template-columns:${grid}">
      <td class="cell nowrap">${hora}</td>
      <td class="cell">${p.dni||'—'}</td>
      <td class="cell truncate">${titleCase(p.nombre)||'—'}</td>
      <td class="cell truncate">${titleCase(p.apellido)||'—'}</td>
      <td class="cell truncate">${p.obra_social||'—'}</td>
      ${withProf?`<td class="cell truncate">${profNameById(t.profesional_id)}</td>`:''}
      <td class="cell right">${acciones}</td>
    </tr>`;
  }).join('');

  UI.tblPend.innerHTML=head+'<tbody>'+rows+'</tbody>';

  UI.tblPend.querySelectorAll('.icon').forEach(btn=>{
    const id=btn.getAttribute('data-id'), act=btn.getAttribute('data-act');
    if(act==='arribo') btn.onclick=()=> marcarLlegadaYCopago(id);
    if(act==='cancel') btn.onclick=()=> anularTurno(id);
  });
}

/* ===== En sala de espera ===== */
let waitTimer=null;
function startWaitTicker(){ if(waitTimer) clearInterval(waitTimer); waitTimer=setInterval(updateWaitBadges, 30000); }
function updateWaitBadges(){
  const nodes=document.querySelectorAll('[data-arribo-ts]');
  const now=new Date();
  nodes.forEach(n=>{
    const ts=n.getAttribute('data-arribo-ts'); if(!ts) return;
    const ms= now - new Date(ts);
    const mins=Math.max(0, Math.round(ms/60000));
    const hh=Math.floor(mins/60), mm=mins%60;
    n.textContent = hh? `${hh}h ${mm}m` : `${mm}m`;
  });
}
function renderPresentes(list){
  const withProf = showProfColumn();
  const grid = withProf
    ? `var(--w-espera) var(--w-hora) minmax(var(--minch-nombre),1fr) minmax(var(--minch-apellido),1fr) minmax(var(--minch-obra),1fr) var(--w-prof) var(--w-copago) var(--w-acc)`
    : `var(--w-espera) var(--w-hora) minmax(var(--minch-nombre),1fr) minmax(var(--minch-apellido),1fr) minmax(var(--minch-obra),1fr) var(--w-copago) var(--w-acc)`;
  const head=`<thead class="thead"><tr class="hrow" style="grid-template-columns:${grid}">
      <th class="cell">Espera</th><th class="cell">Hora</th><th class="cell">Nombre</th>
      <th class="cell">Apellido</th><th class="cell">Obra social</th>
      ${withProf?'<th class="cell">Profesional</th>':''}
      <th class="cell">Copago</th>
      <th class="cell right">Acciones</th></tr></thead>`;

  const puedeVolver   = roleAllows('volver', userRole);
  const puedeCancelar = roleAllows('cancelar', userRole);
  const puedeAtender  = roleAllows('atender', userRole);

  const rows=(list||[]).map(t=>{
    const p=t.pacientes||{};
    const hora=`<b>${toHM(t.hora_inicio)}</b>${t.hora_fin?' — '+toHM(t.hora_fin):''}`;
    const arriboISO=`${currentFechaISO}T${toHM(t.hora_arribo)||'00:00'}:00`;
    const copBadge=(t.copago && Number(t.copago)>0)?`<span class="copago">${fmtMoney(t.copago)}</span>`:`<span class="copago none">Sin copago</span>`;
    const acciones = `
      ${puedeVolver   ? `<button class="icon" data-id="${t.id}" data-act="volver" title="Volver a pendientes" data-role-guard>↩️</button>` : ''}
      ${puedeCancelar ? `<button class="icon" data-id="${t.id}" data-act="cancel" title="Anular" data-role-guard>🗑️</button>` : ''}
      ${puedeAtender  ? `<button class="icon" data-id="${t.id}" data-act="atender" title="En atención" data-role-guard>✅</button>` : ''}`;
    return `<tr class="row" style="grid-template-columns:${grid}">
      <td class="cell"><span class="wait" data-arribo-ts="${arriboISO}">—</span></td>
      <td class="cell nowrap">${hora}</td>
      <td class="cell truncate">${titleCase(p.nombre)||'—'}</td>
      <td class="cell truncate">${titleCase(p.apellido)||'—'}</td>
      <td class="cell truncate">${p.obra_social||'—'}</td>
      ${withProf?`<td class="cell truncate">${profNameById(t.profesional_id)}</td>`:''}
      <td class="cell">${copBadge}</td>
      <td class="cell right"><div class="actions">${acciones}</div></td>
    </tr>`;
  }).join('');

  UI.tblEsp.innerHTML=head+'<tbody>'+rows+'</tbody>';

  UI.tblEsp.querySelectorAll('.icon').forEach(btn=>{
    const id=btn.getAttribute('data-id'), act=btn.getAttribute('data-act');
    if(act==='volver') btn.onclick=async()=>{ if(!roleAllows('volver', userRole)) return; await supabase.from('turnos').update({estado:EST.ASIGNADO, hora_arribo:null}).eq('id',id); await refreshAll(); };
    if(act==='cancel') btn.onclick=()=> anularTurno(id);
    if(act==='atender') btn.onclick=(ev)=> pasarAEnAtencion(id, ev);
  });

  updateWaitBadges(); startWaitTicker();
}

/* ===== En atención ===== */
function renderAtencion(list){
  const withProf = showProfColumn();
  const grid = withProf
    ? `var(--w-hora) var(--w-dni) minmax(var(--minch-nombre),1fr) minmax(var(--minch-apellido),1fr) minmax(var(--minch-obra),1fr) var(--w-prof) var(--w-acc)`
    : `var(--w-hora) var(--w-dni) minmax(var(--minch-nombre),1fr) minmax(var(--minch-apellido),1fr) minmax(var(--minch-obra),1fr) var(--w-acc)`;
  const head=`<thead class="thead"><tr class="hrow" style="grid-template-columns:${grid}">
      <th class="cell">Hora</th><th class="cell">DNI</th>
      <th class="cell">Nombre</th><th class="cell">Apellido</th><th class="cell">Obra social</th>
      ${withProf?'<th class="cell">Profesional</th>':''}
      <th class="cell right">Acciones</th></tr></thead>`;

  const puedeAbrir   = roleAllows('abrir_ficha', userRole);
  const puedeVolverE = roleAllows('atender', userRole);
  const puedeFin     = roleAllows('finalizar', userRole);

  const rows=(list||[]).map(t=>{
    const p=t.pacientes||{};
    const hora=`<b>${toHM(t.hora_inicio)}</b>${t.hora_fin?' — '+toHM(t.hora_fin):''}`;
    const acciones = `
      ${puedeAbrir   ? `<button class="icon" data-id="${t.id}" data-act="abrir-ficha" title="Abrir ficha paciente" data-role-guard>📄</button>` : ''}
      ${puedeVolverE ? `<button class="icon" data-id="${t.id}" data-act="volver-espera" title="Volver a sala de espera" data-role-guard>⏪</button>` : ''}
      ${puedeFin     ? `<button class="icon" data-id="${t.id}" data-act="finalizar" title="Marcar ATENDIDO" data-role-guard>✅</button>` : ''}`;
    return `<tr class="row" style="grid-template-columns:${grid}">
      <td class="cell nowrap">${hora}</td>
      <td class="cell">${p.dni||'—'}</td>
      <td class="cell truncate">${titleCase(p.nombre)||'—'}</td>
      <td class="cell truncate">${titleCase(p.apellido)||'—'}</td>
      <td class="cell truncate">${p.obra_social||'—'}</td>
      ${withProf?`<td class="cell truncate">${profNameById(t.profesional_id)}</td>`:''}
      <td class="cell right"><div class="actions">${acciones}</div></td>
    </tr>`;
  }).join('');
  UI.tblAtencion.innerHTML = head + '<tbody>' + rows + '</tbody>';

  UI.tblAtencion.querySelectorAll('.icon').forEach(btn=>{
    const id=btn.getAttribute('data-id'), act=btn.getAttribute('data-act');
    if(act==='abrir-ficha') btn.onclick=()=> openFicha(id);
    if(act==='volver-espera') btn.onclick=()=> volverASalaEspera(id);
    if(act==='finalizar') btn.onclick=()=> finalizarAtencion(id);
  });
}

/* ===== Atendidos ===== */
function renderAtendidos(list){
  const withProf = showProfColumn();
  const grid = withProf
    ? `var(--w-hora) var(--w-dni) minmax(var(--minch-nombre),1fr) minmax(var(--minch-apellido),1fr) minmax(var(--minch-obra),1fr) var(--w-prof) var(--w-copago) var(--w-acc)`
    : `var(--w-hora) var(--w-dni) minmax(var(--minch-nombre),1fr) minmax(var(--minch-apellido),1fr) minmax(var(--minch-obra),1fr) var(--w-copago) var(--w-acc)`;
  const head=`<thead class="thead"><tr class="hrow" style="grid-template-columns:${grid}">
      <th class="cell">Hora</th><th class="cell">DNI</th>
      <th class="cell">Nombre</th><th class="cell">Apellido</th><th class="cell">Obra social</th>
      ${withProf?'<th class="cell">Profesional</th>':''}
      <th class="cell">Copago</th><th class="cell right">Acciones</th></tr></thead>`;

  const puedeAbrir = roleAllows('abrir_ficha', userRole);

  const rows=(list||[]).map(t=>{
    const p=t.pacientes||{};
    const hora=`<b>${toHM(t.hora_inicio)}</b>${t.hora_fin?' — '+toHM(t.hora_fin):''}`;
    const cop = (t.copago && Number(t.copago)>0)? fmtMoney(t.copago) : '—';
    const hcBtn = p.historia_clinica ? `<a class="icon" href="${p.historia_clinica}" target="_blank" rel="noopener" title="Historia clínica">🔗</a>` : '';
    const acciones = `${puedeAbrir ? `<button class="icon" data-id="${t.id}" data-act="abrir-ficha" title="Abrir ficha paciente" data-role-guard>📄</button>` : ''}${hcBtn}`;
    return `<tr class="row" style="grid-template-columns:${grid}">
      <td class="cell nowrap">${hora}</td>
      <td class="cell">${p.dni||'—'}</td>
      <td class="cell truncate">${titleCase(p.nombre)||'—'}</td>
      <td class="cell truncate">${titleCase(p.apellido)||'—'}</td>
      <td class="cell truncate">${p.obra_social||'—'}</td>
      ${withProf?`<td class="cell truncate">${profNameById(t.profesional_id)}</td>`:''}
      <td class="cell">${cop}</td>
      <td class="cell right"><div class="actions">${acciones}</div></td>
    </tr>`;
  }).join('');
  UI.tblDone.innerHTML = head + '<tbody>' + rows + '</tbody>';

  UI.tblDone.querySelectorAll('.icon').forEach(btn=>{
    const id=btn.getAttribute('data-id'), act=btn.getAttribute('data-act');
    if(act==='abrir-ficha') btn.onclick=()=> openFicha(id);
  });
}

/* ----- Año actual: límites y conteo de turnos OS ----- */
function yearBoundsISO(){
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const end   = new Date(now.getFullYear(), 11, 31);
  const toISO = (d)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { startISO: toISO(start), endISO: toISO(end) };
}
async function countTurnosOSAnio(pacienteId){
  if (!pacienteId) return 0;
  const { startISO, endISO } = yearBoundsISO();
  const { data, error } = await supabase
    .from('turnos')
    .select('id, estado, fecha, paciente_id, pacientes(obra_social)')
    .eq('paciente_id', pacienteId)
    .eq('estado', EST.ATENDIDO)
    .gte('fecha', startISO)
    .lte('fecha', endISO);

  if (error || !Array.isArray(data)) return 0;

  let count = 0;
  for (const t of data){
    const os = (t?.pacientes?.obra_social || '').trim().toLowerCase();
    if (os && os !== 'particular') count++;
  }
  return count;
}

/* Drawer: carga */
let drawerTurnoId = null;

async function loadObrasSociales(currentLabel){
  Drawer.obra.innerHTML = '<option value="">(Sin obra social)</option>';
  const { data } = await supabase.from('obras_sociales').select('obra_social').order('obra_social',{ascending:true});
  const labels = (data||[]).map(r=>r.obra_social);
  labels.forEach(lbl => {
    const opt=document.createElement('option');
    opt.value=lbl; opt.textContent=lbl; Drawer.obra.appendChild(opt);
  });
  if (currentLabel && !labels.includes(currentLabel)) {
    const opt=document.createElement('option'); opt.value=currentLabel; opt.textContent=currentLabel; Drawer.obra.appendChild(opt);
  }
  Drawer.obra.value = currentLabel || '';
}

function renderHeaderPaciente(p){
  const ape = titleCase(p?.apellido||'');
  const nom = titleCase(p?.nombre||'');
  const dni = (p?.dni || '—');
  const edad = calcEdad(p?.fecha_nacimiento);
  if (Drawer.title) Drawer.title.textContent = `Ficha paciente: ${[nom, ape].filter(Boolean).join(' ') || '—'}`;
  if (Drawer.sub)   Drawer.sub.textContent   = `dni ${dni} / ${edad!=null? `${edad} años`:'— años'}`;
  if (p?.historia_clinica){
    Drawer.hc.style.display='inline-flex';
    Drawer.hc.href = p.historia_clinica;
  } else {
    Drawer.hc.style.display='none';
    Drawer.hc.removeAttribute('href');
  }
}

async function openFicha(turnoId){
  if (!roleAllows('abrir_ficha', userRole)) { alert('No tenés permisos para abrir la ficha.'); return; }

  drawerTurnoId = turnoId;
  try { localStorage.setItem('current_turno_id', String(turnoId)); } catch {}
  setDrawerStatus('Cargando...');
  setDrawerMsg('');
  showDrawer();

  const { data:t, error:terr } = await supabase
    .from('turnos')
    .select('id, fecha, hora_inicio, hora_fin, estado, hora_arribo, copago, notas, paciente_id, profesional_id, centro_id')
    .eq('id', turnoId)
    .maybeSingle();

  if (terr || !t){ setDrawerStatus('No se pudo cargar el turno','warn'); console.error(terr); return; }

  const [pRes, profRes, centroRes] = await Promise.all([
    supabase.from('pacientes').select('id,dni,apellido,nombre,fecha_nacimiento,telefono,email,obra_social,numero_afiliado,credencial,contacto_nombre,contacto_apellido,contacto_celular,vinculo,historia_clinica,proximo_control,renovacion_receta,activo').eq('id', t.paciente_id).maybeSingle(),
    supabase.from('profesionales').select('display_name,nombre,apellido').eq('id', t.profesional_id).maybeSingle(),
    supabase.from('centros_medicos').select('nombre').eq('id', t.centro_id).maybeSingle(),
  ]);

  const p = pRes?.data || {};
  // const prof = profRes?.data || null; // reservado por si se muestra luego
  // const centro = centroRes?.data || null; // reservado por si se muestra luego

  Drawer.hora.textContent   = `Hora turno: ${t.hora_inicio ? toHM(t.hora_inicio) : '—'}`;
  Drawer.copago.textContent = `Copago: ${t.copago!=null ? fmtMoney(t.copago) : '—'}`;

  renderHeaderPaciente(p);

  Drawer.dni.value = p.dni || '';
  Drawer.ape.value = p.apellido || '';
  Drawer.nom.value = p.nombre || '';
  Drawer.nac.value = p.fecha_nacimiento || '';
  Drawer.tel.value = p.telefono || '';
  Drawer.mail.value= p.email || '';
  await loadObrasSociales(p.obra_social || '');
  Drawer.afiliado.value = p.numero_afiliado || '';
  Drawer.cred.value = p.credencial || '';
  Drawer.credLink.href = p.credencial || '#';
  if (!p.credencial) Drawer.credLink.setAttribute('tabindex','-1');

  Drawer.ecNom.value = p.contacto_nombre || '';
  Drawer.ecApe.value = p.contacto_apellido || '';
  Drawer.ecCel.value = p.contacto_celular || '';
  Drawer.ecVin.value = p.vinculo || '';

  Drawer.prox.value = p.proximo_control || '';
  Drawer.renov.value = p.renovacion_receta || '';
  Drawer.activo.checked = !!p.activo;

  Drawer.notas.value        = t.notas || '';

  if (Drawer.osYear){
    Drawer.osYear.textContent = 'Turnos OS en el año: —';
    try{
      const pacienteId = pRes?.data?.id || t.paciente_id;
      const n = await countTurnosOSAnio(pacienteId);
      Drawer.osYear.textContent = `Turnos OS en el año: ${n}`;
    }catch{}
  }

  setDrawerStatus('');

  Drawer.btnFinalizar.style.display = roleAllows('finalizar', userRole) ? '' : 'none';
  Drawer.btnGuardar.style.display   = roleAllows('abrir_ficha', userRole) ? '' : 'none';
}

/* Guardar / Finalizar */
function validatePaciente(){
  const faltan = [];
  if (!Drawer.dni.value.trim()) faltan.push('DNI');
  if (!Drawer.ape.value.trim()) faltan.push('Apellido');
  if (!Drawer.nom.value.trim()) faltan.push('Nombre');
  if (faltan.length){ setDrawerMsg('Faltan: '+faltan.join(', '), 'warn'); return false; }
  return true;
}
async function guardarFicha(){
  if (!drawerTurnoId) return;
  if (!roleAllows('abrir_ficha', userRole)) { alert('No tenés permisos para guardar.'); return; }
  if (!validatePaciente()) return;
  setDrawerMsg('Guardando...');

  const { data: t } = await supabase.from('turnos').select('paciente_id').eq('id', drawerTurnoId).maybeSingle();
  const pacienteId = t?.paciente_id;
  if (!pacienteId){ setDrawerMsg('No se encontró paciente del turno','warn'); return; }

  const payloadP = {
    dni: Drawer.dni.value.trim(),
    apellido: Drawer.ape.value.trim(),
    nombre: Drawer.nom.value.trim(),
    fecha_nacimiento: Drawer.nac.value || null,
    telefono: Drawer.tel.value.trim() || null,
    email: Drawer.mail.value.trim() || null,
    obra_social: Drawer.obra.value || null,
    numero_afiliado: Drawer.afiliado.value.trim() || null,
    credencial: Drawer.cred.value.trim() || null,
    contacto_nombre: Drawer.ecNom.value.trim() || null,
    contacto_apellido: Drawer.ecApe.value.trim() || null,
    contacto_celular: Drawer.ecCel.value.trim() || null,
    vinculo: Drawer.ecVin.value.trim() || null,
    historia_clinica: Drawer.hc?.href || null,
    proximo_control: Drawer.prox.value || null,
    renovacion_receta: Drawer.renov.value || null,
    activo: Drawer.activo.checked,
  };
  const payloadTurno = { notas: Drawer.notas.value || null };

  const [r1, r2] = await Promise.all([
    supabase.from('pacientes').update(payloadP).eq('id', pacienteId),
    supabase.from('turnos').update(payloadTurno).eq('id', drawerTurnoId),
  ]);
  if (r1.error){ setDrawerMsg('Error guardando paciente: '+r1.error.message,'warn'); return; }
  if (r2.error){ setDrawerMsg('Error guardando notas: '+r2.error.message,'warn'); return; }

  renderHeaderPaciente({
    dni: payloadP.dni,
    apellido: payloadP.apellido,
    nombre: payloadP.nombre,
    fecha_nacimiento: payloadP.fecha_nacimiento,
    historia_clinica: payloadP.historia_clinica
  });
  setDrawerMsg('Cambios guardados.','ok');
  setTimeout(()=> setDrawerMsg(''), 1500);
}
if (Drawer.btnGuardar) Drawer.btnGuardar.onclick = guardarFicha;
if (Drawer.btnFinalizar){
  Drawer.btnFinalizar.style.display = roleAllows('finalizar', userRole) ? '' : 'none';
  Drawer.btnFinalizar.onclick = () => finalizarAtencion(drawerTurnoId, { closeDrawer: true });
}
if (Drawer.cred) Drawer.cred.addEventListener('input', ()=>{ Drawer.credLink.href = Drawer.cred.value || '#'; });
if (Drawer.nac) Drawer.nac.addEventListener('change', ()=>{
  const dniTxt = (Drawer.sub.textContent||'').split(' / ')[0] || '';
  const edad = calcEdad(Drawer.nac.value);
  Drawer.sub.textContent = `${dniTxt.trim()} / ${edad!=null? `${edad} años`:'— años'}`;
});

/* Acciones por rol */
async function volverASalaEspera(turnoId){
  if (!roleAllows('atender', userRole)) { alert('No tenés permisos.'); return; }
  await supabase.from('turnos').update({estado:EST.EN_ESPERA}).eq('id', turnoId);
  await refreshAll();
}
async function finalizarAtencion(turnoId, { closeDrawer = false } = {}) {
  if (!roleAllows('finalizar', userRole)) { alert('No tenés permisos.'); return; }
  const id = turnoId ?? drawerTurnoId; if (!id) return;
  if (!confirm('¿Marcar este turno como ATENDIDO?')) return;

  const { error } = await supabase
    .from('turnos')
    .update({ estado: EST.ATENDIDO })
    .eq('id', id)
    .eq('estado', EST.EN_ATENCION);

  if (error) {
    alert(error.message || 'No se pudo finalizar.');
    return;
  }

  if (closeDrawer) hideDrawer();
  await refreshAll();
}
async function marcarLlegadaYCopago(turnoId){
  if (!roleAllows('arribo', userRole)) { alert('No tenés permisos.'); return; }

  const { data: t } = await supabase
    .from('turnos')
    .select('id, pacientes(obra_social)')
    .eq('id', turnoId)
    .single();

  let copago=null, obra=t?.pacientes?.obra_social||null;
  if (obra){
    const { data: os } = await supabase
      .from('obras_sociales')
      .select('condicion_copago, valor_copago')
      .eq('obra_social', obra)
      .maybeSingle();
    if (os && os.condicion_copago===true && os.valor_copago!=null) copago=os.valor_copago;
  }
  await supabase.from('turnos').update({ estado: EST.EN_ESPERA, hora_arribo: nowHHMMSS(), copago }).eq('id', turnoId);
  await refreshAll();
}

/* Pasar a En atención */
async function pasarAEnAtencion(turnoId, ev) {
  if (ev) ev.preventDefault();
  if (!roleAllows('atender', userRole)) { alert('Solo AMP/Médico pueden atender pacientes.'); return; }

  const { error } = await supabase
    .from('turnos')
    .update({ estado: EST.EN_ATENCION })
    .eq('id', turnoId);

  if (error) { alert('No se pudo pasar a "En atención".'); return; }
  await refreshAll();
  await openFicha(turnoId);
}

/* Cancelar turno */
async function anularTurno(turnoId){
  if (!roleAllows('cancelar', userRole)) { alert('No tenés permisos para anular.'); return; }
  if (!confirm('¿Anular este turno?')) return;
  const { error } = await supabase.from('turnos').update({ estado: EST.CANCELADO }).eq('id', turnoId);
  if (error) { alert('No se pudo anular.'); return; }
  await refreshAll();
}

/* KPIs y títulos */
function computeHorasDisponibles(agenda, turnos){
  const totalAgendaMin=(agenda||[]).reduce((acc,b)=>acc+minutesDiff(toHM(b.hora_inicio), toHM(b.hora_fin)),0);
  const ocupadosMin=(turnos||[]).filter(t=>t.estado!==EST.CANCELADO)
    .reduce((acc,t)=>acc+(t.hora_fin?minutesDiff(toHM(t.hora_inicio), toHM(t.hora_fin)):0),0);
  const libresMin=Math.max(0,totalAgendaMin-ocupadosMin);
  return { horas:(libresMin/60).toFixed(1), libresMin, totalAgendaMin };
}
function formatFreeTime(mins) {
  mins = Math.max(0, Math.round(Number(mins||0)));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} h ${m} min`;
}
function profsLabel(){
  const sel = UI.profSelect;
  if (!sel) return '—';
  if (!sel.multiple) return sel.options[sel.selectedIndex]?.textContent || '—';
  const names = Array.from(sel.selectedOptions).map(o => o.textContent).filter(Boolean);
  if (names.length === 0) return '—';
  if (names.length === 1) return names[0];
  if (names.length <= 3) return names.join(', ');
  return `${names.length} profesionales`;
}
function renderKPIs({agenda, turnos}){
  const free=computeHorasDisponibles(agenda, turnos);
  UI.kpiFree.textContent = `${formatFreeTime(free.libresMin)} disponibles`;
  safeSet(UI.kpiSub, `${currentCentroNombre || ''} · ${profsLabel()} · ${currentFechaISO}`);
}
function renderBoardTitles({pendientes, presentes, atencion, atendidos}){
  if (H.pend)  H.pend.textContent  = `Por llegar (${(pendientes||[]).length})`;
  if (H.esp)   H.esp.textContent   = `En sala de espera (${(presentes||[]).length})`;
  if (H.atenc) H.atenc.textContent = `En atención (${(atencion||[]).length})`;
  if (H.done)  H.done.textContent  = `Atendidos (${(atendidos||[]).length})`;
}

/* Buscador masivo */
let searchTimer=null;
function applySearch(value){ filterText = norm((value||'').trim()); refreshAll(); }
if (UI.massSearch) UI.massSearch.addEventListener('input', ()=>{
  clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>applySearch(UI.massSearch.value), 160);
});
if (UI.massClear) UI.massClear.addEventListener('click', ()=>{ UI.massSearch.value=''; applySearch(''); });

/* Controles A− / A / A+ */
const zDec   = document.getElementById('zoom-dec');
const zInc   = document.getElementById('zoom-inc');
const zReset = document.getElementById('zoom-reset');
function setFs(px){ fsPx = Math.min(FONT.max, Math.max(FONT.min, px)); localStorage.setItem(FONT.key, String(fsPx)); applyFs(fsPx); }
if (zDec)   zDec.addEventListener('click',  ()=> setFs(fsPx - FONT.step));
if (zInc)   zInc.addEventListener('click',  ()=> setFs(fsPx + FONT.step));
if (zReset) zReset.addEventListener('click',()=> setFs(FONT.def));

/* ====== Layout persistente (ampliar/expandir) ====== */
const boardsEl = document.getElementById('boards');
const LAYOUT = {
  rowsKey: 'boards_rows_v1',
  expandKey: 'board_expanded_v1',
  baseH: parseInt(getComputedStyle(document.documentElement).getPropertyValue('--board-h')) || 420,
  big: 1.6,
  small: 0.6,
};
function applyRowsFromStorage(){
  const raw = localStorage.getItem(LAYOUT.rowsKey);
  let r1 = LAYOUT.baseH, r2 = LAYOUT.baseH;
  try { if (raw){ const o = JSON.parse(raw); if (o.row1>0) r1=o.row1; if (o.row2>0) r2=o.row2; } } catch {}
  document.documentElement.style.setProperty('--row-1', r1+'px');
  document.documentElement.style.setProperty('--row-2', r2+'px');
}
function saveRows(r1,r2){ localStorage.setItem(LAYOUT.rowsKey, JSON.stringify({row1:r1,row2:r2})); }
function getRows(){
  const r1 = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-1')) || LAYOUT.baseH;
  const r2 = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-2')) || LAYOUT.baseH;
  return { r1, r2 };
}
function resetSplit(){
  document.documentElement.style.setProperty('--row-1', LAYOUT.baseH+'px');
  document.documentElement.style.setProperty('--row-2', LAYOUT.baseH+'px');
  saveRows(LAYOUT.baseH, LAYOUT.baseH);
}
function isTop(board){
  const order = ['pend','esp','atencion','done'];
  const idx = order.indexOf(board.dataset.board);
  return idx===0 || idx===1; // pend/esp están arriba
}
function toggleGrowFor(board){
  // Si está expandido, no permitir grow; primero salir de expand
  if (boardsEl.classList.contains('fullmode')) return;

  const {r1,r2} = getRows();
  const BIG = Math.round(LAYOUT.baseH * LAYOUT.big);
  const SMALL = Math.round(LAYOUT.baseH * LAYOUT.small);

  if (isTop(board)){
    // Si ya está grande la fila 1, restaurar; si no, agrandar 1 y achicar 2
    const nextR1 = r1>LAYOUT.baseH ? LAYOUT.baseH : BIG;
    const nextR2 = nextR1>LAYOUT.baseH ? SMALL : LAYOUT.baseH;
    document.documentElement.style.setProperty('--row-1', nextR1+'px');
    document.documentElement.style.setProperty('--row-2', nextR2+'px');
    saveRows(nextR1, nextR2);
  } else {
    const nextR2 = r2>LAYOUT.baseH ? LAYOUT.baseH : BIG;
    const nextR1 = nextR2>LAYOUT.baseH ? SMALL : LAYOUT.baseH;
    document.documentElement.style.setProperty('--row-1', nextR1+'px');
    document.documentElement.style.setProperty('--row-2', nextR2+'px');
    saveRows(nextR1, nextR2);
  }
}
function expandBoard(board){
  boardsEl.classList.add('fullmode');
  boardsEl.querySelectorAll('.board').forEach(b=> b.classList.remove('expanded'));
  board.classList.add('expanded');
  localStorage.setItem(LAYOUT.expandKey, board.dataset.board || '');
}
function collapseBoards(){
  boardsEl.classList.remove('fullmode');
  boardsEl.querySelectorAll('.board').forEach(b=> b.classList.remove('expanded'));
  localStorage.removeItem(LAYOUT.expandKey);
}
function setupBoardControls(){
  applyRowsFromStorage();

  // Restaurar expand anterior si existía
  const prev = localStorage.getItem(LAYOUT.expandKey);
  if (prev){
    const b = boardsEl.querySelector(`.board[data-board="${prev}"]`);
    if (b) expandBoard(b);
  }

  boardsEl.querySelectorAll('.board').forEach(board=>{
    const grow = board.querySelector('.b-ctrl--grow');
    const exp  = board.querySelector('.b-ctrl--expand');
    const cls  = board.querySelector('.b-ctrl--collapse');

    if (grow) grow.addEventListener('click', ()=> toggleGrowFor(board));
    if (exp)  exp.addEventListener('click',  ()=> expandBoard(board));
    if (cls)  cls.addEventListener('click',  ()=> collapseBoards());
  });

  // Esc para cerrar expand
  document.addEventListener('keydown', (ev)=>{
    if (ev.key==='Escape' && boardsEl.classList.contains('fullmode')) collapseBoards();
  });

  // Si pasa a 1 columna (<=1100px), normalizamos filas
  const mq = window.matchMedia('(max-width:1100px)');
  function onChange(){ if (mq.matches) resetSplit(); }
  mq.addEventListener('change', onChange);
  onChange();
}

/* Refresh & Init */
async function refreshAll(){
  if(!selectedProfesionales.length){
    UI.tblPend.innerHTML=''; UI.tblEsp.innerHTML=''; UI.tblAtencion.innerHTML=''; UI.tblDone.innerHTML='';
    safeSet(UI.kpiSub, `${currentCentroNombre||''} · ${currentFechaISO}`);
    renderBoardTitles({pendientes:[],presentes:[],atendidos:[],atencion:[]});
    return;
  }
  const raw = await fetchDiaData();
  const filtered = applyFilter(raw);

  renderPendientes(filtered.pendientes);
  renderPresentes(filtered.presentes);
  renderAtencion(filtered.atencion);
  renderAtendidos(filtered.atendidos);

  renderKPIs(raw);
  renderBoardTitles(filtered);
}
async function initInicio(){
  try {
    localStorage.removeItem('reprogram_turno_intent');
    localStorage.removeItem('turnos_prefill');
  } catch {}

  currentCentroId = localStorage.getItem('centro_medico_id');
  currentCentroNombre = localStorage.getItem('centro_medico_nombre') || (await fetchCentroById(currentCentroId));
  if (UI.centroChip) UI.centroChip.textContent = currentCentroNombre || '';

  await loadProfesionales();
  currentFechaISO = UI.fecha.value || todayISO();
  try { localStorage.setItem('inicio_url', location.href); } catch {}

  setupBoardControls();
  await refreshAll();
  startCentroWatcher();
}
await initInicio();
