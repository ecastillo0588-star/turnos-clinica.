  // turnos.js (igual selección que Inicio + mismos permisos)
// =======================================================

import supabase from './supabaseClient.js';
import { isValidHourRange as _isValidHourRange } from './validators.js';
import { openPacienteModal, loadProfesionalesIntoSelect, applyRoleClasses, roleAllows } from './global.js';

// ---------------------------
// Validación HH:MM (fallback)
// ---------------------------
const isValidHourRange = typeof _isValidHourRange === 'function'
  ? _isValidHourRange
  : (s, e) => /^\d{2}:\d{2}$/.test(s) && s < e;

// ---------------------------
// Estado y utilidades base
// ---------------------------
const safeLocalStorage = (() => {
  try { return window.localStorage; }
  catch { return { getItem: () => null, setItem: () => {}, removeItem: () => {} }; }
})();

let currentCentroId        = safeLocalStorage.getItem('centro_medico_id');
let currentCentroNombre    = safeLocalStorage.getItem('centro_medico_nombre') || '';
let currentCentroDireccion = '';

const userRole            = String(safeLocalStorage.getItem('user_role') || '').toLowerCase(); // medico|amp|amc|propietario
const loggedProfesionalId = safeLocalStorage.getItem('profesional_id');

let view = todayInfo();

// Profesionales (igual que Inicio)
let selectedProfesionales = [];     // array de ids (string)
let PROF_NAME = new Map();          // id -> label (desde <select>)
function rebuildProfMap(sel){
  PROF_NAME.clear();
  Array.from(sel.options).forEach(o => {
    if (o.value) PROF_NAME.set(String(o.value), (o.textContent||'').trim());
  });
}
const profNameById = (id) => PROF_NAME.get(String(id)) || '—';

// Compat con openPacienteModal() cuando crea el vínculo paciente-profesional
// (usamos el primero seleccionado si hay varios)
window.currentProfesional = null;

// Duraciones
let duracionCfg = { nueva_consulta: 15, recurrente: 15, sobreturno: 15 };

// Modal & paciente
let modalDateISO = null;
let pacienteSeleccionado = null;

// Obras sociales
let obrasSocialesCache = [];
const obrasSocialesById = new Map();

// Reprogramación
let reprogramState = null; // { turno, durMin }
let bookingBusy = false;
let reprogramBusy = false;

// Watcher de centro
let centroWatchTimer = null;

// ---------------------------
/* Helpers fecha / formato */
// ---------------------------
function todayInfo(){ const d = new Date(); return { y:d.getFullYear(), m:d.getMonth(), d:d.getDate() }; }
function pad(n){ return n<10 ? '0'+n : ''+n; }
function toISODate(y,m,d){ return `${y}-${pad(m+1)}-${pad(d)}`; }
function dateToISO(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function toHM(t){ return (t||'').slice(0,5); }
function addMinutes(hhmm, mm){
  const [h,m] = hhmm.split(':').map(Number);
  const base = new Date(2000,0,1,h,m); base.setMinutes(base.getMinutes()+mm);
  return `${pad(base.getHours())}:${pad(base.getMinutes())}`;
}
function overlaps(aS,aE,bS,bE){ return aS < bE && bS < aE; }
function minutesDiff(a,b){
  const [h1,m1] = a.split(':').map(Number);
  const [h2,m2] = b.split(':').map(Number);
  return h2*60+m2 - (h1*60+m1);
}
function groupBy(arr, key){
  const m = new Map(); for (const x of arr||[]) {
    const k = x[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(x);
  } return m;
}
function groupByFecha(arr){ return groupBy(arr, 'fecha'); }
function fmtDateLong(iso){
  const [y,m,d] = iso.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}
const DOW = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
function nativeFirstDow(d){ const g = d.getDay(); return g===0 ? 6 : g-1; }

function getCurrentUserTag(){
  const keys = ['user_email','email','username','user_name','user_id'];
  for (const k of keys){
    const v = safeLocalStorage.getItem(k);
    if (v && String(v).trim()){
      const out = String(v).trim();
      return k.includes('email') ? out.toLowerCase().slice(0,128) : out.slice(0,128);
    }
  }
  // fallback: algunas apps guardan un objeto "user" en JSON
  try{
    const raw = safeLocalStorage.getItem('user');
    if (raw){
      const u = JSON.parse(raw);
      if (u?.email) return String(u.email).trim().toLowerCase().slice(0,128);
      if (u?.id)    return String(u.id).trim().slice(0,128);
    }
  }catch{}
  return null; // sin info en LS
}



// ---------------------------
/* WhatsApp helpers */
// ---------------------------
function normalizePhoneForWA(raw){
  if (!raw) return '';
  let p = String(raw).replace(/[^\d]/g,'');
  if (p.startsWith('0')) p = p.slice(1);
  if (!p.startsWith('54')) p = '549' + p;
  else if (p.startsWith('54') && !p.startsWith('549')) p = '549' + p.slice(2);
  return p;
}

const EMO = {
  check:     '\u2705',         // ✅
  calendar:  '\u{1F4C5}',      // 📅
  clock:     '\u23F0',         // ⏰
  // Stethoscope (puede no estar en SO viejos). Fallback: persona de salud + símbolo médico
  steth:     '\u{1FA7A}',      // 🩺
  stethAlt:  '\u{1F9D1}\u200D\u2695\uFE0F', // 🧑‍⚕️
  hospital:  '\u{1F3E5}',      // 🏥
  receipt:   '\u{1F9FE}',      // 🧾 (puede faltar en SO viejos)
  card:      '\u{1F4B3}',      // 💳
  pray:      '\u{1F64F}',      // 🙏
};

function buildWA({ pac, fechaISO, start, end, prof, centro, dir, osNombre = null, copago = null }){
  const nombre = `${(pac?.nombre||'').trim()} ${(pac?.apellido||'').trim()}`.trim() || 'Paciente';

  const fechaRaw = (fmtDateLong(fechaISO) || '').replace(',', '');
  const stop = new Set(['de','del','la','el','los','las','y']);
  const fechaCap = fechaRaw
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i === 0 || !stop.has(w)) ? (w.charAt(0).toUpperCase() + w.slice(1)) : w)
    .join(' ')
    .trim();

  const horaTxt   = `${(start || '').slice(0,5)} hs`;
  const centroTxt = [centro, dir].filter(Boolean).join(' · ');
  const lineaCentro = centroTxt ? `*Centro médico*: ${centroTxt} ${EMO.hospital}` : null;

  const lineaOSoCopago = osNombre
    ? `*Obra social*: ${osNombre} ${EMO.receipt}`
    : (copago != null ? `*Particular*: Copago $${Number(copago).toLocaleString('es-AR', { maximumFractionDigits: 0 })} ${EMO.card}` : null);

  // si tu público es “viejo”, cambiale EMO.steth por EMO.stethAlt
  const emSteth = EMO.steth; // o EMO.stethAlt

  const partes = [
    `Estimado *${nombre}*.`,
    ``,
    `Su turno ha sido confirmado ${EMO.check}`,
    `*Fecha:* ${fechaCap} ${EMO.calendar}`,
    `*Hora:* ${horaTxt} ${EMO.clock}`,
    `*Profesional:* ${prof || ''} ${emSteth}`,
    lineaCentro,
    lineaOSoCopago,
    osNombre
      ? `- Por favor presentarse 5 minutos antes del turno con DNI y credencial de Obra Social.`
      : `- Recorda traer tus estudios realizados.`,
    `En caso de no poder asistir, informar con antelación.`,
    `_Muchas gracias_ ${EMO.pray}`
  ].filter(Boolean);

  return partes.join('\n');
}



// ---------------------------
/* UI refs */
// ---------------------------
let UI = {};
function bindUI(){
  UI = {
    // Solo select de profesional (centro viene del sidebar)
    profesionalSelect: document.getElementById('turnos-profesional-select'),
    tipoTurno:         document.getElementById('turnos-tipo'),

    // Pacientes (typeahead)
    pacInput:    document.getElementById('turnos-paciente-input'),
    pacSuggest:  document.getElementById('turnos-paciente-suggest'),
    pacChip:     document.getElementById('turnos-paciente-chip'),
    pacChipText: document.getElementById('turnos-paciente-chip-text'),
    pacClear:    document.getElementById('turnos-paciente-clear'),

    // Calendario mensual
    calDow:   document.getElementById('turnos-cal-dow'),
    calGrid:  document.getElementById('turnos-cal-grid'),
    calTitle: document.getElementById('turnos-cal-title'),
    status:   document.getElementById('turnos-status'),
    prevMonth: document.getElementById('turnos-prev-month'),
    nextMonth: document.getElementById('turnos-next-month'),
    btnHoy:    document.getElementById('turnos-btn-hoy'),

    // Modal día
    modal:           document.getElementById('turnos-modal'),
    modalTitle:      document.getElementById('turnos-modal-title'),
    modalClose:      document.getElementById('turnos-modal-close'),
    modalDateInput:  document.getElementById('turnos-modal-date'),
    modalPrevDay:    document.getElementById('turnos-modal-prev-day'),
    modalNextDay:    document.getElementById('turnos-modal-next-day'),
    slotsList:       document.getElementById('turnos-slots-list'),

    // Modal OK
    okBackdrop:  document.getElementById('turnos-modal-ok'),
    okClose:     document.getElementById('ok-close'),
    okTitle:     document.getElementById('ok-title'),
    okPaciente:  document.getElementById('ok-paciente'),
    okDni:       document.getElementById('ok-dni'),
    okFechaHora: document.getElementById('ok-fecha-hora'),
    okProf:      document.getElementById('ok-prof'),
    okCentro:    document.getElementById('ok-centro'),
    okDir:       document.getElementById('ok-direccion'),
    okWa:        document.getElementById('ok-wa-link'),
    okCopy:      document.getElementById('ok-copy'),
    okMsg:       document.getElementById('ok-msg'),

    // Mini-cal (modal)
    miniCal: document.getElementById('turnos-mini-cal'),

    // Opcionales (si existen)
    npObra:     document.getElementById('np-obra'),
    npObraInfo: document.getElementById('np-obra-info'),
  };
}

// ---------------------------
/* Centro (sidebar) */
// ---------------------------
async function fetchCentroById(id){
  if (!id) return { nombre:'', direccion:'' };
  const { data } = await supabase.from('centros_medicos').select('nombre,direccion').eq('id', id).maybeSingle();
  return { nombre:data?.nombre||'', direccion:data?.direccion||'' };
}
async function syncCentroFromStorage(force=false){
  const id  = safeLocalStorage.getItem('centro_medico_id');
  const nom = safeLocalStorage.getItem('centro_medico_nombre') || currentCentroNombre;

  if (force || id !== currentCentroId || nom !== currentCentroNombre){
    currentCentroId = id;
    currentCentroNombre = nom || '';
    const c = await fetchCentroById(currentCentroId);
    currentCentroNombre   = c.nombre || currentCentroNombre;
    currentCentroDireccion= c.direccion || '';
    try { safeLocalStorage.setItem('centro_medico_nombre', currentCentroNombre); } catch {}

    await loadProfesionales();          // repobla select (igual que Inicio)
    await loadDuracionesForSelected();  // recarga duraciones según selección
    await renderCalendar();             // refresca vista
    if (UI.modal?.style.display === 'flex' && modalDateISO){
      await refreshDayModal();
      await renderMiniCalFor(modalDateISO);
    }
  }
}
function startCentroWatcher(){
  if (centroWatchTimer) clearInterval(centroWatchTimer);
  centroWatchTimer = setInterval(() => syncCentroFromStorage(false), 1000);
}
window.addEventListener('beforeunload', () => { if (centroWatchTimer) clearInterval(centroWatchTimer); });

// ---------------------------
/* Profesionales (como en Inicio) */
// ---------------------------
async function loadProfesionales(){
  const sel = UI.profesionalSelect;
  if (!sel) return;

  // AMC = multiselección
  if (userRole === 'amc') {
    sel.multiple = true;
    sel.classList.remove('compact');
  } else {
    sel.multiple = false;
    sel.classList.add('compact');
  }

  // Reutilizamos helper unificado (global.js)
  await loadProfesionalesIntoSelect(sel, {
    role: userRole,
    centroId: currentCentroId,
    loggedProfesionalId
  });

  rebuildProfMap(sel);

  if (sel.multiple) {
    // Seleccionar todos por defecto (como Inicio)
    selectedProfesionales = Array.from(sel.options)
      .filter(o => o.value)
      .map(o => { o.selected = true; return String(o.value); });

    sel.size = Math.min(10, Math.max(4, selectedProfesionales.length || 6));
    window.currentProfesional = selectedProfesionales[0] || null;
  } else {
    selectedProfesionales = sel.value ? [String(sel.value)] : [];
    window.currentProfesional = selectedProfesionales[0] || null;
  }
}
function hookProfesionalSelect(){
  const sel = UI.profesionalSelect;
  if (!sel) return;

  sel.addEventListener('change', async () => {
    selectedProfesionales = sel.multiple
      ? Array.from(sel.selectedOptions).map(o => String(o.value)).filter(Boolean)
      : (sel.value ? [String(sel.value)] : []);
    window.currentProfesional = selectedProfesionales[0] || null;
    await loadDuracionesForSelected();
    await renderCalendar();
    if (UI.modal?.style.display === 'flex' && modalDateISO) {
      await refreshDayModal();
      await renderMiniCalFor(modalDateISO);
    }
  });
}

// ---------------------------
/* Duraciones */
// ---------------------------
async function loadDuraciones(pid){
  // defaults
  duracionCfg = { nueva_consulta: 15, recurrente: 15, sobreturno: 15 };
  if (!pid || !currentCentroId) return;

  const { data, error } = await supabase
    .from('config_duracion_turnos')
    .select('tipo_turno,minutos')
    .eq('profesional_id', pid)
    .eq('centro_id', currentCentroId);

  if (error) { console.warn('Error cargando duraciones:', error.message); return; }
  (data || []).forEach(r => {
    if (r.tipo_turno && r.minutos) duracionCfg[r.tipo_turno] = r.minutos;
  });
}
async function loadDuracionesForSelected(){
  // Si hay varias selecciones, priorizamos la del primer profesional para el largo de slot
  await loadDuraciones(selectedProfesionales[0] || null);
}

// ---------------------------
/* Cupos OS (mensual, cross-centro) */
// ---------------------------
const cupoConfigCache = new Map(); // Map<medicoId, Map<obraSocialId, conf>>
async function getMedicoOsConfig(medicoId, obraSocialId){
  if (!medicoId || !obraSocialId) return null;
  let byOs = cupoConfigCache.get(medicoId);
  if (!byOs){ byOs = new Map(); cupoConfigCache.set(medicoId, byOs); }
  if (byOs.has(obraSocialId)) return byOs.get(obraSocialId);

  const { data, error } = await supabase
    .from('medico_obras_sociales')
    .select('cantidad_turnos, condicion_copago, valor_copago')
    .eq('medico_id', medicoId)
    .eq('obra_social_id', obraSocialId)
    .maybeSingle();

  if (error){ console.warn('medico_obras_sociales error:', error.message); byOs.set(obraSocialId, null); return null; }
  byOs.set(obraSocialId, data || null);
  return data || null;
}
function monthRangeISO(anyISO){
  const d = new Date(anyISO + 'T00:00:00');
  const y = d.getFullYear(), m = d.getMonth();
  const first = toISODate(y,m,1);
  const last  = toISODate(y,m,new Date(y,m+1,0).getDate());
  return { first, last };
}
function isSameMonth(a,b){
  if (!a || !b) return false;
  const da = new Date(a + 'T00:00:00');
  const db = new Date(b + 'T00:00:00');
  return da.getFullYear()===db.getFullYear() && da.getMonth()===db.getMonth();
}
async function getUsedTurnosMes({ medicoId, obraSocialId, fechaISO, estadosValidos=null }){
  if (!obraSocialId) return 0;
  const hoyISO = dateToISO(new Date());
  if (isSameMonth(fechaISO, hoyISO)){
    const { data, error } = await supabase
      .from('v_turnos_os_prof_mes')
      .select('turnos_mes')
      .eq('medico_id', medicoId)
      .eq('obra_social_id', obraSocialId)
      .maybeSingle();
    if (!error) return Number(data?.turnos_mes || 0);
    console.warn('v_turnos_os_prof_mes error (fallback):', error?.message);
  }
  const { first, last } = monthRangeISO(fechaISO);
  let q = supabase.from('turnos')
    .select('id', { count:'exact', head:true })
    .eq('profesional_id', medicoId)
    .eq('obra_social_id', obraSocialId)
    .gte('fecha', first)
    .lte('fecha', last);
  q = Array.isArray(estadosValidos) && estadosValidos.length ? q.in('estado', estadosValidos) : q.neq('estado','cancelado');
  const { count, error } = await q;
  if (error){ console.warn('Error contando turnos (fallback):', error.message); return 0; }
  return Number(count || 0);
}
async function getCupoObraSocialMensual(obraSocialId, medicoId, fechaISO, estadosValidos=null){
  if (!obraSocialId) return { disponible:true, usados:0, limite:null, condicion_copago:null, valor_copago:null };
  const conf = await getMedicoOsConfig(medicoId, obraSocialId);
  if (!conf || conf.cantidad_turnos == null){
    const usados = await getUsedTurnosMes({ medicoId, obraSocialId, fechaISO, estadosValidos });
    return { disponible:true, usados, limite:null, condicion_copago:conf?.condicion_copago ?? null, valor_copago:conf?.valor_copago ?? null };
  }
  const usados = await getUsedTurnosMes({ medicoId, obraSocialId, fechaISO, estadosValidos });
  const limite = Number(conf.cantidad_turnos);
  return { disponible: usados < limite, usados, limite, condicion_copago:conf.condicion_copago ?? null, valor_copago: conf.valor_copago ?? null };
}

// ---------------------------
/* Obras sociales */
// ---------------------------
async function loadObrasSociales(){
  const { data } = await supabase.from('obras_sociales').select('id,obra_social,condicion_copago,valor_copago').order('obra_social',{ascending:true});
  obrasSocialesCache = data || [];
  obrasSocialesById.clear();
  (obrasSocialesCache||[]).forEach(o => obrasSocialesById.set(String(o.id), o));

  if (UI.npObra){
    UI.npObra.innerHTML =
      '<option value="">(Sin obra social)</option>' +
      (obrasSocialesCache||[]).map(o => `<option value="${o.obra_social}">${o.obra_social}</option>`).join('');
  }
}

// ---------------------------
/* Pacientes (typeahead) */
// ---------------------------
let suggestTimer = null;
function hideSuggest(){ if (UI.pacSuggest){ UI.pacSuggest.style.display='none'; UI.pacSuggest.innerHTML=''; } }
function showSuggest(){ if (UI.pacSuggest) UI.pacSuggest.style.display='block'; }

async function fetchSuggestions(q){
  if (!UI.pacSuggest) return;
  let result = [];
  if (/^\d{6,}$/.test(q)){
    const { data } = await supabase.from('pacientes').select('id,dni,apellido,nombre,telefono,email,obra_social_id').eq('dni', q).limit(10);
    result = data || [];
  } else {
    const parts = q.toLowerCase().split(/\s+/).filter(Boolean);
    let query = supabase.from('pacientes').select('id,dni,apellido,nombre,telefono,email,obra_social_id').eq('activo', true).limit(10).order('apellido',{ascending:true});
    if (parts[0]) query = query.ilike('apellido', `%${parts[0]}%`);
    if (parts[1]) query = query.ilike('nombre', `%${parts[1]}%`);
    const { data } = await query; result = data || [];
  }

  if (!result.length){
    UI.pacSuggest.innerHTML = `
      <div class="tw-s-item" data-act="create">
        <div><div class="tw-s-title">+ Crear nuevo paciente</div><div class="tw-s-meta">No se encontraron coincidencias para “${q}”.</div></div>
      </div>`;
    showSuggest(); bindSuggestHandlers(q, []); return;
  }

  UI.pacSuggest.innerHTML =
    result.map(p => `
      <div class="tw-s-item" data-act="select" data-id="${p.id}">
        <div>
          <div class="tw-s-title">${p.apellido}, ${p.nombre}</div>
          <div class="tw-s-meta">DNI ${p.dni}${p.telefono ? ' · '+p.telefono : ''}${p.email ? ' · '+p.email : ''}</div>
        </div>
      </div>`).join('') +
    `
      <div class="tw-s-item" data-act="create">
        <div><div class="tw-s-title">+ Crear nuevo paciente</div><div class="tw-s-meta">Agregar manualmente.</div></div>
      </div>`;
  showSuggest(); bindSuggestHandlers(q, result);
}
function bindSuggestHandlers(q, result){
  if (!UI.pacSuggest) return;
  UI.pacSuggest.querySelectorAll('.tw-s-item').forEach(el => {
    el.addEventListener('click', async () => {
      const act = el.getAttribute('data-act');
      if (act === 'select'){
        const id = el.getAttribute('data-id');
        const p = result.find(r => String(r.id) === id);
        if (p) selectPaciente(p);
      } else if (act === 'create'){
        openPacienteModal();
      }
    });
  });
}
function selectPaciente(p){
  pacienteSeleccionado = {
    id: p.id, nombre: p.nombre, apellido: p.apellido,
    dni: p.dni, telefono: p.telefono || '', obra_social_id: p.obra_social_id || null,
  };
  if (UI.pacChipText) UI.pacChipText.textContent = `${p.apellido}, ${p.nombre} · DNI ${p.dni}`;
  if (UI.pacChip) UI.pacChip.style.display = 'flex';
  hideSuggest();
  enforceTipoTurnoByPaciente(p.id);
  if (UI.modal?.style.display === 'flex') refreshModalTitle();
}
async function enforceTipoTurnoByPaciente(pacienteId){
  const optNueva = UI.tipoTurno?.querySelector('option[value="nueva_consulta"]');
  if (!optNueva) return;
  if (!pacienteId){ optNueva.disabled = false; return; }
  const { count } = await supabase.from('turnos').select('id', { count:'exact', head:true }).eq('paciente_id', pacienteId);
  if ((count ?? 0) > 0){
    optNueva.disabled = true;
    if (UI.tipoTurno.value === 'nueva_consulta') UI.tipoTurno.value = 'recurrente';
  } else {
    optNueva.disabled = false;
  }
}

// ---------------------------
/* Fetch agendas/turnos (multi-prof) */
// ---------------------------
async function fetchAgendaYTurnosMulti(pids, y, m){
  const last  = new Date(y, m+1, 0);
  const start = toISODate(y, m, 1);
  const end   = toISODate(y, m, last.getDate());

  if (!Array.isArray(pids) || !pids.length) return { agenda:[], turnos:[] };

  const profIds = pids.map(String);

  const [agendaRes, turnosRes] = await Promise.all([
    supabase.from('agenda')
      .select('id, fecha, hora_inicio, hora_fin, profesional_id')
      .eq('centro_id', currentCentroId)
      .in('profesional_id', profIds)
      .gte('fecha', start).lte('fecha', end)
      .order('fecha', { ascending:true }),
    supabase.from('turnos')
      .select('id, fecha, hora_inicio, hora_fin, estado, paciente_id, obra_social_id, agenda_id, centro_id, profesional_id, copago, pacientes(id, apellido, nombre, dni, telefono)')
      .eq('centro_id', currentCentroId)
      .in('profesional_id', profIds)
      .gte('fecha', start).lte('fecha', end)
      .order('hora_inicio', { ascending:true }),
  ]);

  return { agenda: agendaRes.data || [], turnos: turnosRes.data || [] };
}

function generarSlotsDeProfesional(agendaDiaDeProf, turnosDiaDeProf, tipo, excludeId, profId){
  const dur = Number(duracionCfg[tipo] || 15);
  if (!dur || dur <= 0) return [];
  const vivos = (turnosDiaDeProf || []).filter(t => ((t.estado||'').toLowerCase() !== 'cancelado') && t.id !== excludeId);

  const out = [];
  for (const bloq of agendaDiaDeProf || []){
    const bStart = toHM(bloq.hora_inicio), bEnd = toHM(bloq.hora_fin);
    let t = bStart;
    while (addMinutes(t, dur) <= bEnd){
      const start = t, end = addMinutes(t, dur);
      const oc = vivos.find(tr => overlaps(start, end, toHM(tr.hora_inicio), toHM(tr.hora_fin)));
      const turnoDur = oc ? minutesDiff(toHM(oc.hora_inicio), toHM(oc.hora_fin)) : null;
      out.push({ start, end, agenda_id: bloq.id, disponible: !oc, turno: oc || null, turno_duracion: turnoDur, profId });
      t = end;
    }
  }
  return out;
}

// ---------------------------
/* Calendario (mes) */
// ---------------------------
function renderDow(){
  if (UI.calDow) UI.calDow.innerHTML = DOW.map(d => `<div>${d}</div>`).join('');
}

async function renderCalendar(){
  if (!UI.status || !UI.calGrid || !UI.calTitle) return;

  if (!currentCentroId){
    UI.status.textContent = 'Seleccioná un centro en la barra lateral para ver turnos.';
    UI.calGrid.innerHTML = ''; UI.calTitle.textContent = ''; return;
  }
  if (!selectedProfesionales.length){
    UI.status.textContent = 'Seleccioná al menos un profesional.';
    UI.calGrid.innerHTML = '';
    const first = new Date(view.y, view.m, 1);
    UI.calTitle.textContent = first.toLocaleString('es-AR', { month:'long', year:'numeric' });
    return;
  }

  UI.status.textContent = 'Cargando agenda...';

  const { agenda, turnos } = await fetchAgendaYTurnosMulti(selectedProfesionales, view.y, view.m);
  const gA = groupByFecha(agenda), gT = groupByFecha(turnos);
  const tipo = UI.tipoTurno?.value || 'recurrente';

  UI.calGrid.innerHTML = '';
  const first = new Date(view.y, view.m, 1);
  const last  = new Date(view.y, view.m+1, 0);
  UI.calTitle.textContent = first.toLocaleString('es-AR', { month:'long', year:'numeric' });

  const offset = nativeFirstDow(first);
  const total  = offset + last.getDate();
  const rows   = Math.ceil(total/7);
  let day = 1;

  for (let i=0; i<rows*7; i++){
    const cell = document.createElement('div');
    if (i < offset || day > last.getDate()){
      cell.className = 'tw-day empty';
      UI.calGrid.appendChild(cell);
      continue;
    }

    const iso = toISODate(view.y, view.m, day);
    const agendaDia = gA.get(iso) || [];
    const turnosDia = gT.get(iso) || [];

    // Agrupar por profesional
    const AByProf = groupBy(agendaDia, 'profesional_id');
    const TByProf = groupBy(turnosDia, 'profesional_id');

    let totalLibres = 0;
    selectedProfesionales.forEach(pid => {
      const slots = generarSlotsDeProfesional(AByProf.get(pid) || [], TByProf.get(pid) || [], tipo, null, pid);
      totalLibres += slots.filter(s => s.disponible).length;
    });

    let cls = 'tw-day';
    let badge = 'sin agenda';
    const hayAgenda = agendaDia.length > 0;

    if (!hayAgenda) {
      cls += ' empty';
    } else if (totalLibres > 0) {
      cls += ' free clickable';
      badge = `${totalLibres} libres`;
    } else {
      cls += ' busy clickable';
      badge = 'sin huecos';
    }

    cell.className = cls;
    cell.innerHTML = `<div class="num">${day}</div><div class="badge">${badge}</div>`;
    if (cls.includes('clickable')){
      cell.addEventListener('click', () => openDayModalMulti(iso, AByProf, TByProf));
    }
    UI.calGrid.appendChild(cell);
    day++;
  }

  UI.status.textContent = agenda.length ? '' : 'No hay agenda cargada para este mes.';
}

// ---------------------------
/* Modal día (multi-prof) */
// ---------------------------
function getProfLabelById(id){ return profNameById(id); }

function buildModalTitle(iso){
  const fecha = fmtDateLong(iso);
  const badge = pacienteSeleccionado
    ? `<span class="tw-ok-badge">Paciente: ${pacienteSeleccionado.apellido}, ${pacienteSeleccionado.nombre}${pacienteSeleccionado.dni ? ' · DNI '+pacienteSeleccionado.dni : ''}</span>`
    : '';
  return `Turnos del ${fecha}${badge ? ' ' + badge : ''}`;
}
function refreshModalTitle(){ if (modalDateISO && UI.modalTitle) UI.modalTitle.innerHTML = buildModalTitle(modalDateISO); }
function setSlotsDisabled(dis){ UI.slotsList?.querySelectorAll('.tw-icon-btn')?.forEach(b => b.disabled = dis); }

function renderSlotsGroup(slots, profId){
  // Banner reprogramación
  if (reprogramState && !UI.slotsList.querySelector('.tw-banner-rep')){
    const banner = document.createElement('div');
    banner.className = 'tw-banner-rep';
    banner.innerHTML = `
      <div>Reprogramando turno ${toHM(reprogramState.turno.hora_inicio)}–${toHM(reprogramState.turno.hora_fin)}. 
      Seleccioná nuevo horario (${reprogramState.durMin} min).</div>
      <button class="tw-linklike" id="tw-cancel-rep">Cancelar</button>`;
    UI.slotsList.appendChild(banner);
    banner.querySelector('#tw-cancel-rep').addEventListener('click', () => { reprogramState = null; refreshDayModal(); });
  }

  // Encabezado por profesional
  const head = document.createElement('div');
  head.style = 'padding:8px 14px;font-weight:700;color:#4b3a78;border-top:1px solid #e8e2f2;background:#f8f6ff';
  head.textContent = getProfLabelById(profId);
  UI.slotsList.appendChild(head);

  const ahora = new Date();
  const hoyISO = dateToISO(ahora);
  const ahoraHM = `${pad(ahora.getHours())}:${pad(ahora.getMinutes())}`;

  const filtered = slots.filter(s => {
    if (!modalDateISO) return true;
    if (modalDateISO > hoyISO) return true;
    if (modalDateISO < hoyISO) return false;
    return s.start > ahoraHM;
  });

  if (!filtered.length){
    const empty = document.createElement('div');
    empty.style = 'color:#777;padding:10px 14px';
    empty.textContent = 'No hay horarios disponibles.';
    UI.slotsList.appendChild(empty);
    return;
  }

  const canCancel   = roleAllows('cancelar', userRole);      // AMP / Médico
  const canRepro    = roleAllows('atender', userRole);       // usamos "atender" como proxy de privilegio completo

  filtered.forEach(slot => {
    const wrap = document.createElement('div');
    wrap.style = 'display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e8e2f2;padding:10px 18px;min-height:44px;font-size:15px;';
    if (slot.turno) wrap.style.background = '#eae6f7';

    const hora = document.createElement('span');
    hora.textContent = `${toHM(slot.start)} - ${toHM(slot.end)}`;
    hora.style = 'font-weight:500;min-width:110px;margin-right:16px;';

    const meta = document.createElement('span');
    meta.style = 'color:#6b6480;font-style:italic;margin-right:auto;margin-left:10px;min-width:140px;white-space:nowrap;';

    const btns = document.createElement('div');
    btns.style = 'display:flex;gap:8px;';

    if (slot.turno){
      const p = slot.turno.pacientes;
      const osName = (slot.turno.obra_social_id && obrasSocialesById.get(String(slot.turno.obra_social_id))?.obra_social) || 'Particular';
      meta.textContent = p ? `${p.apellido}, ${p.nombre} · DNI ${p.dni} · ${osName}` : `Ocupado · ${osName}`;

      const mkBtn = (txt, title) => {
        const b = document.createElement('button');
        b.className = 'tw-icon-btn';
        b.textContent = txt; b.title = title;
        b.style = 'background:#7b5da7;color:#fff;border:none;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:1em;';
        return b;
      };

      if (canCancel){
        const btnDel = mkBtn('🗑️', 'Eliminar turno');
        btnDel.onclick = () => cancelarTurno(slot.turno);
        btns.appendChild(btnDel);
      }

      if (canRepro){
        const durMin = reprogramState?.durMin || slot.turno_duracion || minutesDiff(toHM(slot.turno.hora_inicio), toHM(slot.turno.hora_fin));
        const btnRep = mkBtn('↻', 'Reprogramar');
        btnRep.onclick = () => { reprogramState = { turno: slot.turno, durMin }; refreshDayModal(); };
        btns.appendChild(btnRep);
      }
    } else {
      const btnAdd = document.createElement('button');
      btnAdd.className = 'tw-icon-btn';
      btnAdd.textContent = '+';
      btnAdd.title = 'Reservar turno';
      btnAdd.style = 'background:#7b5da7;color:#fff;border:none;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:1em;';
      btnAdd.onclick = () => (reprogramState ? confirmReprogram(slot) : tryAgendar(slot));
      // Si estoy reprogramando y el slot no es del mismo profesional, bloquear
      if (reprogramState && String(reprogramState.turno.profesional_id) !== String(slot.profId)) {
        btnAdd.disabled = true; btnAdd.title = 'Solo podés reprogramar con el mismo profesional';
      }
      btns.appendChild(btnAdd);
    }

    wrap.appendChild(hora);
    wrap.appendChild(meta);
    wrap.appendChild(btns);
    UI.slotsList.appendChild(wrap);
  });
}

async function tryAgendar(slot){
  if (bookingBusy) return;
  bookingBusy = true;
  setSlotsDisabled(true);

  try {
    // Validaciones
    if (!pacienteSeleccionado){ alert('Seleccioná un paciente primero.'); return; }
    if (!isValidHourRange(slot.start, slot.end)){ alert('Rango horario inválido.'); return; }
    if (!currentCentroId || !modalDateISO || !slot?.profId){ alert('Falta centro/profesional/fecha.'); return; }

    // Trazabilidad (quién otorga el turno)
    const asignadoPor = getCurrentUserTag(); // puede ser null

    // OS / copago (para DB y para mensaje)
    let obraSocialId  = pacienteSeleccionado.obra_social_id || null;
    let osNombre      = obraSocialId ? (obrasSocialesById.get(String(obraSocialId))?.obra_social || null) : null;
    let copagoElegido = null;

    // Cupo OS
    if (obraSocialId){
      const ESTADOS_VIGENTES = ['asignado','confirmado','atendido'];
      const cupo = await getCupoObraSocialMensual(obraSocialId, slot.profId, modalDateISO, ESTADOS_VIGENTES);

      if (!cupo.disponible){
        copagoElegido = (cupo.valor_copago != null)
          ? Number(cupo.valor_copago)
          : await getCopagoParticular(currentCentroId, slot.profId, modalDateISO);

        abrirModalCupoAgotado(copagoElegido);
        const res = await new Promise(resolve => {
          const A = document.getElementById('modal-cupo-aceptar');
          const C = document.getElementById('modal-cupo-cancelar');
          if (A) A.onclick = () => { cerrarModalCupoAgotado(); resolve('aceptar'); };
          if (C) C.onclick = () => { cerrarModalCupoAgotado(); resolve('cancelar'); };
        });
        if (res !== 'aceptar') return;

        // Pasa a particular
        obraSocialId = null;
        osNombre     = null;
      }
    }

    // Copago final (solo particular)
    const copagoFinal = obraSocialId == null
      ? (copagoElegido ?? await getCopagoParticular(currentCentroId, slot.profId, modalDateISO))
      : null;

    // INSERT
    const payload = {
      agenda_id:       slot.agenda_id || null,
      centro_id:       currentCentroId,
      profesional_id:  slot.profId,
      paciente_id:     pacienteSeleccionado.id,
      fecha:           modalDateISO,
      hora_inicio:     slot.start,
      hora_fin:        slot.end,
      estado:          'asignado',
      notas:           UI.tipoTurno?.value === 'sobreturno' ? 'Sobreturno' : null,
      obra_social_id:  obraSocialId,
      copago:          copagoFinal,
      asignado_por:    asignadoPor,
    };

    const { error } = await supabase.from('turnos').insert([payload]);
    if (error){ alert(error.message || 'No se pudo reservar el turno.'); return; }

    // Abrir modal OK (usa SIEMPRE la misma openOkModal global)
    openOkModal({
      pac:       pacienteSeleccionado,
      fechaISO:  modalDateISO,
      start:     slot.start,
      end:       slot.end,
      profLabel: profNameById(slot.profId),
      osNombre,
      copago:    copagoFinal,
    });

  } finally {
    bookingBusy = false;
    setSlotsDisabled(false);
    await refreshDayModal();
    await renderCalendar();
    refreshModalTitle();
  }
}




async function openDayModalMulti(isoDate, AByProf, TByProf){
  if (!UI.modal) return;
  reprogramState = reprogramState || null; // mantener si estaba activo
  modalDateISO = isoDate;
  UI.modalTitle.innerHTML = buildModalTitle(isoDate);
  UI.modalDateInput.value = isoDate;
  UI.modal.style.display = 'flex';

  const tipo = UI.tipoTurno?.value || 'recurrente';
  const exclude = reprogramState?.turno.id || null;

  UI.slotsList.innerHTML = '';

  // Render por profesional seleccionado (en orden visible)
  selectedProfesionales.forEach(pid => {
    const slots = generarSlotsDeProfesional(AByProf.get(pid) || [], TByProf.get(pid) || [], tipo, exclude, pid);
    renderSlotsGroup(slots, pid);
  });

  await renderMiniCalFor(isoDate);
}

async function refreshDayModal(){
  if (!modalDateISO || !currentCentroId || !selectedProfesionales.length) return;

  const profIds = selectedProfesionales.map(String);

  const [{ data: agendaDia }, { data: turnosDiaRaw }] = await Promise.all([
    supabase.from('agenda')
      .select('id,fecha,hora_inicio,hora_fin,profesional_id')
      .eq('centro_id', currentCentroId)
      .eq('fecha', modalDateISO)
      .in('profesional_id', profIds)
      .order('hora_inicio',{ascending:true}),
    supabase.from('turnos')
      .select('id,fecha,hora_inicio,hora_fin,estado,paciente_id,obra_social_id,agenda_id,profesional_id,pacientes(id,apellido,nombre,dni,telefono)')
      .eq('centro_id', currentCentroId)
      .eq('fecha', modalDateISO)
      .in('profesional_id', profIds)
      .order('hora_inicio',{ascending:true}),
  ]);

  const AByProf = groupBy(agendaDia||[], 'profesional_id');
  const TByProf = groupBy(turnosDiaRaw||[], 'profesional_id');

  UI.slotsList.innerHTML = '';
  const tipo = UI.tipoTurno?.value || 'recurrente';
  const exclude = reprogramState?.turno.id || null;

  selectedProfesionales.forEach(pid => {
    const slots = generarSlotsDeProfesional(AByProf.get(pid) || [], TByProf.get(pid) || [], tipo, exclude, pid);
    renderSlotsGroup(slots, pid);
  });
}

// ---------------------------
/* Mini calendario (modal) */
// ---------------------------
async function renderMiniCalFor(iso){
  if (!UI.miniCal) return;
  UI.miniCal.innerHTML = '';

  const d = new Date(iso + 'T00:00:00');
  const y = d.getFullYear(), m = d.getMonth();

  const { agenda, turnos } = await fetchAgendaYTurnosMulti(selectedProfesionales, y, m);
  const gA = groupByFecha(agenda), gT = groupByFecha(turnos);
  const first = new Date(y, m, 1), last = new Date(y, m+1, 0);
  const offset = nativeFirstDow(first);
  const total  = offset + last.getDate();
  const rows   = Math.ceil(total/7);
  const todayISO = dateToISO(new Date());
  let day = 1;

  for (let i=0;i<rows*7;i++){
    if (i < offset || day > last.getDate()){
      const dot = document.createElement('div');
      dot.className = 'dot none';
      UI.miniCal.appendChild(dot);
      continue;
    }
    const isoD = toISODate(y, m, day);
    const agendaDia = gA.get(isoD) || [];
    const turnosDia = gT.get(isoD) || [];

    const AByProf = groupBy(agendaDia, 'profesional_id');
    const TByProf = groupBy(turnosDia, 'profesional_id');

    const tipo = UI.tipoTurno?.value || 'recurrente';
    let libresTotal = 0;
    selectedProfesionales.forEach(pid => {
      const prev = generarSlotsDeProfesional(AByProf.get(pid)||[], TByProf.get(pid)||[], tipo, null, pid);
      libresTotal += prev.filter(s=>s.disponible).length;
    });

    const dot = document.createElement('div');
    dot.className = 'dot';
    if (!agendaDia.length) dot.classList.add('none');
    else if (libresTotal > 0) { dot.classList.add('free','clickable'); dot.style.outline = '2px solid #0a7d38'; }
    else dot.classList.add('busy','clickable');

    if (isoD === todayISO) dot.classList.add('today');
    if (isoD === modalDateISO) dot.classList.add('selected');
    if (dot.classList.contains('clickable')) dot.addEventListener('click', () => loadModalDate(isoD));

    UI.miniCal.appendChild(dot);
    day++;
  }
}
async function loadModalDate(newISO){
  modalDateISO = newISO;
  if (UI.modalDateInput) UI.modalDateInput.value = newISO;
  if (UI.modalTitle) UI.modalTitle.innerHTML = buildModalTitle(newISO);
  await refreshDayModal();
  await renderMiniCalFor(newISO);
}

// ---------------------------
/* Reserva / Reprograma / Cancela */
// ---------------------------
function abrirModalCupoAgotado(copago){
  const el = document.getElementById('modal-cupo-agotado');
  if (!el) return;
  const v = document.getElementById('modal-cupo-copago');
  if (v) v.textContent = `$${copago}`;
  el.style.display = 'flex';
}
function cerrarModalCupoAgotado(){
  const el = document.getElementById('modal-cupo-agotado');
  if (el) el.style.display = 'none';
}
async function getCopagoParticular(){ return 1000; }




    // Modal de OK + link de WhatsApp (requiere que openOkModal acepte osNombre y copago)
function openOkModal({ pac, fechaISO, start, end, profLabel, osNombre = null, copago = null }){
  if (!UI.okBackdrop) return;

  // Info visible en el modal (opcional)
  UI.okTitle.textContent     = 'Turno reservado';
  UI.okPaciente.textContent  = `${pac.apellido}, ${pac.nombre}`;
  UI.okDni.textContent       = pac.dni || '';
  UI.okFechaHora.textContent = `${fmtDateLong(fechaISO)} · ${start}–${end}`;
  UI.okProf.textContent      = profLabel || '';
  UI.okCentro.textContent    = currentCentroNombre || '';
  UI.okDir.textContent       = currentCentroDireccion || '';

  // Mensaje de WhatsApp con OS o Copago
  const waPhone = normalizePhoneForWA(pac.telefono);
  const waText  = buildWA({
    pac,
    fechaISO,
    start,
    end,
    prof:   profLabel,
    centro: currentCentroNombre,
    dir:    currentCentroDireccion,
    osNombre,
    copago,
  });

  UI.okWa.href = waPhone
    ? `https://wa.me/${waPhone}?text=${encodeURIComponent(waText)}`
    : `https://wa.me/?text=${encodeURIComponent(waText)}`;

  UI.okMsg.textContent = '';
  UI.okBackdrop.style.display = 'flex';
}






async function confirmReprogram(slot){
  if (!reprogramState || reprogramBusy) return;
  reprogramBusy = true;
  setSlotsDisabled(true);

  try{
    const t = reprogramState.turno;

    if (!isValidHourRange(slot.start, slot.end)){
      alert('Rango horario inválido.');
      return;
    }

    // mismo profesional
    const profId = t.profesional_id;
    if (String(profId) !== String(slot.profId)){
      alert('La reprogramación debe ser con el mismo profesional.');
      return;
    }
    if (!currentCentroId || !modalDateISO){
      alert('Faltan datos.');
      return;
    }

    // Trazabilidad
    const asignadoPor = getCurrentUserTag();

    const nuevoTurno = {
      agenda_id:            slot.agenda_id || null,
      centro_id:            currentCentroId,
      profesional_id:       profId,
      paciente_id:          t.paciente_id,
      fecha:                modalDateISO,
      hora_inicio:          slot.start,
      hora_fin:             slot.end,
      estado:               t.estado || 'asignado',
      notas:                t.notas || null,
      obra_social_id:       t.obra_social_id ?? null,
      copago:               t.obra_social_id == null ? (t.copago ?? null) : null,
      reprogramado_desde:   `${t.fecha} ${toHM(t.hora_inicio)}-${toHM(t.hora_fin)}`,
      asignado_por:         asignadoPor,
    };

    const { error: eIns } = await supabase.from('turnos').insert([nuevoTurno]);
    if (eIns){ alert(eIns.message || 'No se pudo reprogramar.'); return; }

    // Borrar original
    await supabase.from('turnos').delete().eq('id', t.id);

    // Datos para modal/WA
    const pac = t.pacientes
      ? { id:t.pacientes.id, nombre:t.pacientes.nombre, apellido:t.pacientes.apellido, dni:t.pacientes.dni, telefono:t.pacientes.telefono }
      : pacienteSeleccionado;

    const osNombre    = t.obra_social_id ? (obrasSocialesById.get(String(t.obra_social_id))?.obra_social || null) : null;
    const copagoFinal = t.obra_social_id == null ? (t.copago ?? null) : null;

    if (pac){
      openOkModal({
        pac,
        fechaISO:  modalDateISO,
        start:     slot.start,
        end:       slot.end,
        profLabel: profNameById(profId),
        osNombre,
        copago:    copagoFinal,
      });
    }

    reprogramState = null;

  } finally {
    reprogramBusy = false;
    setSlotsDisabled(false);
    await refreshDayModal();
    await renderCalendar();
  }
}


async function cancelarTurno(t){
  if (!roleAllows('cancelar', userRole)) { alert('No tenés permisos para anular.'); return; }
  if (!confirm('¿Anular este turno?')) return;
  const { error } = await supabase.from('turnos').delete().eq('id', t.id);
  if (error) alert(error.message || 'No se pudo cancelar el turno.');
  else if (reprogramState?.turno.id === t.id) reprogramState = null;
  await refreshDayModal();
  await renderCalendar();
}

// ---------------------------
/* Modal OK */
// ---------------------------
// openOkModal.js
// Única función para abrir el modal OK y construir el link de WhatsApp
// (incluye buildWA y normalizePhoneForWA para que sea standalone).

/**
 * @typedef {Object} OkModalCtx
 * @property {{ okBackdrop:HTMLElement, okTitle:HTMLElement, okPaciente:HTMLElement, okDni:HTMLElement, okFechaHora:HTMLElement, okProf:HTMLElement, okCentro:HTMLElement, okDir:HTMLElement, okWa:HTMLAnchorElement, okMsg:HTMLElement }} UI
 * @property {string} currentCentroNombre
 * @property {string} currentCentroDireccion
 */

/** Formatea fecha larga con capitalización tipo "Martes 16 de Septiembre de 2025" */
function fmtDateLongNice(iso){
  const raw = new Date(iso + 'T00:00:00').toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).replace(',', '');
  const stop = new Set(['de','del','la','el','los','las','y']);
  return raw.toLowerCase().split(' ').map((w,i)=> (i===0||!stop.has(w)) ? (w[0].toUpperCase()+w.slice(1)) : w).join(' ');
}



/**

/**
 * Abre el modal OK y setea el link de WhatsApp.
 * @param {{ pac:any, fechaISO:string, start:string, end:string, profLabel:string, osNombre?:string|null, copago?:number|null }} args
 * @param {OkModalCtx} ctx
 */

// ---------------------------
/* Listeners */
// ---------------------------
function attachHandlers(){
  // Rol classes (como en Inicio)
  applyRoleClasses(userRole);

  // Typeahead paciente
  UI.pacInput?.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    const q = UI.pacInput.value.trim();
    if (!q) { hideSuggest(); return; }
    suggestTimer = setTimeout(() => fetchSuggestions(q), 180);
  });
  window.addEventListener('click', (e) => {
    if (UI.pacSuggest && !UI.pacSuggest.contains(e.target) && e.target !== UI.pacInput) hideSuggest();
  });
  UI.pacClear?.addEventListener('click', () => {
    pacienteSeleccionado = null;
    if (UI.pacChip) UI.pacChip.style.display = 'none';
    enforceTipoTurnoByPaciente(null);
    if (UI.modal?.style.display === 'flex') refreshModalTitle();
  });

  // Modal día
  UI.modalClose?.addEventListener('click', () => (UI.modal.style.display = 'none'));
  UI.modalPrevDay?.addEventListener('click', async () => {
    if (!modalDateISO) return;
    const d = new Date(modalDateISO + 'T00:00:00'); d.setDate(d.getDate()-1);
    await loadModalDate(dateToISO(d));
  });
  UI.modalNextDay?.addEventListener('click', async () => {
    if (!modalDateISO) return;
    const d = new Date(modalDateISO + 'T00:00:00'); d.setDate(d.getDate()+1);
    await loadModalDate(dateToISO(d));
  });
  UI.modalDateInput?.addEventListener('change', async () => {
    if (UI.modalDateInput.value) await loadModalDate(UI.modalDateInput.value);
  });

  window.addEventListener('click', (e) => {
    if (e.target === UI.modal) UI.modal.style.display = 'none';
    if (e.target === UI.okBackdrop) UI.okBackdrop.style.display = 'none';
  });

  // Calendario / filtros
  UI.tipoTurno?.addEventListener('change', async () => {
    await renderCalendar();
    if (UI.modal?.style.display === 'flex' && modalDateISO) {
      await refreshDayModal();
      await renderMiniCalFor(modalDateISO);
    }
  });

  UI.btnHoy?.addEventListener('click', async () => { view = todayInfo(); await renderCalendar(); });
  UI.prevMonth?.addEventListener('click', async () => { if (--view.m < 0){ view.m=11; view.y--; } await renderCalendar(); });
  UI.nextMonth?.addEventListener('click', async () => { if (++view.m > 11){ view.m=0; view.y++; } await renderCalendar(); });

  // OK modal
  UI.okClose?.addEventListener('click', () => (UI.okBackdrop.style.display = 'none'));
  UI.okCopy?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(UI.okWa.href); UI.okMsg.textContent = 'Link copiado ✔'; setTimeout(()=> UI.okMsg.textContent='', 2000); }
    catch { UI.okMsg.textContent = 'No se pudo copiar'; }
  });

  // Profesional select
  hookProfesionalSelect();

  // Obra social (si existen esos nodos)
  UI.npObra?.addEventListener('change', () => {
    const infoEl = UI.npObraInfo; if (!infoEl) return;
    const sel = obrasSocialesCache.find(o => o.obra_social === UI.npObra.value);
    if (!sel){ infoEl.textContent=''; return; }
    const cond = sel.condicion_copago ? `Condición: ${sel.condicion_copago}` : '';
    const val  = sel.valor_copago != null ? ` · Copago: ${sel.valor_copago}` : '';
    infoEl.textContent = cond || val ? cond + val : '';
  });
}

// ---------------------------
/* Init (desde dashboard) */
// ---------------------------
export async function initTurnos(){
  bindUI();
  attachHandlers();
  renderDow();

  // Centro desde sidebar
  await syncCentroFromStorage(true);

  if (!currentCentroId){
    UI.status && (UI.status.textContent = 'Seleccioná un centro en la barra lateral para ver turnos.');
    startCentroWatcher();
    return;
  }

  await loadObrasSociales();
  await loadProfesionales();         // igual que en Inicio (AMC -> multiple)
  await loadDuracionesForSelected();
  await renderCalendar();

  startCentroWatcher();              // sincroniza cambios del sidebar
}
