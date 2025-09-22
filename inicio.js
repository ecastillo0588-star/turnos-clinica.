// inicio.js
// -----------------------------------------------
import supabase from './supabaseClient.js';
import { applyRoleClasses, loadProfesionalesIntoSelect, roleAllows } from './global.js';

/* =======================
   Constantes / utilidades
   ======================= */
const EST = {
  ASIGNADO:     'asignado',
  EN_ESPERA:    'en_espera',
  EN_ATENCION:  'en_atencion',
  CANCELADO:    'cancelado',
  CONFIRMADO:   'confirmado',
  ATENDIDO:     'atendido',
};

const FONT = { key:'ui_fs_px', def:14, min:12, max:18, step:1 };

const pad2 = n => (n<10?'0'+n:''+n);
const todayISO = () => { const d=new Date(); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; };
const toHM = t => (t??'').toString().slice(0,5);
const strip = s => (s??'').toString().normalize('NFD').replace(/\p{Diacritic}/gu,'');
const norm  = s => strip(s).toLowerCase().trim();
const safeSet = (el, text) => { if (el) el.textContent = text; };
const money = n => new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(n||0));
const titleCase = s => (s||'').split(' ').filter(Boolean).map(w=> w[0]?.toUpperCase()+w.slice(1).toLowerCase()).join(' ');
const minutesDiff = (start, end) => {
  const [h1,m1]=start.split(':').map(Number);
  const [h2,m2]=end.split(':').map(Number);
  return (h2*60+m2)-(h1*60+m1);
};
const nowHHMMSS = () => { const d=new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };

/* =======================
   Estado de módulo
   ======================= */
let UI = {};
let H  = {};
let Drawer = {};
let boardsEl, zDec, zInc, zReset;

let fsPx;

let currentCentroId       = null;
let currentCentroNombre   = '';
let currentFechaISO       = null;
let selectedProfesionales = [];
let filterText            = '';

let waitTimer        = null;

// mapa id -> nombre profesional
let PROF_NAME = new Map();

// control de carga y de carrera
let _refresh = { reqId: 0, abort: null };

/* =======================
   Binder de referencias
   ======================= */
function bindUI(root = document) {
  UI = {
    centroChip: root.querySelector('#centro-chip'),
    profSelect: root.querySelector('#prof-select'),
    fecha:      root.querySelector('#fecha'),
    btnHoy:     root.querySelector('#btn-hoy'),
    tblPend:    root.querySelector('#tbl-pend'),
    tblEsp:     root.querySelector('#tbl-esp'),
    tblAtencion:root.querySelector('#tbl-atencion'),
    tblDone:    root.querySelector('#tbl-done'),
    kpiFree:    root.querySelector('#kpi-free'),
    kpiSub:     root.querySelector('#kpi-sub'),
    massSearch: root.querySelector('#mass-search'),
    massClear:  root.querySelector('#mass-clear'),
  };

     H = {
      pend:  root.querySelector('#hl-pend'),
      esp:   root.querySelector('#hl-esp'),
      atenc: root.querySelector('#hl-atencion'),
      done:  root.querySelector('#hl-done'),
    };

  Drawer = {
    el:        root.querySelector('#fichaDrawer'),
    close:     root.querySelector('#fd-close'),
    status:    root.querySelector('#fd-status'),
    msg:       root.querySelector('#fd-msg'),
    title:     root.querySelector('#fd-title'),
    sub:       root.querySelector('#fd-sub'),
    osYear:    root.querySelector('#fd-os-year'),
    hc:        root.querySelector('#fd-hc'),
    prof:      root.querySelector('#fd-prof'),
    centro:    root.querySelector('#fd-centro'),
    fecha:     root.querySelector('#fd-fecha'),
    hora:      root.querySelector('#fd-hora'),
    estado:    root.querySelector('#fd-estado'),
    copago:    root.querySelector('#fd-copago'),
    dni:       root.querySelector('#fd-dni'),
    ape:       root.querySelector('#fd-apellido'),
    nom:       root.querySelector('#fd-nombre'),
    nac:       root.querySelector('#fd-nac'),
    tel:       root.querySelector('#fd-tel'),
    mail:      root.querySelector('#fd-mail'),
    obra:      root.querySelector('#fd-obra'),
    afiliado:  root.querySelector('#fd-afiliado'),
    cred:      root.querySelector('#fd-cred'),
    credLink:  root.querySelector('#fd-cred-link'),
    ecNom:     root.querySelector('#fd-ec-nom'),
    ecApe:     root.querySelector('#fd-ec-ape'),
    ecCel:     root.querySelector('#fd-ec-cel'),
    ecVin:     root.querySelector('#fd-ec-vin'),
    prox:      root.querySelector('#fd-prox'),
    renov:     root.querySelector('#fd-renov'),
    activo:    root.querySelector('#fd-activo'),
    notas:     root.querySelector('#fd-notas'),
    btnCerrar: root.querySelector('#fd-cerrar'),
    btnGuardar:root.querySelector('#fd-guardar'),
    btnFinalizar:root.querySelector('#fd-finalizar'),
  };

  boardsEl = root.querySelector('#boards');
  zDec   = root.querySelector('#zoom-dec');
  zInc   = root.querySelector('#zoom-inc');
  zReset = root.querySelector('#zoom-reset');

  // drawer: cierres
  if (Drawer.close)     Drawer.close.onclick     = hideDrawer;
  if (Drawer.btnCerrar) Drawer.btnCerrar.onclick = hideDrawer;
}

/* =======================
   Delegación: cambio de profesional
   ======================= */
function handleProfChange(target){
  if (!target || target.id !== 'prof-select') return;
  selectedProfesionales = target.multiple
    ? Array.from(target.selectedOptions).map(o => o.value).filter(Boolean)
    : (target.value ? [target.value] : []);
  saveProfSelection();
  refreshAll({ showOverlayIfSlow: false });
}
// Escucha a nivel documento (funciona aunque el <select> se reemplace)
document.addEventListener('change', (e) => handleProfChange(e.target));

/* =======================
   Overlay de “Cargando…”
   ======================= */
function ensureOverlay(root) {
  if (root.querySelector('#inicio-loading')) return;

  const style = document.createElement('style');
  style.textContent = `
  #inicio-loading{position:relative}
  #inicio-loading.show .mask{opacity:1;pointer-events:all}
  #inicio-loading .mask{
    position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    background:rgba(255,255,255,.85); transition:opacity .18s ease; opacity:0; pointer-events:none; z-index:50;
    border-radius:12px;
  }
  .spin{width:34px;height:34px;border-radius:50%;border:3px solid #d9d1f3;border-top-color:#7656b0;animation:rr .8s linear infinite;margin-right:10px}
  @keyframes rr{to{transform:rotate(360deg)}}
  `;
  document.head.appendChild(style);

  const wrap = document.createElement('div');
  wrap.id = 'inicio-loading';
  wrap.innerHTML = `<div class="mask"><div class="spin"></div><div style="color:#4f3b7a;font-weight:600">Cargando…</div></div>`;
  root.style.position = 'relative';
  root.appendChild(wrap);
}
function setLoading(root, on) {
  const cont = root.querySelector('#inicio-loading');
  if (!cont) return;
  cont.classList.toggle('show', !!on);
}

/* =======================
   Preferencias (FS, centro, prof)
   ======================= */
function applyFs(px){ document.documentElement.style.setProperty('--fs', `${px}px`); }
function loadFs(){
  const v = parseInt(localStorage.getItem(FONT.key), 10);
  const px = Number.isFinite(v) ? Math.min(FONT.max, Math.max(FONT.min, v)) : FONT.def;
  applyFs(px); fsPx = px;
}
function setFs(px){ fsPx = Math.min(FONT.max, Math.max(FONT.min, px)); localStorage.setItem(FONT.key, String(fsPx)); applyFs(fsPx); }

// per-centro
function profSelKey(){ return `inicio_prof_sel_${currentCentroId||'any'}`; }
function getSavedProfIds(){
  try{ const s=localStorage.getItem(profSelKey()); if(!s) return null; const a=JSON.parse(s); return Array.isArray(a)?a.map(String):null; }catch{ return null; }
}
function saveProfSelection(){
  const sel = document.querySelector('#prof-select');
  if(!sel) return;
  const ids = sel.multiple
    ? Array.from(sel.selectedOptions).map(o=>o.value).filter(Boolean)
    : (sel.value ? [sel.value] : []);
  try{ localStorage.setItem(profSelKey(), JSON.stringify(ids)); }catch{}
}
function restoreProfSelection(){
  const sel=document.querySelector('#prof-select'); if(!sel) return false;
  const saved = getSavedProfIds(); if(!saved || !saved.length) return false;
  const values = new Set(saved.map(String));
  let firstSelected=null;
  Array.from(sel.options).forEach(o=>{
    if(!o.value) return;
    if(values.has(String(o.value))){ o.selected=true; if(!firstSelected) firstSelected=o.value; }
    else if(sel.multiple){ o.selected=false; }
  });
  if(!sel.multiple) sel.value = firstSelected || '';
  selectedProfesionales = sel.multiple
    ? Array.from(sel.selectedOptions).map(o=>o.value).filter(Boolean)
    : (sel.value ? [sel.value] : []);
  return selectedProfesionales.length>0;
}

async function fetchCentroById(id){
  if(!id) return '';
  const { data } = await supabase.from('centros_medicos').select('nombre').eq('id', id).maybeSingle();
  return data?.nombre || '';
}
function renderCentroChip(){ if (UI.centroChip) UI.centroChip.textContent = currentCentroNombre || '—'; }

async function syncCentroFromStorage(force=false){
  const id  = localStorage.getItem('centro_medico_id');
  const nom = localStorage.getItem('centro_medico_nombre') || currentCentroNombre;
  if (force || id !== currentCentroId || nom !== currentCentroNombre){
    currentCentroId     = id;
    currentCentroNombre = nom || await fetchCentroById(id);
    localStorage.setItem('centro_medico_nombre', currentCentroNombre);
    renderCentroChip();
    await loadProfesionales();
    if (!restoreProfSelection()) saveProfSelection();
    await refreshAll();
  }
}

function startCentroWatcher(){
  syncCentroFromStorage(true);
  stopCentroWatcher();

  // Cambios en otras pestañas
  _centroStorageHandler = (e)=>{
    if (e.key==='centro_medico_id' || e.key==='centro_medico_nombre'){
      syncCentroFromStorage(true);
    }
  };
  window.addEventListener('storage', _centroStorageHandler);

  // Cambios en esta misma SPA
  window.addEventListener("centro-cambiado", e => {
    const { id, nombre } = e.detail;
    currentCentroId     = id;
    currentCentroNombre = nombre;
    renderCentroChip();
    loadProfesionales().then(()=> refreshAll());
  });
}

function stopCentroWatcher(){
  if (_centroStorageHandler){
    window.removeEventListener('storage', _centroStorageHandler);
    _centroStorageHandler = null;
  }
}

/* =======================
   Profesionales
   ======================= */
const userRole             = String(localStorage.getItem('user_role')||'').toLowerCase();
const loggedProfesionalId  = localStorage.getItem('profesional_id');

function rebuildProfMap(){
  PROF_NAME.clear();
  const sel = document.querySelector('#prof-select');
  Array.from(sel?.options || []).forEach(o=>{
    if(o.value) PROF_NAME.set(String(o.value), (o.textContent||'').trim());
  });
}
const profNameById = id => PROF_NAME.get(String(id)) || '—';

async function loadProfesionales(){
  const sel = document.querySelector('#prof-select');
  if (!sel) return;

  // AMC: multiselección
  if (userRole === 'amc') {
    sel.multiple = true;
    sel.classList.remove('compact');
  } else {
    sel.multiple = false;
  }

  await loadProfesionalesIntoSelect(sel, {
    role: userRole,
    centroId: currentCentroId,
    loggedProfesionalId,
  });

  rebuildProfMap();

  // Intentar restaurar selección previa; si no, default razonable
  if (!restoreProfSelection()){
    if (sel.multiple) {
      selectedProfesionales = Array.from(sel.options)
        .filter(o=>o.value)
        .map(o => { o.selected=true; return o.value; });
      sel.size = Math.min(10, Math.max(4, selectedProfesionales.length || 6));
    } else {
      const preferred = Array.from(sel.options).find(o=> o.value && String(o.value)===String(loggedProfesionalId));
      const first = preferred || Array.from(sel.options).find(o=>o.value);
      if (first){ sel.value = first.value; selectedProfesionales = [first.value]; }
      else       { selectedProfesionales = []; }
    }
    saveProfSelection();
  }
}

/* =======================
   Filtro global + Zoom
   ======================= */
let searchTimer=null;
function applySearch(value){ filterText = norm((value||'').trim()); refreshAll(); }

/* =======================
   Layout (grow/expand)
   ======================= */
const LAYOUT = {
  rowsKey:   'boards_rows_v1',
  expandKey: 'board_expanded_v1',
  baseH:     420,
  big:       1.6,
  small:     0.6,
};
function applyRowsFromStorage(){
  const raw = localStorage.getItem(LAYOUT.rowsKey);
  let r1 = LAYOUT.baseH, r2 = LAYOUT.baseH;
  try{ if (raw){ const o=JSON.parse(raw); if (o.row1>0) r1=o.row1; if (o.row2>0) r2=o.row2; } }catch{}
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
function isTop(board){ const order=['pend','esp','atencion','done']; const idx=order.indexOf(board.dataset.board); return idx===0 || idx===1; }
function toggleGrowFor(board){
  if (!boardsEl || boardsEl.classList.contains('fullmode')) return;
  const {r1,r2} = getRows();
  const BIG   = Math.round(LAYOUT.baseH * LAYOUT.big);
  const SMALL = Math.round(LAYOUT.baseH * LAYOUT.small);

  if (isTop(board)){
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
  if (!boardsEl) return;
  boardsEl.classList.add('fullmode');
  boardsEl.querySelectorAll('.board').forEach(b=> b.classList.remove('expanded'));
  board.classList.add('expanded');
  localStorage.setItem(LAYOUT.expandKey, board.dataset.board || '');
}
function collapseBoards(){
  if (!boardsEl) return;
  boardsEl.classList.remove('fullmode');
  boardsEl.querySelectorAll('.board').forEach(b=> b.classList.remove('expanded'));
  localStorage.removeItem(LAYOUT.expandKey);
}
function ensureBoardCtrlMarkup(){
  if (!boardsEl) return;
  boardsEl.querySelectorAll('.board').forEach(board=>{
    let ctrls = board.querySelector('.b-ctrls');
    if (!ctrls) {
      ctrls = document.createElement('div');
      ctrls.className = 'b-ctrls';
      ctrls.innerHTML = `
        <button class="b-ctrl b-ctrl--grow"     title="Agrandar fila">↕︎</button>
        <button class="b-ctrl b-ctrl--expand"   title="Expandir">⤢</button>
        <button class="b-ctrl b-ctrl--collapse" title="Restaurar">⤡</button>
      `;
      (board.querySelector('.b-head') || board).appendChild(ctrls);
    }
  });
}
function setupBoardControls(){
  applyRowsFromStorage();
  if (!boardsEl) return;

  ensureBoardCtrlMarkup();

  const prev = localStorage.getItem(LAYOUT.expandKey);
  if (prev){
    const b = boardsEl.querySelector(`.board[data-board="${prev}"]`);
    if (b) expandBoard(b);
  }

  boardsEl.querySelectorAll('.board').forEach(board=>{
    const grow     = board.querySelector('.b-ctrl--grow');
    const expand   = board.querySelector('.b-ctrl--expand');
    const collapse = board.querySelector('.b-ctrl--collapse');
    if (grow)     grow.onclick     = () => toggleGrowFor(board);
    if (expand)   expand.onclick   = () => expandBoard(board);
    if (collapse) collapse.onclick = () => collapseBoards();
  });

  document.addEventListener('keydown', (ev)=>{
    if (ev.key === 'Escape' && boardsEl.classList.contains('fullmode')) collapseBoards();
  });

  const mq = window.matchMedia('(max-width:1100px)');
  const onChange = ()=>{ if (mq.matches) resetSplit(); };
  mq.addEventListener('change', onChange); onChange();
}

/* =======================
   Datos del día (con abort)
   ======================= */
async function fetchDiaData(/*signal*/){
  if(!selectedProfesionales.length){
    return { pendientes:[], presentes:[], atencion:[], atendidos:[], agenda:[], turnos:[] };
  }

  const profIds = selectedProfesionales.map(String);
  const selectCols = `
    id, fecha, hora_inicio, hora_fin, estado, hora_arribo, copago, paciente_id, profesional_id,
    pacientes(id, dni, nombre, apellido, obra_social, historia_clinica)
  `;
  const byHora = (a,b) => (toHM(a.hora_inicio) || '').localeCompare(toHM(b.hora_inicio) || '');

  // 1) Todos los turnos del día
  const { data: allTurnosRaw = [] } = await supabase
    .from('turnos')
    .select(selectCols)
    .eq('centro_id', currentCentroId)
    .eq('fecha', currentFechaISO)
    .in('profesional_id', profIds);
  const allTurnos = (allTurnosRaw || []).slice().sort(byHora);

  // 2) Agenda del día (para KPIs)
  const { data: agenda = [] } = await supabase
    .from('agenda')
    .select('id, fecha, hora_inicio, hora_fin, profesional_id')
    .eq('centro_id', currentCentroId)
    .eq('fecha', currentFechaISO)
    .in('profesional_id', profIds);

  const pendientes = allTurnos.filter(t=>t.estado===EST.ASIGNADO );
  const presentes  = allTurnos.filter(t=>t.estado===EST.EN_ESPERA );
  const atencion   = allTurnos.filter(t=>t.estado===EST.EN_ATENCION);
  const atendidos  = allTurnos.filter(t=>t.estado===EST.ATENDIDO );

  return { pendientes, presentes, atencion, atendidos, agenda, turnos: allTurnos };
}

function applyFilter(data){
  if (!filterText) return data;
  const match = t => {
    const p=t.pacientes||{};
    return norm(p.apellido).includes(filterText) || String(p.dni||'').includes(filterText);
  };
  return {
    pendientes:(data.pendientes||[]).filter(match),
    presentes: (data.presentes ||[]).filter(match),
    atencion:  (data.atencion  ||[]).filter(match),
    atendidos: (data.atendidos ||[]).filter(match),
    agenda:    data.agenda||[],
    turnos:    data.turnos||[],
  };
}

/* =======================
   Render de tablas
   ======================= */
const showProfColumn = ()=> {
  const sel = document.querySelector('#prof-select');
  return sel?.multiple || selectedProfesionales.length > 1;
};

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
        ${puedeCancelar ? `<button class="icon" data-id="${t.id}" data-act="cancel" title="Anular">🗑️</button>` : ''}
        ${puedeArribo   ? `<button class="icon" data-id="${t.id}" data-act="arribo" title="Pasar a En espera">🟢</button>` : ''}
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

/* En sala de espera */
function startWaitTicker(){ if(waitTimer) clearInterval(waitTimer); waitTimer=setInterval(updateWaitBadges, 30000); }
function updateWaitBadges(){
  const now = new Date();
  const scope = UI.tblEsp || document;
  const nodes = scope.querySelectorAll('[data-arribo-ts]');
  nodes.forEach(n=>{
    const ts=n.getAttribute('data-arribo-ts'); if(!ts) return;
    const ms = now - new Date(ts);
    const mins = Math.max(0, Math.round(ms/60000));
    const hh = Math.floor(mins/60), mm = mins%60;
    n.textContent = hh ? `${hh}h ${mm}m` : `${mm}m`;
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
      <th class="cell">Copago</th><th class="cell right">Acciones</th></tr></thead>`;

  const puedeVolver   = roleAllows('volver', userRole);
  const puedeCancelar = roleAllows('cancelar', userRole);
  const puedeAtender  = roleAllows('atender', userRole);

  const rows=(list||[]).map(t=>{
    const p=t.pacientes||{};
    const hora=`<b>${toHM(t.hora_inicio)}</b>${t.hora_fin?' — '+toHM(t.hora_fin):''}`;
    const arriboISO=`${currentFechaISO}T${toHM(t.hora_arribo)||'00:00'}:00`;
    const copBadge=(t.copago && Number(t.copago)>0)?`<span class="copago">${money(t.copago)}</span>`:`<span class="copago none">Sin copago</span>`;
    const acciones = `
      ${puedeVolver   ? `<button class="icon" data-id="${t.id}" data-act="volver" title="Volver a pendientes">↩️</button>` : ''}
      ${puedeCancelar ? `<button class="icon" data-id="${t.id}" data-act="cancel" title="Anular">🗑️</button>` : ''}
      ${puedeAtender  ? `<button class="icon" data-id="${t.id}" data-act="atender" title="En atención">✅</button>` : ''}`;
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

/* En atención */
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
      ${puedeAbrir   ? `<button class="icon" data-id="${t.id}" data-act="abrir-ficha"   title="Abrir ficha">📄</button>` : ''}
      ${puedeVolverE ? `<button class="icon" data-id="${t.id}" data-act="volver-espera" title="Volver a espera">⏪</button>` : ''}
      ${puedeFin     ? `<button class="icon" data-id="${t.id}" data-act="finalizar"     title="Marcar ATENDIDO">✅</button>` : ''}`;
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
    if(act==='abrir-ficha')    btn.onclick=()=> openFicha(id);
    if(act==='volver-espera')  btn.onclick=()=> volverASalaEspera(id);
    if(act==='finalizar')      btn.onclick=()=> finalizarAtencion(id);
  });
}

/* Atendidos */
function renderAtendidos(list) {
  const withProf = showProfColumn();

  const grid = withProf
    ? `var(--w-hora) var(--w-dni) minmax(var(--minch-nombre),1fr) 
       minmax(var(--minch-apellido),1fr) minmax(var(--minch-obra),1fr) 
       var(--w-prof) var(--w-copago) var(--w-acc)`
    : `var(--w-hora) var(--w-dni) minmax(var(--minch-nombre),1fr) 
       minmax(var(--minch-apellido),1fr) minmax(var(--minch-obra),1fr) 
       var(--w-copago) var(--w-acc)`;

  const head = `
    <thead class="thead">
      <tr class="hrow" style="grid-template-columns:${grid}">
        <th class="cell">Hora</th>
        <th class="cell">DNI</th>
        <th class="cell">Nombre</th>
        <th class="cell">Apellido</th>
        <th class="cell">Obra social</th>
        ${withProf ? '<th class="cell">Profesional</th>' : ''}
        <th class="cell">Copago</th>
        <th class="cell right">Acciones</th>
      </tr>
    </thead>`;

  const puedeAbrir = roleAllows('abrir_ficha', userRole);

  const rows = (list || []).map(t => {
    const p = t.pacientes || {};

    const hora = `<b>${toHM(t.hora_inicio)}</b>${t.hora_fin ? ' — ' + toHM(t.hora_fin) : ''}`;

    const cop = (t.copago && Number(t.copago) > 0) ? money(t.copago) : '—';

    const hcBtn = p.historia_clinica
      ? `<a class="icon" href="${p.historia_clinica}" target="_blank" rel="noopener" title="Historia clínica">🔗</a>`
      : '';

    const acciones = `
      ${puedeAbrir ? `<button class="icon" data-id="${t.id}" data-act="abrir-ficha" title="Abrir ficha">📄</button>` : ''}
      ${hcBtn}
    `;

    return `
      <tr class="row" style="grid-template-columns:${grid}">
        <td class="cell nowrap">${hora}</td>
        <td class="cell">${p.dni || '—'}</td>
        <td class="cell truncate">${titleCase(p.nombre) || '—'}</td>
        <td class="cell truncate">${titleCase(p.apellido) || '—'}</td>
        <td class="cell truncate">${p.obra_social || '—'}</td>
        ${withProf ? `<td class="cell truncate">${profNameById(t.profesional_id)}</td>` : ''}
        <td class="cell">${cop}</td>
        <td class="cell right">
          <div class="actions">${acciones}</div>
        </td>
      </tr>`;
  }).join('');

  UI.tblDone.innerHTML = head + '<tbody>' + rows + '</tbody>';

  UI.tblDone.querySelectorAll('.icon').forEach(btn => {
    const id = btn.getAttribute('data-id');
    const act = btn.getAttribute('data-act');
    if (act === 'abrir-ficha') {
      btn.onclick = () => openFicha(id);
    }
  });
}

/* =======================
   KPIs / títulos
   ======================= */
function computeHorasDisponibles(agenda, turnos){
  const totalAgendaMin=(agenda||[]).reduce((acc,b)=>acc+minutesDiff(toHM(b.hora_inicio), toHM(b.hora_fin)),0);
  const ocupadosMin=(turnos||[]).filter(t=>t.estado!==EST.CANCELADO)
    .reduce((acc,t)=>acc+(t.hora_fin?minutesDiff(toHM(t.hora_inicio), toHM(t.hora_fin)):0),0);
  const libresMin=Math.max(0,totalAgendaMin-ocupadosMin);
  return { libresMin, totalAgendaMin };
}
const formatFreeTime = mins => {
  mins = Math.max(0, Math.round(Number(mins||0)));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60); const m = mins % 60;
  return `${h} h ${m} min`;
};
function profsLabel(){
  const sel = document.querySelector('#prof-select'); if (!sel) return '—';
  if (!sel.multiple) return sel.options[sel.selectedIndex]?.textContent || '—';
  const names = Array.from(sel.selectedOptions).map(o=>o.textContent).filter(Boolean);
  if (names.length === 0) return '—';
  if (names.length === 1) return names[0];
  if (names.length <= 3) return names.join(', ');
  return `${names.length} profesionales`;
}
function renderKPIs({agenda, turnos}){
  const free=computeHorasDisponibles(agenda, turnos);
  if (UI.kpiFree) UI.kpiFree.textContent = `${formatFreeTime(free.libresMin)} disponibles`;
  safeSet(UI.kpiSub, `${currentCentroNombre || ''} · ${profsLabel()} · ${currentFechaISO}`);
}
function renderBoardTitles({pendientes, presentes, atencion, atendidos}){
  if (H.pend)  H.pend.textContent  = `Por llegar (${(pendientes||[]).length})`;
  if (H.esp)   H.esp.textContent   = `En sala de espera (${(presentes||[]).length})`;
  if (H.atenc) H.atenc.textContent = `En atención (${(atencion||[]).length})`;
  if (H.done)  H.done.textContent  = `Atendidos (${(atendidos||[]).length})`;
}

/* =======================
   Drawer (abrir/guardar/finalizar)
   ======================= */
function showDrawer(){ Drawer.el?.classList.add('open'); Drawer.el?.setAttribute('aria-hidden','false'); }
function hideDrawer(){ Drawer.el?.classList.remove('open'); Drawer.el?.setAttribute('aria-hidden','true'); }
const setDrawerMsg    = (msg,tone='') => { if (Drawer.msg){ Drawer.msg.textContent=msg||''; Drawer.msg.className='msg '+(tone||''); } };
const setDrawerStatus = (msg,tone='') => { if (Drawer.status){ Drawer.status.textContent=msg||''; Drawer.status.className='msg '+(tone||''); } };

let drawerTurnoId = null;

async function loadObrasSociales(currentLabel){
  if (!Drawer.obra) return;

  if (!loadObrasSociales._cache) {
    const { data } = await supabase
      .from('obras_sociales')
      .select('obra_social')
      .order('obra_social',{ascending:true});
    loadObrasSociales._cache = (data||[]).map(r=>r.obra_social);
  }

  const labels = loadObrasSociales._cache;

  Drawer.obra.innerHTML = '<option value="">(Sin obra social)</option>';
  labels.forEach(lbl => {
    const opt=document.createElement('option');
    opt.value=lbl; opt.textContent=lbl;
    Drawer.obra.appendChild(opt);
  });

  if (currentLabel && !labels.includes(currentLabel)) {
    const opt=document.createElement('option');
    opt.value=currentLabel; opt.textContent=currentLabel;
    Drawer.obra.appendChild(opt);
  }
  Drawer.obra.value = currentLabel || '';
}

function renderHeaderPaciente(p){
  const ape = titleCase(p?.apellido||''); const nom = titleCase(p?.nombre||''); const dni = (p?.dni || '—');
  const edad = (()=>{ if(!p?.fecha_nacimiento) return null; const d=new Date(p.fecha_nacimiento); if(isNaN(d)) return null;
    const t=new Date(); let a=t.getFullYear()-d.getFullYear(); const m=t.getMonth()-d.getMonth(); if(m<0||(m===0&&t.getDate()<d.getDate())) a--; return Math.max(a,0); })();
  if (Drawer.title) Drawer.title.textContent = `Ficha paciente: ${[nom, ape].filter(Boolean).join(' ') || '—'}`;
  if (Drawer.sub)   Drawer.sub.textContent   = `dni ${dni} / ${edad!=null? `${edad} años`:'— años'}`;
  if (Drawer.hc){
    if (p?.historia_clinica){ Drawer.hc.style.display='inline-flex'; Drawer.hc.href = p.historia_clinica; }
    else                    { Drawer.hc.style.display='none';        Drawer.hc.removeAttribute('href'); }
  }
}

async function openFicha(turnoId){
  if (!roleAllows('abrir_ficha', userRole)) { alert('No tenés permisos para abrir la ficha.'); return; }
  drawerTurnoId = turnoId;
  try { localStorage.setItem('current_turno_id', String(turnoId)); } catch {}
  setDrawerStatus('Cargando...'); setDrawerMsg(''); showDrawer();

  const { data:t, error:terr } = await supabase
    .from('turnos')
    .select('id, fecha, hora_inicio, hora_fin, estado, hora_arribo, copago, notas, paciente_id, profesional_id, centro_id')
    .eq('id', turnoId)
    .maybeSingle();

  if (terr || !t){ setDrawerStatus('No se pudo cargar el turno','warn'); console.error(terr); return; }

  const { data:p } = await supabase
    .from('pacientes')
    .select('id,dni,apellido,nombre,fecha_nacimiento,telefono,email,obra_social,numero_afiliado,credencial,contacto_nombre,contacto_apellido,contacto_celular,vinculo,historia_clinica,proximo_control,renovacion_receta,activo')
    .eq('id', t.paciente_id).maybeSingle();

  if (Drawer.hora)   Drawer.hora.textContent   = `Hora turno: ${t.hora_inicio ? toHM(t.hora_inicio) : '—'}`;
  if (Drawer.copago) Drawer.copago.textContent = `Copago: ${t.copago!=null ? money(t.copago) : '—'}`;

  renderHeaderPaciente(p||{});

  if (Drawer.dni) Drawer.dni.value = p?.dni || '';
  if (Drawer.ape) Drawer.ape.value = p?.apellido || '';
  if (Drawer.nom) Drawer.nom.value = p?.nombre || '';
  if (Drawer.nac) Drawer.nac.value = p?.fecha_nacimiento || '';
  if (Drawer.tel) Drawer.tel.value = p?.telefono || '';
  if (Drawer.mail)Drawer.mail.value= p?.email || '';
  await loadObrasSociales(p?.obra_social || '');
  if (Drawer.afiliado) Drawer.afiliado.value = p?.numero_afiliado || '';
  if (Drawer.cred){ Drawer.cred.value = p?.credencial || ''; if (Drawer.credLink) Drawer.credLink.href = p?.credencial || '#'; }
  if (Drawer.ecNom) Drawer.ecNom.value = p?.contacto_nombre || '';
  if (Drawer.ecApe) Drawer.ecApe.value = p?.contacto_apellido || '';
  if (Drawer.ecCel) Drawer.ecCel.value = p?.contacto_celular || '';
  if (Drawer.ecVin) Drawer.ecVin.value = p?.vinculo || '';
  if (Drawer.prox)  Drawer.prox.value = p?.proximo_control || '';
  if (Drawer.renov) Drawer.renov.value = p?.renovacion_receta || '';
  if (Drawer.activo)Drawer.activo.checked = !!p?.activo;
  if (Drawer.notas) Drawer.notas.value = t?.notas || '';

  setDrawerStatus('');

  if (Drawer.btnGuardar)  Drawer.btnGuardar.onclick = guardarFicha;
  if (Drawer.btnFinalizar){
    Drawer.btnFinalizar.style.display = roleAllows('finalizar', userRole) ? '' : 'none';
    Drawer.btnFinalizar.onclick = () => finalizarAtencion(drawerTurnoId, { closeDrawer: true });
  }
  if (Drawer.cred) Drawer.cred.oninput = ()=>{ if (Drawer.credLink) Drawer.credLink.href = Drawer.cred.value || '#'; };
}
async function guardarFicha(){
  if (!drawerTurnoId) return;
  if (!roleAllows('abrir_ficha', userRole)) { alert('No tenés permisos para guardar.'); return; }
  const { data: t } = await supabase.from('turnos').select('paciente_id').eq('id', drawerTurnoId).maybeSingle();
  const pacienteId = t?.paciente_id; if (!pacienteId){ setDrawerMsg('No se encontró paciente del turno','warn'); return; }

  setDrawerMsg('Guardando...');
  const payloadP = {
    dni: Drawer.dni?.value.trim() || null,
    apellido: Drawer.ape?.value.trim() || null,
    nombre: Drawer.nom?.value.trim() || null,
    fecha_nacimiento: Drawer.nac?.value || null,
    telefono: Drawer.tel?.value.trim() || null,
    email: Drawer.mail?.value.trim() || null,
    obra_social: Drawer.obra?.value || null,
    numero_afiliado: Drawer.afiliado?.value.trim() || null,
    credencial: Drawer.cred?.value.trim() || null,
    contacto_nombre: Drawer.ecNom?.value.trim() || null,
    contacto_apellido: Drawer.ecApe?.value.trim() || null,
    contacto_celular: Drawer.ecCel?.value.trim() || null,
    vinculo: Drawer.ecVin?.value.trim() || null,
    historia_clinica: Drawer.hc?.href || null,
    proximo_control: Drawer.prox?.value || null,
    renovacion_receta: Drawer.renov?.value || null,
    activo: !!Drawer.activo?.checked,
  };
  const payloadTurno = { notas: Drawer.notas?.value || null };

  const [r1, r2] = await Promise.all([
    supabase.from('pacientes').update(payloadP).eq('id', pacienteId),
    supabase.from('turnos').update(payloadTurno).eq('id', drawerTurnoId),
  ]);

  if (r1.error){ setDrawerMsg('Error guardando paciente: '+r1.error.message,'warn'); return; }
  if (r2.error){ setDrawerMsg('Error guardando notas: '+r2.error.message,'warn'); return; }

  renderHeaderPaciente({
    dni: payloadP.dni, apellido: payloadP.apellido, nombre: payloadP.nombre,
    fecha_nacimiento: payloadP.fecha_nacimiento, historia_clinica: payloadP.historia_clinica
  });
  setDrawerMsg('Cambios guardados.','ok'); setTimeout(()=> setDrawerMsg(''), 1200);
}

/* =======================
   Acciones de estado
   ======================= */
async function volverASalaEspera(turnoId){
  if (!roleAllows('atender', userRole)) { alert('No tenés permisos.'); return; }
  await supabase.from('turnos').update({estado:EST.EN_ESPERA}).eq('id', turnoId);
  await refreshAll();
}
async function finalizarAtencion(turnoId, { closeDrawer = false } = {}) {
  if (!roleAllows('finalizar', userRole)) { alert('No tenés permisos.'); return; }
  const id = turnoId ?? drawerTurnoId; if (!id) return;
  if (!confirm('¿Marcar este turno como ATENDIDO?')) return;

  const { error } = await supabase.from('turnos').update({ estado: EST.ATENDIDO }).eq('id', id).eq('estado', EST.EN_ATENCION);
  if (error) { alert(error.message || 'No se pudo finalizar.'); return; }
  if (closeDrawer) hideDrawer();
  await refreshAll();
}
async function marcarLlegadaYCopago(turnoId){
  if (!roleAllows('arribo', userRole)) { alert('No tenés permisos.'); return; }
  const { data: t } = await supabase.from('turnos').select('id, pacientes(obra_social)').eq('id', turnoId).single();

  let copago=null, obra=t?.pacientes?.obra_social||null;
  if (obra){
    const { data: os } = await supabase.from('obras_sociales').select('condicion_copago, valor_copago').eq('obra_social', obra).maybeSingle();
    if (os && os.condicion_copago===true && os.valor_copago!=null) copago=os.valor_copago;
  }
  await supabase.from('turnos').update({ estado: EST.EN_ESPERA, hora_arribo: nowHHMMSS(), copago }).eq('id', turnoId);
  await refreshAll();
}
async function pasarAEnAtencion(turnoId, ev){
  if (ev) ev.preventDefault();
  if (!roleAllows('atender', userRole)) { alert('Solo AMP/Médico pueden atender.'); return; }
  const { error } = await supabase.from('turnos').update({ estado: EST.EN_ATENCION }).eq('id', turnoId);
  if (error) { alert('No se pudo pasar a "En atención".'); return; }
  await refreshAll();
  await openFicha(turnoId);
}
async function anularTurno(turnoId){
  if (!roleAllows('cancelar', userRole)) { alert('No tenés permisos para anular.'); return; }
  if (!confirm('¿Anular este turno?')) return;
  const { error } = await supabase.from('turnos').update({ estado: EST.CANCELADO }).eq('id', turnoId);
  if (error) { alert('No se pudo anular.'); return; }
  await refreshAll();
}

/* =======================
   Refresh principal (con abort + overlay suave)
   ======================= */
async function refreshAll({ showOverlayIfSlow = false } = {}){
  if(!selectedProfesionales.length){
    UI.tblPend.innerHTML=''; UI.tblEsp.innerHTML=''; UI.tblAtencion.innerHTML=''; UI.tblDone.innerHTML='';
    safeSet(UI.kpiSub, `${currentCentroNombre||''} · ${currentFechaISO||todayISO()}`);
    renderBoardTitles({pendientes:[],presentes:[],atencion:[],atendidos:[]});
    return;
  }

  _refresh.abort?.abort();
  const abort = new AbortController();
  _refresh.abort = abort;
  const myReqId = ++_refresh.reqId;

  let overlayTimer;
  if (showOverlayIfSlow) overlayTimer = setTimeout(()=> setLoading(document, true), 220);

  try{
    const raw = await fetchDiaData(abort.signal);
    if (myReqId !== _refresh.reqId) return;

    const filtered = applyFilter(raw);
    renderPendientes(filtered.pendientes);
    renderPresentes(filtered.presentes);
    renderAtencion(filtered.atencion);
    renderAtendidos(filtered.atendidos);
    renderKPIs(raw);
    renderBoardTitles(filtered);
  } finally {
    if (overlayTimer) clearTimeout(overlayTimer);
    setLoading(document, false);
    if (myReqId === _refresh.reqId) _refresh.abort = null;
  }
}

/* =======================
   INIT (export)
   ======================= */
export async function initInicio(root){
  bindUI(root);
  ensureOverlay(root);

  // estado base (centro/fecha)
  currentCentroId     = localStorage.getItem('centro_medico_id');
  currentCentroNombre = localStorage.getItem('centro_medico_nombre') || await fetchCentroById(currentCentroId);
  renderCentroChip();

  // tipografía
  loadFs();
  if (zDec)   zDec.onclick   = ()=> setFs(fsPx - FONT.step);
  if (zInc)   zInc.onclick   = ()=> setFs(fsPx + FONT.step);
  if (zReset) zReset.onclick = ()=> setFs(FONT.def);

  // fecha + hoy
  if (UI.fecha && !UI.fecha.value) UI.fecha.value = todayISO();
  currentFechaISO = UI.fecha?.value || todayISO();
  if (UI.fecha) UI.fecha.onchange = ()=>{ currentFechaISO = UI.fecha.value || todayISO(); refreshAll({ showOverlayIfSlow:false }); };
  if (UI.btnHoy) UI.btnHoy.onclick = ()=>{ const h=todayISO(); UI.fecha.value=h; currentFechaISO=h; refreshAll({ showOverlayIfSlow:false }); };

  // buscador
  if (UI.massSearch){
    UI.massSearch.oninput = ()=>{
      clearTimeout(searchTimer);
      searchTimer = setTimeout(()=> applySearch(UI.massSearch.value), 320);
    };
  }
  if (UI.massClear){
    UI.massClear.onclick = ()=>{ UI.massSearch.value=''; applySearch(''); };
  }

  // aplicar clases por rol
  applyRoleClasses(userRole);

  // layout boards
  setupBoardControls();

  // profesionales
  await loadProfesionales();
  if (!restoreProfSelection()) saveProfSelection();

  // primera carga con overlay visible
  setLoading(root, true);
  await refreshAll({ showOverlayIfSlow:false });
  setLoading(root, false);

  // watcher de centro (si cambia en otro tab/side, re-carga todo)
  startCentroWatcher();
}
