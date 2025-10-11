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
const titleCase = s => (s||'').split(' ').filter(Boolean).map(w=> w[0]?.toUpperCase()+w.slice(1).toLowerCase()).join(' ');
const minutesDiff = (start, end) => {
  const [h1,m1]=start.split(':').map(Number);
  const [h2,m2]=end.split(':').map(Number);
  return (h2*60+m2)-(h1*60+m1);
};
const nowHHMMSS = () => { const d=new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };

/* =======================
   Helpers de dinero / hora (globales)
   ======================= */
function toPesoInt(v){
  if (v === null || v === undefined) return null;
  // admite "1.234", "1,234.50", "$ 1.234", etc.
  const s = String(v).replace(/[^\d,-.]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (!isFinite(n)) return null;
  return Math.round(n);
}

function money(n){
  const val = toPesoInt(n);
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(val ?? 0);
}

function horaRango(t){
  const hi = toHM(t?.hora_inicio);
  const hf = toHM(t?.hora_fin);
  if (hi && hf) return `${hi} — ${hf}`;
  if (hi)       return hi;
  if (hf)       return hf;
  return '—';
}

/** Badge “Espera” (solo para EN_ESPERA) */
function esperaBadge(t, fechaISO){
  if (!t?.hora_arribo) return '—';
  // Armamos un timestamp ISO para que updateWaitBadges pueda calcular el tiempo
  const hhmm = toHM(t.hora_arribo) || '00:00';
  const iso  = `${fechaISO}T${hhmm}:00`;
  return `<span class="wait" data-arribo-ts="${iso}">—</span>`;
}


/* =======================
   Estado de módulo
   ======================= */
let UI = {};
let H  = {};
let Drawer = {};
let boardsEl, zDec, zInc, zReset;
let overlayRoot = null;

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
let _centroStorageHandler = null;


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
    importe:   root.querySelector('#fd-importe'),
    medio:     root.querySelector('#fd-medio'),
    estadoPago:root.querySelector('#fd-estado-pago'),
    dni:       root.querySelector('#fd-dni'),
    ape:       root.querySelector('#fd-apellido'),
    nom:       root.querySelector('#fd-nombre'),
    nac:       root.querySelector('#fd-nac'),
    tel:       root.querySelector('#fd-tel'),
    mail:      root.querySelector('#fd-mail'),
    obra:      root.querySelector('#fd-obra'),
    afiliado:  root.querySelector('#fd-afiliado'),
    cred:      root.querySelector('#fd-cred'),
    hcLink:    root.querySelector('#fd-hc-link'),
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

  // === Panel izquierdo (detalle de turno) ===
  UI.tp = {
    el:      root.querySelector('#turnoPanel'),
    close:   root.querySelector('#tp-close'),
    title:   root.querySelector('#tp-title'),
    sub:     root.querySelector('#tp-sub'),
    status:  root.querySelector('#tp-status'),
    hora:    root.querySelector('#tp-hora'),
    estado:  root.querySelector('#tp-estado'),
    copago:  root.querySelector('#tp-copago'),
    dni:     root.querySelector('#tp-dni'),
    ape:     root.querySelector('#tp-ape'),
    nom:     root.querySelector('#tp-nom'),
    com:     root.querySelector('#tp-com-recep'),
    btnArr:  root.querySelector('#tp-arribo'),
    btnAt:   root.querySelector('#tp-atender'),
    btnPago: root.querySelector('#tp-pago'),
    btnCan:  root.querySelector('#tp-cancel'),
    btnFicha:root.querySelector('#tp-ficha'),
    btnSave: root.querySelector('#tp-guardar'),
  };
  if (UI.tp?.close) UI.tp.close.onclick = inicioHideTurnoPanel;
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
   Delegación: click en filas (abre panel)
   ======================= */
document.addEventListener('click', (e) => {
  // Ignorar clicks en botones de acción dentro de la fila
  if (e.target.closest?.('.icon')) return;
  if (e.target.closest('thead')) return; 

  const row = e.target.closest?.('tr.row');
  if (!row) return;

  const id = row.getAttribute('data-turno-id');
  if (!id) return;

if (!UI?.tp?.el) return; 
   
   
  inicioOpenTurnoPanel(id);
});


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
  id, fecha, hora_inicio, hora_fin, estado, hora_arribo, copago, importe, medio_pago,
  paciente_id, profesional_id, comentario_recepcion,
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

// Calcula el ancho óptimo (en ch) por columna según el contenido del DÍA
function computeColumnWidthsForDay({ turnos }) {
  // Defaults estables para columnas cortas
  const root = document.documentElement.style;
  root.setProperty('--col-espera', '8ch');     // badge
  root.setProperty('--col-hora',   '16ch');    // "HH:MM — HH:MM"

  const rows = turnos || [];
  const len = s => String(s ?? '').trim().length;

  let maxDNI = 8, maxNom = 12, maxApe = 12, maxObra = 10, maxCop = 10;

  for (const t of rows) {
    const p = t.pacientes || {};
    maxDNI  = Math.max(maxDNI,  len(p.dni));
    maxNom  = Math.max(maxNom,  len(titleCase(p.nombre)));
    maxApe  = Math.max(maxApe,  len(titleCase(p.apellido)));
    maxObra = Math.max(maxObra, len(p.obra_social));
    const copTxt = (t.copago && Number(t.copago) > 0) ? money(t.copago) : 'Sin copago';
    maxCop  = Math.max(maxCop,  len(copTxt));
  }

  // un pelín de aire (+2ch) y topes sanos
  const clamp = (v, min, max) => Math.max(min, Math.min(v, max));
  const pad   = v => v + 2;

  maxDNI  = clamp(pad(maxDNI),  8,  16);
  maxNom  = clamp(pad(maxNom), 12,  32);
  maxApe  = clamp(pad(maxApe), 12,  32);
  maxObra = clamp(pad(maxObra), 10,  24);
  maxCop  = clamp(pad(maxCop),  10,  18);

  root.setProperty('--col-dni',      `${maxDNI}ch`);
  root.setProperty('--col-nombre',   `${maxNom}ch`);
  root.setProperty('--col-apellido', `${maxApe}ch`);
  root.setProperty('--col-obra',     `${maxObra}ch`);
  root.setProperty('--col-copago',   `${maxCop}ch`);
}



/* =======================
   Esquema GLOBAL de columnas unificadas (sin Profesional)
   ======================= */
// NOTA: los widths usan variables CSS que vamos a calcular en runtime para
// que todas las tablas compartan el mismo ancho por columna (según el contenido del día).
// Rejilla única basada 100% en variables CSS (mismo ancho en header y filas)
const COLS = [
  { key: "acciones", label: "Acciones",    width: "var(--w-acc)" },
  { key: "hora",     label: "Hora",        width: "var(--col-hora)" },
  { key: "dni",      label: "DNI",         width: "var(--col-dni)" },
  { key: "nombre",   label: "Nombre",      width: "minmax(var(--col-nombre),1fr)" },
  { key: "apellido", label: "Apellido",    width: "minmax(var(--col-apellido),1fr)" },
  { key: "obra",     label: "Obra social", width: "minmax(var(--col-obra),1fr)" },
  { key: "copago",   label: "Copago (Tt / p)", width: "var(--col-copago)" }, // <- Cambiado el encabezado
  { key: "espera",   label: "Espera",      width: "var(--col-espera)" },
];

let GRID_TEMPLATE = COLS.map(c => c.width).join(' ');

function buildCell(key, t, ctx) {
  const p = t.pacientes || {};
  const pagado = ctx.pagos?.[t.id] ?? 0;
  const copago = toPesoInt(t.copago) ?? 0;
  const pendiente = Math.max(0, copago - pagado);

  // flags por estado (para decidir visibilidad de acciones)
  const st = t.estado;
  const isAsignado = st === EST.ASIGNADO;
  const isEspera   = st === EST.EN_ESPERA;
  const isAtencion = st === EST.EN_ATENCION;

  switch (key) {
    case 'copago': {
      if (copago === 0) return `<span class="copago none">Sin copago</span>`;
      const totalStr  = money(copago);
      const pagadoStr = money(pagado);
      if (pendiente === 0) {
        return `<span class="copago ok">${totalStr} / ${pagadoStr} <span title="Abonado" style="color:#2e7d32;font-weight:bold;">✅ Abonado</span></span>`;
      }
      return `<span class="copago">${totalStr} / ${pagadoStr} <span style="color:#f57c00;">(${money(pendiente)} pendiente)</span></span>`;
    }

    case 'acciones': {
      let html = `<div class="actions">`;

      // 🔴 Sacamos "Anular" de las filas (solo en el slide)
      // if (ctx.puedeCancelar) html += `<button ...>🗑️</button>`;

      // 💵 Pagar: solo si hay saldo
      if (copago > 0 && pendiente > 0 && ctx.puedePagar) {
        html += `<button class="icon" data-id="${t.id}" data-act="pago" title="Registrar pago">$</button>`;
      }

      // 🟢 Arribo: solo si está ASIGNADO y es hoy
      if (ctx.puedeArribo && ctx.isHoy && isAsignado) {
        html += `<button class="icon" data-id="${t.id}" data-act="arribo" title="Pasar a En espera">🟢</button>`;
      }

      // ▶️ Atender: solo si está EN_ESPERA
      if (ctx.puedeAtender && isEspera) {
        html += `<button class="icon" data-id="${t.id}" data-act="atender" title="En atención">▶️</button>`;
      }

      // ✅ Finalizar: solo si está EN_ATENCION
      if (ctx.puedeFinalizar && isAtencion) {
        html += `<button class="icon" data-id="${t.id}" data-act="finalizar" title="Marcar ATENDIDO">✅</button>`;
      }

      // 📄 Abrir ficha: según permiso
      if (ctx.puedeAbrirFicha) {
        html += `<button class="icon" data-id="${t.id}" data-act="abrir-ficha" title="Abrir ficha">📄</button>`;
      }

      // ↩︎ Volver (solo donde aplica, guiado por ctx.type)
      if (ctx.type === 'esp' && ctx.puedeVolver) {
        html += `<button class="icon" data-id="${t.id}" data-act="volver" title="Volver a 'Por llegar'">↩︎</button>`;
      }
      if (ctx.type === 'atencion' && ctx.puedeVolverE) {
        html += `<button class="icon" data-id="${t.id}" data-act="volver-espera" title="Volver a sala de espera">↩︎</button>`;
      }

      html += `</div>`;
      return html;
    }

    default: {
      switch (key) {
        case 'espera':  return (ctx.type === 'esp') ? esperaBadge(t, ctx.fechaISO) : '—';
        case 'hora':    return horaRango(t);
        case 'dni':     return p.dni || '—';
        case 'nombre':  return titleCase(p.nombre) || '—';
        case 'apellido':return titleCase(p.apellido) || '—';
        case 'obra':    return p.obra_social || '—';
        default:        return '—';
      }
    }
  }
}


// head único
function renderHeadHTML(){
  const ths = COLS.map(c => `<th class="cell">${c.label}</th>`).join('');
  return `
    <thead class="thead">
      <tr class="hrow" style="grid-template-columns:${GRID_TEMPLATE}">${ths}</tr>
    </thead>`;
}

// Nueva con prefijo
function inicioRenderRowHTML(t, ctx){
  const tds = COLS.map(c => `<td class="cell">${buildCell(c.key, t, ctx)}</td>`).join('');
  return `<tr class="row" data-turno-id="${t.id}" style="grid-template-columns:${GRID_TEMPLATE}">${tds}</tr>`;
}

// Puente (compatibilidad): usa la nueva
function renderRowHTML(t, ctx){
  return inicioRenderRowHTML(t, ctx);
}


// tabla genérica
function renderTable(el, list, ctx){
  const head = renderHeadHTML();
  const rows = (list || []).map(t => renderRowHTML(t, ctx)).join('');
  el.innerHTML = head + '<tbody>' + rows + '</tbody>';
}


/* =======================
   Render de tablas
   ======================= */
const showProfColumn = ()=> {
  const sel = document.querySelector('#prof-select');
  return sel?.multiple || selectedProfesionales.length > 1;
};

/* PENDIENTES */
// Render de pendientes - versión completa: copago detallado, botón pagar solo si corresponde, integración con buildCell global

function renderPendientes(list, mapPagos) {
  const puedeCancelar = roleAllows('cancelar', userRole);
  const puedeArribo   = roleAllows('arribo', userRole);
  const puedeAtender  = roleAllows('atender', userRole);
  const puedeFinalizar= false; // Finalizar nunca en "Por llegar"
  const puedeAbrir    = roleAllows('abrir_ficha', userRole);

  const ctx = {
    type: 'pend',
    fechaISO: currentFechaISO,
    pagos: mapPagos,
    isHoy: (currentFechaISO === todayISO()),
    puedeCancelar,
    puedeArribo,
    puedeAtender, // queda false en práctica
    puedeFinalizar,
    puedeAbrirFicha: puedeAbrir,
    puedePagar: true, // permitir pago desde “Por llegar”
  };

  const head = renderHeadHTML();
  const rows = (list || []).map(t => inicioRenderRowHTML(t, ctx)).join('');
  UI.tblPend.innerHTML = head + '<tbody>' + rows + '</tbody>';

  UI.tblPend.querySelectorAll('.icon').forEach(btn => {
    const id  = btn.getAttribute('data-id');
    const act = btn.getAttribute('data-act');

    if (act === 'pago') {
      btn.onclick = () => {
        // buscamos el turno para calcular pendiente sugerido
        const t = (list || []).find(x => String(x.id) === String(id));
        const copago  = toPesoInt(t?.copago) ?? 0;
        const pagado  = mapPagos?.[t?.id] ?? 0;
        const pendiente = Math.max(0, copago - pagado);

        openPaymentBridge({
          turnoId: id,
          // si no hay pendiente, dejamos que el módulo decida
          amount: pendiente > 0 ? pendiente : null,
          confirmLabel: 'Registrar pago',
          skipLabel: 'Cerrar',
          onPaid: async () => {
            await refreshAll({ showOverlayIfSlow: false });
          }
        });
      };
    }

    if (act === 'arribo')      btn.onclick = () => marcarLlegadaYCopago(id);
    if (act === 'cancel')      btn.onclick = () => anularTurno(id);
    if (act === 'atender')     btn.onclick = (ev) => pasarAEnAtencion(id, ev);
    if (act === 'finalizar')   btn.onclick = () => finalizarAtencion(id);
    if (act === 'abrir-ficha') btn.onclick = () => openFicha(id);
  });
}





async function getPagoResumen(turnoId){
  const { data: pagos = [], error } = await supabase
    .from('turnos_pagos')
    .select('importe, medio_pago, fecha')      // ← usar 'fecha'
    .eq('turno_id', turnoId)
    .order('fecha', { ascending: false });     // ← último pago primero

  if (error) {
    console.warn('[getPagoResumen] error:', error);
    return { totalPagado: 0, ultimoMedio: null };
  }

  const totalPagado = pagos.reduce((a,p)=> a + Number(p.importe || 0), 0);
  const ultimoMedio = pagos[0]?.medio_pago || null;  // por fecha desc

  return { totalPagado, ultimoMedio };
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

/* PRESENTES (EN ESPERA) */
function renderPresentes(list, mapPagos) {
  const puedeVolver   = roleAllows('volver', userRole);
  const puedeCancelar = roleAllows('cancelar', userRole);
  const puedeAtender  = roleAllows('atender', userRole);

  const ctx = {
    type: 'esp',
    fechaISO: currentFechaISO,
    pagos: mapPagos,
    isHoy: (currentFechaISO === todayISO()),
    puedeVolver,
    puedeCancelar,
    puedeAtender,
    puedePagar: true,
  };

  renderTable(UI.tblEsp, list, ctx);

  UI.tblEsp.querySelectorAll('.icon').forEach(btn => {
    const id  = btn.getAttribute('data-id');
    const act = btn.getAttribute('data-act');

    if (act === 'volver') {
      btn.onclick = async () => {
        if (!roleAllows('volver', userRole)) return;
        await supabase.from('turnos')
          .update({ estado: EST.ASIGNADO, hora_arribo: null })
          .eq('id', id);
        await refreshAll();
      };
      return;
    }

    if (act === 'cancel') {
      btn.onclick = () => anularTurno(id);
      return;
    }

    if (act === 'atender') {
      btn.onclick = (ev) => pasarAEnAtencion(id, ev);
      return;
    }

    if (act === 'pago') {
      btn.onclick = () => {
        const t = (list || []).find(x => String(x.id) === String(id));
        const copago    = toPesoInt(t?.copago) ?? 0;
        const pagado    = mapPagos?.[t?.id] ?? 0;
        const pendiente = Math.max(0, copago - pagado);

        openPaymentBridge({
          turnoId: id,
          amount: pendiente > 0 ? pendiente : null,
          confirmLabel: 'Registrar pago',
          skipLabel: 'Cerrar',
          onPaid: async () => {
            await refreshAll({ showOverlayIfSlow: false });
          }
        });
      };
      return;
    }
  });

  updateWaitBadges();
  startWaitTicker();
}


/* EN ATENCIÓN */
function renderAtencion(list, mapPagos) {
  const puedeAbrir   = roleAllows('abrir_ficha', userRole);
  const puedeVolverE = roleAllows('atender', userRole);
  const puedeFin     = roleAllows('finalizar', userRole);

  const ctx = {
    type: 'atencion',
    fechaISO: currentFechaISO,
    pagos: mapPagos,
    puedeAbrirFicha: puedeAbrir,
    puedeVolverE,
    puedeFinalizar: puedeFin,
    puedePagar: true,
  };

  renderTable(UI.tblAtencion, list, ctx);

  UI.tblAtencion.querySelectorAll('.icon').forEach(btn => {
    const id  = btn.getAttribute('data-id');
    const act = btn.getAttribute('data-act');

    if (act === 'abrir-ficha') {
      btn.onclick = () => openFicha(id);
      return;
    }

    if (act === 'volver-espera') {
      btn.onclick = () => volverASalaEspera(id);
      return;
    }

    if (act === 'finalizar') {
      btn.onclick = () => finalizarAtencion(id);
      return;
    }

    if (act === 'pago') {
      btn.onclick = () => {
        const t = (list || []).find(x => String(x.id) === String(id));
        const copago    = toPesoInt(t?.copago) ?? 0;
        const pagado    = mapPagos?.[t?.id] ?? 0;
        const pendiente = Math.max(0, copago - pagado);

        openPaymentBridge({
          turnoId: id,
          amount: pendiente > 0 ? pendiente : null,
          confirmLabel: 'Registrar pago',
          skipLabel: 'Cerrar',
          onPaid: async () => {
            await refreshAll({ showOverlayIfSlow: false });
          }
        });
      };
      return;
    }
  });
}
   
function renderAtendidos(list, mapPagos) {
  const puedeAbrir = roleAllows('abrir_ficha', userRole);

  const ctx = {
    type: 'done',
    fechaISO: currentFechaISO,
    pagos: mapPagos,
    puedeAbrirFicha: puedeAbrir,
    puedePagar: false, // dejalo en false si no querés pagos acá
  };

  renderTable(UI.tblDone, list, ctx);

  UI.tblDone.querySelectorAll('.icon').forEach(btn => {
    const id  = btn.getAttribute('data-id');
    const act = btn.getAttribute('data-act');

    if (act === 'abrir-ficha') {
      btn.onclick = () => openFicha(id);
      return;
    }

    // Si decidís habilitar pagos en "Atendidos", el handler ya queda listo:
    if (act === 'pago') {
      btn.onclick = () => {
        const t = (list || []).find(x => String(x.id) === String(id));
        const copago    = toPesoInt(t?.copago) ?? 0;
        const pagado    = mapPagos?.[t?.id] ?? 0;
        const pendiente = Math.max(0, copago - pagado);

        openPaymentBridge({
          turnoId: id,
          amount: pendiente > 0 ? pendiente : null,
          confirmLabel: 'Registrar pago',
          skipLabel: 'Cerrar',
          onPaid: async () => {
            await refreshAll({ showOverlayIfSlow: false });
          }
        });
      };
      return;
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
  // 0) Permisos básicos
  if (!roleAllows('abrir_ficha', userRole)) {
    alert('No tenés permisos para abrir la ficha.');
    return;
  }

  // 1) Preparación UI
  drawerTurnoId = turnoId;
  try { localStorage.setItem('current_turno_id', String(turnoId)); } catch {}
  setDrawerStatus('Cargando…');
  setDrawerMsg('');
  showDrawer();

  // 2) Leer turno (incluye estado_pago y notas para chip y form)
  const { data: t, error: terr } = await supabase
    .from('turnos')
    .select(`
      id, fecha, hora_inicio, hora_fin, estado, hora_arribo,
      copago, importe, medio_pago, estado_pago, notas,
      paciente_id, profesional_id, centro_id
    `)
    .eq('id', turnoId)
    .maybeSingle();

  if (terr || !t){
    setDrawerStatus('No se pudo cargar el turno', 'warn');
    console.error('[openFicha] turnos error:', terr);
    return;
  }

  // 3) Leer paciente
  const { data: p, error: perr } = await supabase
    .from('pacientes')
    .select(`
      id, dni, apellido, nombre, fecha_nacimiento, telefono, email,
      obra_social, numero_afiliado, credencial,
      contacto_nombre, contacto_apellido, contacto_celular, vinculo,
      historia_clinica, proximo_control, renovacion_receta, activo
    `)
    .eq('id', t.paciente_id)
    .maybeSingle();

  if (perr) console.warn('[openFicha] pacientes warn:', perr);

  // 4) Encabezado/chips rápidos
  if (Drawer.hora)      Drawer.hora.textContent      = `Hora turno: ${t.hora_inicio ? toHM(t.hora_inicio) : '—'}`;
  const copVal = toPesoInt(t.copago);
  const copTxt = (copVal && copVal > 0) ? money(copVal) : 'Sin copago';
  if (Drawer.copago)    Drawer.copago.textContent    = `Copago: ${copTxt}`;
  if (Drawer.importe)   Drawer.importe.textContent   = `Importe pagado: ${t.importe != null ? money(t.importe) : '—'}`;
  if (Drawer.medio)     Drawer.medio.textContent     = `Medio: ${t.medio_pago || '—'}`;
  if (Drawer.estadoPago)Drawer.estadoPago.textContent= `Estado pago: ${t.estado_pago ? String(t.estado_pago).toUpperCase() : '—'}`;

  // Título/sub
  renderHeaderPaciente(p || {});

  // 4.b) “Turnos OS en el año”
  try {
    const hoy   = new Date();
    const y     = hoy.getFullYear();
    const desde = `${y}-01-01`;
    const hasta = `${y}-12-31`;

    const { count, error: countErr } = await supabase
      .from('turnos')
      .select('id', { count: 'exact', head: true })
      .eq('paciente_id', t.paciente_id)
      .gte('fecha', desde)
      .lte('fecha', hasta);

    if (!countErr && Drawer.osYear) {
      const labelOS = p?.obra_social ? p.obra_social : 'Sin OS';
      Drawer.osYear.textContent = `Turnos OS en el año: ${count || 0} (${labelOS})`;
    }
  } catch (e) {
    console.warn('[openFicha] conteo OS año warn:', e);
    if (Drawer.osYear) Drawer.osYear.textContent = 'Turnos OS en el año: —';
  }

  // 5) Campos editables del PACIENTE
  if (Drawer.dni)   Drawer.dni.value   = p?.dni || '';
  if (Drawer.ape)   Drawer.ape.value   = p?.apellido || '';
  if (Drawer.nom)   Drawer.nom.value   = p?.nombre || '';
  if (Drawer.nac)   Drawer.nac.value   = p?.fecha_nacimiento || '';
  if (Drawer.tel)   Drawer.tel.value   = p?.telefono || '';
  if (Drawer.mail)  Drawer.mail.value  = p?.email || '';
  await loadObrasSociales(p?.obra_social || '');
  if (Drawer.afiliado) Drawer.afiliado.value = p?.numero_afiliado || '';

  if (Drawer.cred){
    Drawer.cred.value = p?.credencial || '';
    if (Drawer.credLink) Drawer.credLink.href = p?.credencial || '#';
    // mantener sincronizado el botón "Ver" de credencial
    Drawer.cred.oninput = () => {
      if (Drawer.credLink) Drawer.credLink.href = Drawer.cred.value || '#';
    };
  }

  if (Drawer.ecNom)  Drawer.ecNom.value  = p?.contacto_nombre || '';
  if (Drawer.ecApe)  Drawer.ecApe.value  = p?.contacto_apellido || '';
  if (Drawer.ecCel)  Drawer.ecCel.value  = p?.contacto_celular || '';
  if (Drawer.ecVin)  Drawer.ecVin.value  = p?.vinculo || '';
  if (Drawer.prox)   Drawer.prox.value   = p?.proximo_control || '';
  if (Drawer.renov)  Drawer.renov.value  = p?.renovacion_receta || '';
  if (Drawer.activo) Drawer.activo.checked = !!p?.activo;

  // 6) Historia clínica: input (#fd-hc-link) SIEMPRE visible y botón de header (#fd-hc)
  if (Drawer.hcLink) Drawer.hcLink.value = p?.historia_clinica || '';
  if (Drawer.hc) {
    const url = Drawer.hcLink?.value?.trim();
    if (url) {
      Drawer.hc.style.display = 'inline-flex';
      Drawer.hc.href = url;
    } else {
      Drawer.hc.style.display = 'none';
      Drawer.hc.removeAttribute('href');
    }
  }
  if (Drawer.hcLink && Drawer.hc) {
    Drawer.hcLink.oninput = () => {
      const v = Drawer.hcLink.value.trim();
      if (v) {
        Drawer.hc.style.display = 'inline-flex';
        Drawer.hc.href = v;
      } else {
        Drawer.hc.style.display = 'none';
        Drawer.hc.removeAttribute('href');
      }
    };
  }

  // 7) Notas del turno
  if (Drawer.notas) Drawer.notas.value = t?.notas || '';

  // 8) Acciones del drawer
  if (Drawer.btnGuardar)  Drawer.btnGuardar.onclick = guardarFicha;
  if (Drawer.btnFinalizar){
    Drawer.btnFinalizar.style.display = roleAllows('finalizar', userRole) ? '' : 'none';
    Drawer.btnFinalizar.onclick = () => finalizarAtencion(drawerTurnoId, { closeDrawer: true });
  }

  // 9) Listo
  setDrawerStatus('');
}


async function guardarFicha(){
  if (!drawerTurnoId) return;
  if (!roleAllows('abrir_ficha', userRole)) { alert('No tenés permisos para guardar.'); return; }

  // traer el paciente_id del turno
  const { data: t } = await supabase
    .from('turnos')
    .select('paciente_id')
    .eq('id', drawerTurnoId)
    .maybeSingle();

  const pacienteId = t?.paciente_id;
  if (!pacienteId){
    setDrawerMsg('No se encontró paciente del turno','warn');
    return;
  }

  setDrawerMsg('Guardando...');

  // leer valores del form
  const historiaClinicaURL = (Drawer.hcLink?.value || '').trim();

  const payloadP = {
    dni: (Drawer.dni?.value || '').trim() || null,
    apellido: (Drawer.ape?.value || '').trim() || null,
    nombre: (Drawer.nom?.value || '').trim() || null,
    fecha_nacimiento: Drawer.nac?.value || null,
    telefono: (Drawer.tel?.value || '').trim() || null,
    email: (Drawer.mail?.value || '').trim() || null,
    obra_social: Drawer.obra?.value || null,
    numero_afiliado: (Drawer.afiliado?.value || '').trim() || null,
    credencial: (Drawer.cred?.value || '').trim() || null,

    // 👇 persistimos el link de historia clínica
    historia_clinica: historiaClinicaURL || null,

    contacto_nombre: (Drawer.ecNom?.value || '').trim() || null,
    contacto_apellido: (Drawer.ecApe?.value || '').trim() || null,
    contacto_celular: (Drawer.ecCel?.value || '').trim() || null,
    vinculo: (Drawer.ecVin?.value || '').trim() || null,
    proximo_control: Drawer.prox?.value || null,
    renovacion_receta: Drawer.renov?.value || null,
    activo: !!Drawer.activo?.checked,
  };

  const payloadTurno = {
    notas: (Drawer.notas?.value || '').trim() || null,
  };

  // guardar
  const [r1, r2] = await Promise.all([
    supabase.from('pacientes').update(payloadP).eq('id', pacienteId),
    supabase.from('turnos').update(payloadTurno).eq('id', drawerTurnoId),
  ]);

  if (r1.error){ setDrawerMsg('Error guardando paciente: '+r1.error.message,'warn'); return; }
  if (r2.error){ setDrawerMsg('Error guardando notas: '+r2.error.message,'warn'); return; }

  // actualizar encabezado/links en UI post-guardado
  renderHeaderPaciente({
    dni: payloadP.dni,
    apellido: payloadP.apellido,
    nombre: payloadP.nombre,
    fecha_nacimiento: payloadP.fecha_nacimiento,
    historia_clinica: payloadP.historia_clinica
  });

  // sincronizar botón del header "Ver historia clínica"
  if (Drawer.hc){
    if (payloadP.historia_clinica){
      Drawer.hc.style.display = 'inline-flex';
      Drawer.hc.href = payloadP.historia_clinica;
    } else {
      Drawer.hc.style.display = 'none';
      Drawer.hc.removeAttribute('href');
    }
  }

  setDrawerMsg('Cambios guardados.','ok');
  setTimeout(()=> setDrawerMsg(''), 1200);
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

  // 1) Leer copago del turno
  const { data: t, error: terr } = await supabase
    .from('turnos')
    .select('id, copago')
    .eq('id', turnoId)
    .maybeSingle();

  if (terr || !t) { alert('No se pudo leer el turno.'); return; }

  const cop = toPesoInt(t.copago) ?? 0;

  // 2) Total pagado hasta ahora
  const { totalPagado } = await getPagoResumen(turnoId);
  const pendiente = Math.max(0, cop - (totalPagado || 0));

  // 3) Si no hay nada que cobrar → registrar arribo directo
  if (pendiente <= 0){
    const { error } = await supabase
      .from('turnos')
      .update({ estado: EST.EN_ESPERA, hora_arribo: nowHHMMSS() })
      .eq('id', turnoId);
    if (error) { alert('No se pudo registrar la llegada.'); return; }
    await refreshAll({ showOverlayIfSlow:false });
    return;
  }

  // 4) Hay saldo pendiente → abrir el NUEVO modal de pagos (payment modal)
  openPaymentBridge({
    turnoId: turnoId,
    amount: pendiente,                          // valor sugerido = saldo
    confirmLabel: 'Cobrar y pasar a En espera',
    skipLabel: 'Continuar sin cobrar',
    // luego de cobrar, pasar a EN_ESPERA y setear hora_arribo
    onPaid: async () => {
      const { error } = await supabase
        .from('turnos')
        .update({ estado: EST.EN_ESPERA, hora_arribo: nowHHMMSS() })
        .eq('id', turnoId);
      if (error) { alert('Se cobró, pero no se pudo marcar EN ESPERA.'); }
      await refreshAll({ showOverlayIfSlow:false });
    },
    // si el usuario decide continuar sin cobrar, igual marcamos EN_ESPERA
    onSkip: async () => {
      const { error } = await supabase
        .from('turnos')
        .update({ estado: EST.EN_ESPERA, hora_arribo: nowHHMMSS() })
        .eq('id', turnoId);
      if (error) { alert('No se pudo registrar la llegada.'); return; }
      await refreshAll({ showOverlayIfSlow:false });
    }
  });
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
// =======================
// Refresh principal (con abort + overlay suave) y auto-refresh cada 2 minutos
// =======================
let autoRefreshInterval = null;
let visListenerAttached = false;

function startAutoRefresh() {
  // (re)inicia el intervalo
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  autoRefreshInterval = setInterval(() => { refreshAll(); }, 120000); // 2 min

  // agrega el listener de visibilidad una sola vez
  if (!visListenerAttached) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshAll(); // refresh inmediato al volver
        // reinicia el intervalo
        if (autoRefreshInterval) clearInterval(autoRefreshInterval);
        autoRefreshInterval = setInterval(() => { refreshAll(); }, 120000);
      } else {
        // pausa el intervalo cuando la pestaña no está visible
        if (autoRefreshInterval) clearInterval(autoRefreshInterval);
      }
    });
    visListenerAttached = true;
  }
}




// Suma pagos por turno y devuelve un mapa { [turno_id]: totalPagado }
async function fetchPagosMap(turnoIds = []) {
  const ids = [...new Set(turnoIds)].filter(Boolean);
  if (!ids.length) return {};
  const { data = [], error } = await supabase
    .from('turnos_pagos')
    .select('turno_id, importe')
    .in('turno_id', ids);

  if (error) {
    console.warn('[refreshAll] turnos_pagos error:', error);
    return {};
  }
  const map = {};
  for (const r of data) {
    const id = r.turno_id;
    const imp = Number(r.importe || 0);
    map[id] = (map[id] || 0) + imp;
  }
  return map;
}

function clearBoardsUI() {
  if (UI.tblPend) UI.tblPend.innerHTML = '';
  if (UI.tblEsp) UI.tblEsp.innerHTML = '';
  if (UI.tblAtencion) UI.tblAtencion.innerHTML = '';
  if (UI.tblDone) UI.tblDone.innerHTML = '';
  renderBoardTitles({ pendientes: [], presentes: [], atencion: [], atendidos: [] });
  if (UI.kpiFree) UI.kpiFree.textContent = '—';
  if (UI.kpiSub)  UI.kpiSub.textContent  = `${currentCentroNombre || ''} · ${profsLabel()} · ${currentFechaISO || ''}`;
}

/**
 * refreshAll({ showOverlayIfSlow = true } = {})
 *   - Trae datos del día
 *   - Calcula anchos de columnas
 *   - Suma pagos por turno
 *   - Renderiza las 4 tablas + KPIs
 */
async function refreshAll({ showOverlayIfSlow = true } = {}) {
  const myId = ++_refresh.reqId;

  // Overlay si tarda (suave)
  let overlayTimer = null;
  const rootNode = overlayRoot || (boardsEl?.closest?.('.page') || document.body);
  if (showOverlayIfSlow) {
    overlayTimer = setTimeout(() => setLoading(rootNode, true), 220);
  }

  try {
    // Precondiciones mínimas
    if (!currentCentroId) {
      clearBoardsUI();
      return;
    }

    // 1) Traer datos base del día
    const raw = await fetchDiaData();
    if (myId !== _refresh.reqId) return; // llegó tarde → descarto

    // 2) Filtro global si hay texto
    const data = applyFilter(raw);

    // 3) Calcular anchos de columnas en base a TODOS los turnos del día
    computeColumnWidthsForDay({ turnos: data.turnos || [] });
    // Actualizar la plantilla grid (por si las variables cambiaron)
    GRID_TEMPLATE = COLS.map(c => c.width).join(' ');

    // 4) KPIs y títulos
    renderKPIs(data);
    renderBoardTitles(data);

    // 5) Sumar pagos por turno (para mostrar "Tt / p" y saldos)
    const allIds = [
      ...data.pendientes.map(t => t.id),
      ...data.presentes.map(t => t.id),
      ...data.atencion.map(t => t.id),
      ...data.atendidos.map(t => t.id),
    ];
    const pagosMap = await fetchPagosMap(allIds);
    if (myId !== _refresh.reqId) return; // llegó tarde

    // 6) Render de tablas
    if (UI.tblPend)     await renderPendientes(data.pendientes, pagosMap);
    if (UI.tblEsp)      renderPresentes(data.presentes, pagosMap);
    if (UI.tblAtencion) renderAtencion(data.atencion, pagosMap);
    if (UI.tblDone)     renderAtendidos(data.atendidos, pagosMap);

  } catch (err) {
    console.error('[refreshAll] error:', err);
    // fallback UI simple
    clearBoardsUI();
  } finally {
    if (overlayTimer) clearTimeout(overlayTimer);
    setLoading(rootNode, false);
  }
}


/* =======================
   INIT (export)
   ======================= */
export async function initInicio(root){
  bindUI(root);
  ensureOverlay(root);
  overlayRoot = root;

  addClickableCursorStyle();

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
  setLoading(overlayRoot, true);
  await refreshAll({ showOverlayIfSlow:false });
  setLoading(overlayRoot, false);

  // watcher de centro (si cambia en otro tab/side, re-carga todo)
  startCentroWatcher();
  startAutoRefresh();
}

async function pasarAEnAtencion(turnoId, ev){
  if (ev) ev.preventDefault();

  // Permisos
  if (!roleAllows('atender', userRole)) {
    alert('Solo AMP/Médico pueden atender.');
    return;
  }

  // 1) Leer turno y validar estado actual
  const { data: t, error: terr } = await supabase
    .from('turnos')
    .select('id, estado, copago')
    .eq('id', turnoId)
    .maybeSingle();

  if (terr || !t) {
    alert('No se pudo leer el turno.');
    return;
  }
  if (t.estado !== EST.EN_ESPERA) {
    alert('Para atender, el turno debe estar EN ESPERA.');
    return;
  }

  // 2) ¿Hay saldo de copago pendiente?
  const cop = toPesoInt(t.copago) ?? 0;
  const { totalPagado } = await getPagoResumen(turnoId);
  const pendiente = Math.max(0, cop - (totalPagado || 0));

  // 3) Si no hay nada que cobrar → pasar directo a EN_ATENCION
  if (pendiente <= 0) {
    const { error } = await supabase
      .from('turnos')
      .update({ estado: EST.EN_ATENCION })
      .eq('id', turnoId)
      .eq('estado', EST.EN_ESPERA);
    if (error) { alert('No se pudo pasar a "En atención".'); return; }

    await refreshAll({ showOverlayIfSlow:false });
    await openFicha(turnoId);
    return;
  }

  // 4) Hay saldo pendiente → abrir el NUEVO modal de pagos
  openPaymentBridge({
    turnoId,
    amount: pendiente,
    confirmLabel: 'Cobrar y pasar a En atención',
    skipLabel: 'Continuar sin cobrar',
    onPaid: async () => {
      // pasar a EN_ATENCION con guard de estado
      const { error } = await supabase
        .from('turnos')
        .update({ estado: EST.EN_ATENCION })
        .eq('id', turnoId)
        .eq('estado', EST.EN_ESPERA);
      if (error) { alert('Se cobró, pero no se pudo pasar a "En atención".'); return; }

      await refreshAll({ showOverlayIfSlow:false });
      await openFicha(turnoId);
    },
    onSkip: async () => {
      // continuar sin cobrar: solo cambiar estado
      const { error } = await supabase
        .from('turnos')
        .update({ estado: EST.EN_ATENCION })
        .eq('id', turnoId)
        .eq('estado', EST.EN_ESPERA);
      if (error) { alert('No se pudo pasar a "En atención".'); return; }

      await refreshAll({ showOverlayIfSlow:false });
      await openFicha(turnoId);
    }
  });
}


/* =======================
   Panel izquierdo (abrir / cerrar / guardar)
   ======================= */

async function inicioOpenTurnoPanel(turnoId){
  // Helpers locales para UI
  const setText = (el, txt='—') => { if (el) el.textContent = txt; };
  const setChip = (el, txt, tone='') => {
    if (!el) return;
    el.textContent = txt;
    el.className = 'chip' + (tone ? ' ' + tone : '');
  };
  const show = (el, v=true) => { if (el) el.style.display = v ? '' : 'none'; };
  const enable = (el, v=true) => { if (el) el.disabled = !v; };

  // Lightbox simple para imágenes
  const openLightbox = (src) => {
    const overlay = document.createElement('div');
    overlay.className = 'lb-overlay';
    overlay.innerHTML = `
      <div class="lb-backdrop"></div>
      <div class="lb-content" role="dialog" aria-modal="true">
        <button class="lb-close" aria-label="Cerrar">×</button>
        <img class="lb-img" alt="Comprobante" />
      </div>
    `;
    const css = document.createElement('style');
    css.textContent = `
      .lb-overlay{position:fixed;inset:0;z-index:1000}
      .lb-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.6)}
      .lb-content{position:absolute;inset:6%;display:flex;align-items:center;justify-content:center}
      .lb-img{max-width:100%;max-height:100%;box-shadow:0 8px 30px rgba(0,0,0,.4);border-radius:8px;background:#fff}
      .lb-close{position:absolute;top:10px;right:14px;font-size:28px;line-height:1;border:0;background:#fff;border-radius:999px;width:36px;height:36px;cursor:pointer}
    `;
    overlay.appendChild(css);
    document.body.appendChild(overlay);
    overlay.querySelector('.lb-img').src = src;
    const close = () => overlay.remove();
    overlay.querySelector('.lb-backdrop').onclick = close;
    overlay.querySelector('.lb-close').onclick = close;
    document.addEventListener('keydown', function onEsc(e){
      if (e.key === 'Escape'){ close(); document.removeEventListener('keydown', onEsc); }
    });
  };

  // 1) Traer turno + paciente
  const { data: t, error } = await supabase
    .from('turnos')
    .select(`
      id, fecha, hora_inicio, hora_fin, estado, hora_arribo,
      copago, paciente_id, comentario_recepcion,
      pacientes(dni, apellido, nombre)
    `)
    .eq('id', turnoId)
    .maybeSingle();

  if (error || !t) {
    // Limpio UI básico si algo falla
    setText(UI.tp?.title, 'Paciente');
    setText(UI.tp?.sub, 'DNI —');
    setText(UI.tp?.hora, 'Turno: —');
    setChip(UI.tp?.estado, '—', '');
    setChip(UI.tp?.copago, 'Sin copago', 'muted');
    setText(document.getElementById('tp-copago-info'), '—');
    ['btnArr','btnAt','btnPago','btnCan'].forEach(k => show(UI.tp?.[k], false));
    // Abrir panel igual, para mostrar el estado
    const el = UI?.tp?.el || document.getElementById('turnoPanel');
    if (el){
      el.classList.add('open');
      el.setAttribute('aria-hidden','false');
      el.setAttribute('data-turno-id', String(turnoId));
      document.body.classList.add('tp-open');
      (UI?.tp?.close || el.querySelector('#tp-close'))?.addEventListener('click', inicioHideTurnoPanel, { once:true });
    }
    return;
  }

  // 2) Header (nombre + DNI)
  const p = t.pacientes || {};
  const ape = (p.apellido || '').trim();
  const nom = (p.nombre || '').trim();
  const fullName = (nom || ape) ? `${nom} ${ape}`.trim() : 'Paciente';
  setText(UI.tp?.title, fullName);
  setText(UI.tp?.sub, `DNI ${p.dni || '—'}`);

  // 3) Fecha + rango horario
  const hi = toHM(t.hora_inicio);
  const hf = toHM(t.hora_fin);
  let rango = '—';
  if (hi && hf)      rango = `${hi} — ${hf}`;
  else if (hi)       rango = hi;
  else if (hf)       rango = hf;
  const fechaTxt = t.fecha || currentFechaISO || '—';
  setText(UI.tp?.hora, `Turno: ${fechaTxt} · ${rango}`);

  // 4) Chips: estado + copago
  const estado = t.estado;
  const toneByEstado = {
    [EST.ASIGNADO]:    'info',
    [EST.EN_ESPERA]:   'accent',
    [EST.EN_ATENCION]: 'warn',
    [EST.ATENDIDO]:    'ok',
    [EST.CANCELADO]:   'muted',
    [EST.CONFIRMADO]:  'info'
  };
  setChip(UI.tp?.estado, (estado || '—').replaceAll('_',' '), toneByEstado[estado] || '');

  const cop = toPesoInt(t.copago) ?? 0;
  if (cop > 0) setChip(UI.tp?.copago, `Copago: ${money(cop)}`, 'accent');
  else setChip(UI.tp?.copago, 'Sin copago', 'muted');

  // 4.b) Pre-cargar comentario de recepción
  if (UI.tp?.com) {
    UI.tp.com.value = t.comentario_recepcion || '';
  }

  // 5) Resumen de pago (Total/Pagado/Pendiente)
  let totalPagado = 0;
  try {
    const { totalPagado: tp } = await getPagoResumen(turnoId);
    totalPagado = Number(tp || 0);
  } catch {}
  const pendiente = Math.max(0, (toPesoInt(t.copago) ?? 0) - totalPagado);
  const infoEl = document.getElementById('tp-copago-info');
  if (infoEl) {
    if (cop === 0) {
      infoEl.textContent = 'Sin copago';
    } else {
      const parts = [
        `Total: ${money(cop)}`,
        `Pagado: ${money(totalPagado)}`
      ];
      if (pendiente === 0) parts.push(`✅ Abonado`);
      else parts.push(`Pendiente: ${money(pendiente)}`);
      infoEl.textContent = parts.join(' · ');
    }
  }

  // 5.b) Vista previa del comprobante (si existe)
  try {
    // buscamos el último pago con comprobante
    const { data: compRows = [] } = await supabase
      .from('turnos_pagos')
      .select('id, comprobante_url, mime_type')
      .eq('turno_id', turnoId)
      .not('comprobante_url','is', null)
      .order('fecha', { ascending: false })
      .limit(1);
    const comp = compRows?.[0];

    // crear contenedor si no existe
    let wrap = document.getElementById('tp-comp-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'tp-comp-wrap';
      wrap.style.marginTop = '8px';
      // insertarlo debajo de #tp-copago-info
      const row = infoEl?.parentElement || UI.tp?.el?.querySelector('.tp-section .tp-row');
      (row || UI.tp?.el)?.appendChild(wrap);
    }
    // limpiar
    wrap.innerHTML = '';

    if (comp?.comprobante_url) {
      const url = comp.comprobante_url;
      const mime = (comp.mime_type || '').toLowerCase();
      const isImg = mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(url);

      const title = document.createElement('div');
      title.textContent = 'Comprobante:';
      title.style.fontSize = '12px';
      title.style.color = '#6b6480';
      title.style.marginBottom = '4px';
      wrap.appendChild(title);

      if (isImg) {
        const thumb = document.createElement('img');
        thumb.src = url;
        thumb.alt = 'Comprobante';
        thumb.style.maxWidth = '120px';
        thumb.style.maxHeight = '90px';
        thumb.style.borderRadius = '6px';
        thumb.style.boxShadow = '0 1px 4px rgba(0,0,0,.12)';
        thumb.style.cursor = 'zoom-in';
        thumb.onclick = () => openLightbox(url);
        wrap.appendChild(thumb);
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = 'Abrir comprobante';
        a.className = 'btn secondary';
        wrap.appendChild(a);
      }
    }
  } catch (e) {
    // si falla, no interrumpimos el panel
    // console.warn('[inicioOpenTurnoPanel] preview comprobante warn:', e);
  }

  // 6) Botones (visibilidad y habilitación según permisos/estado)
  const isHoy = (currentFechaISO === todayISO());

  // ARRIBO: pasa ASIGNADO -> EN_ESPERA (hora_arribo)
  const canArribo = roleAllows('arribo', userRole) && estado === EST.ASIGNADO && isHoy;
  show(UI.tp?.btnArr, canArribo);
  if (UI.tp?.btnArr) {
    enable(UI.tp.btnArr, canArribo);
    UI.tp.btnArr.onclick = () => marcarLlegadaYCopago(turnoId);
  }

  // ATENDER: permite pasar a EN_ATENCION (desde EN_ESPERA)
  const canAtender = roleAllows('atender', userRole) && estado === EST.EN_ESPERA;
  show(UI.tp?.btnAt, canAtender);
  if (UI.tp?.btnAt) {
    enable(UI.tp.btnAt, canAtender);
    UI.tp.btnAt.onclick = (ev) => pasarAEnAtencion(turnoId, ev);
  }

  // FINALIZAR: solo cuando ya está EN_ATENCIÓN
  const canFinalizar = roleAllows('finalizar', userRole) && estado === EST.EN_ATENCION;
  show(UI.tp?.btnFinalizar, canFinalizar);
  if (UI.tp?.btnFinalizar) {
    enable(UI.tp.btnFinalizar, canFinalizar);
    UI.tp.btnFinalizar.onclick = () => finalizarAtencion(turnoId);
  }

  // CANCELAR: si no está atendido ni cancelado
  const canCancelar = roleAllows('cancelar', userRole) && estado !== EST.CANCELADO && estado !== EST.ATENDIDO;
  show(UI.tp?.btnCan, canCancelar);
  if (UI.tp?.btnCan) {
    enable(UI.tp.btnCan, canCancelar);
    UI.tp.btnCan.onclick = () => anularTurno(turnoId);
  }

  // PAGO: si hay copago pendiente → abre NUEVO modal
  const canPagar = (cop > 0 && pendiente > 0);
  show(UI.tp?.btnPago, canPagar);
  if (UI.tp?.btnPago) {
    enable(UI.tp.btnPago, canPagar);
    UI.tp.btnPago.onclick = () => openPaymentBridge({
      turnoId,
      amount: pendiente,
      confirmLabel: 'Registrar pago',
      skipLabel: 'Cerrar',
      onPaid: async () => {
        await inicioOpenTurnoPanel(turnoId);                 // refresca slide
        await refreshAll({ showOverlayIfSlow:false });       // refresca boards
      },
      onSkip: () => {} // nada
    });
  }

  // FICHA
  const canAbrirFicha = roleAllows('abrir_ficha', userRole);
  show(UI.tp?.btnFicha, canAbrirFicha);
  if (UI.tp?.btnFicha) {
    enable(UI.tp.btnFicha, canAbrirFicha);
    UI.tp.btnFicha.onclick = () => openFicha(turnoId);
  }

  // Guardar comentario recepción (si el input existe)
  if (UI.tp?.btnSave && UI.tp?.com) {
    UI.tp.btnSave.onclick = async () => {
      const v = (UI.tp.com.value || '').trim() || null;
      const { error: e } = await supabase
        .from('turnos')
        .update({ comentario_recepcion: v })
        .eq('id', turnoId);
      if (e) { alert('No se pudo guardar el comentario.'); return; }
      UI.tp.btnSave.classList.add('ok');
      setTimeout(()=> UI.tp.btnSave.classList.remove('ok'), 600);
    };
  }

  // 7) Abrir panel (off-canvas) y focos
  const el = UI?.tp?.el || document.getElementById('turnoPanel');
  if (el){
    el.classList.add('open');
    el.setAttribute('aria-hidden','false');
    el.setAttribute('data-turno-id', String(turnoId));
    document.body.classList.add('tp-open');
    const btnClose = UI?.tp?.close || el.querySelector('#tp-close');
    btnClose?.addEventListener('click', inicioHideTurnoPanel, { once:true });
    btnClose?.focus?.();
  }
}



function inicioHideTurnoPanel(){
  const el = UI?.tp?.el || document.getElementById('turnoPanel');
  if (!el) return;
  el.classList.remove('open');
  el.setAttribute('aria-hidden','true');
  el.removeAttribute('data-turno-id');
  document.body.classList.remove('tp-open');
}



async function inicioGuardarComentarioRecepcion(turnoId){
  if (!UI?.tp?.com) return;
  const txt = (UI.tp.com.value || '').trim();
  if (UI.tp.status) UI.tp.status.textContent = 'Guardando…';
  const { error } = await supabase
    .from('turnos')
    .update({ comentario_recepcion: txt || null })
    .eq('id', turnoId);
  if (error){
    if (UI.tp.status) UI.tp.status.textContent = 'Error guardando.';
    alert(error.message || 'No se pudo guardar');
    return;
  }
  if (UI.tp.status) UI.tp.status.textContent = 'Guardado ✓';
  setTimeout(()=>{ if (UI.tp?.status) UI.tp.status.textContent=''; }, 1200);
  refreshAll({ showOverlayIfSlow:false });
}

/** Utilidad opcional (por si la querés usar en algún lado) */
function inicioIsTurnoPanelOpen(){
  return !!UI?.tp?.el && UI.tp.el.classList.contains('open');
}

/* =======================
   UX: cursor de "manito" en filas clickeables
   ======================= */
function addClickableCursorStyle(){
  if (document.getElementById('inicio-row-cursor-style')) return;
  const style = document.createElement('style');
  style.id = 'inicio-row-cursor-style';
  style.textContent = `
    /* Manito en filas de datos */
    table tbody tr.row { cursor: pointer; }

    /* No cambiar el cursor en el header */
    table thead tr { cursor: default; }

    /* Iconos siguen siendo clickeables */
    .row .icon { cursor: pointer; }

    /* Un pequeño hover para reforzar affordance (opcional) */
    table tbody tr.row:hover {
      background: rgba(118,86,176,.06);
    }
  `;
  document.head.appendChild(style);
}


   /**
 * Bridge para abrir el modal de pago definido en el HTML de "payment".
 * No crea DOM nuevo: solo dispara un evento que el módulo/payment ya maneja.
 *
 * Detalle que enviamos al listener:
 * - turnoId (obligatorio)
 * - amount  (opcional; si no viene, el módulo puede calcular pendiente)
 * - confirmLabel, skipLabel (opcionales)
 * - onPaid({ importe, medio }) (opcional; callback tras cobrar)
 * - onSkip() (opcional; callback si sigue sin cobrar)
 */
function openPaymentBridge({
  turnoId,
  amount = null,
  confirmLabel = 'Cobrar y continuar',
  skipLabel = 'Continuar sin cobrar',
  onPaid = null,
  onSkip = null
} = {}) {
  if (!turnoId) {
    console.warn('[openPaymentBridge] turnoId es requerido');
    return;
  }

  // Armamos y disparamos el evento que debe consumir el módulo/payment
  const ev = new CustomEvent('payment:open', {
    detail: {
      turnoId,
      amount,
      confirmLabel,
      skipLabel,
      onPaid,
      onSkip
    },
    bubbles: true,
    cancelable: true
  });

  document.dispatchEvent(ev);
}
