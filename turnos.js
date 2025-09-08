// turnos.js
/* =====================
 * Dependencias
 * ===================== */
import supabase from './supabaseClient.js';
import { isValidHourRange as _isValidHourRange } from './validators.js';
import { openPacienteModal } from './global.js';
console.log("🔍 Supabase en turnos.js:", supabase);

const isValidHourRange = typeof _isValidHourRange === 'function'
  ? _isValidHourRange
  : (s, e) => {
      // fallback simple HH:MM validation
      const re = /^\d{2}:\d{2}$/;
      if (!re.test(s) || !re.test(e)) return false;
      return s < e;
    };

/* =====================
 * UI refs
 * ===================== */
const UI = {
  centroSelect: document.getElementById('turnos-centro-select'),
  centroNombre: document.getElementById('turnos-centro-nombre'),
  profesionalSelect: document.getElementById('turnos-profesional-select'),
  tipoTurno: document.getElementById('turnos-tipo'),
  btnHoy: document.getElementById('turnos-btn-hoy'),
  pacInput: document.getElementById('turnos-paciente-input'),
  pacSuggest: document.getElementById('turnos-paciente-suggest'),
  pacChip: document.getElementById('turnos-paciente-chip'),
  pacChipText: document.getElementById('turnos-paciente-chip-text'),
  pacClear: document.getElementById('turnos-paciente-clear'),
  calDow: document.getElementById('turnos-cal-dow'),
  calGrid: document.getElementById('turnos-cal-grid'),
  calTitle: document.getElementById('turnos-cal-title'),
  status: document.getElementById('turnos-status'),
  prevMonth: document.getElementById('turnos-prev-month'),
  nextMonth: document.getElementById('turnos-next-month'),

  modal: document.getElementById('turnos-modal'),
  modalTitle: document.getElementById('turnos-modal-title'),
  modalClose: document.getElementById('turnos-modal-close'),
  modalDateInput: document.getElementById('turnos-modal-date'),
  modalPrevDay: document.getElementById('turnos-modal-prev-day'),
  modalNextDay: document.getElementById('turnos-modal-next-day'),
  slotsList: document.getElementById('turnos-slots-list'),

  okBackdrop: document.getElementById('turnos-modal-ok'),
  okClose: document.getElementById('ok-close'),
  okTitle: document.getElementById('ok-title'),
  okPaciente: document.getElementById('ok-paciente'),
  okDni: document.getElementById('ok-dni'),
  okFechaHora: document.getElementById('ok-fecha-hora'),
  okProf: document.getElementById('ok-prof'),
  okCentro: document.getElementById('ok-centro'),
  okDir: document.getElementById('ok-direccion'),
  okWa: document.getElementById('ok-wa-link'),
  okCopy: document.getElementById('ok-copy'),
  okMsg: document.getElementById('ok-msg'),
}; // ← esto faltaba



/* =====================
 * Estado
 * ===================== */
const safeLocalStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
})();

let currentCentroId = safeLocalStorage.getItem('centro_medico_id');
let currentCentroNombre = safeLocalStorage.getItem('centro_medico_nombre') || '';
let currentCentroDireccion = '';

const userRole = safeLocalStorage.getItem('user_role');
const loggedProfesionalId = safeLocalStorage.getItem('profesional_id');

let view = todayInfo();
let currentProfesional = null;

let duracionCfg = { nueva_consulta: 15, recurrente: 15, sobreturno: 15 };
let modalDateISO = null;
let pacienteSeleccionado = null;
let obrasSocialesCache = [];
const obrasSocialesById = new Map();
let reprogramState = null; // { turno, durMin }
let bookingBusy = false;
let reprogramBusy = false;

/* =====================
 * Helpers Fecha / Formato
 * ===================== */
function todayInfo() {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
}
function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}
function toISODate(y, m, d) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}
function addMinutes(hhmm, mm) {
  const [h, m] = hhmm.split(':').map(Number);
  const base = new Date(2000, 0, 1, h, m);
  base.setMinutes(base.getMinutes() + mm);
  return `${pad(base.getHours())}:${pad(base.getMinutes())}`;
}
function groupByFecha(arr) {
  const map = new Map();
  for (const x of arr) {
    if (!map.has(x.fecha)) map.set(x.fecha, []);
    map.get(x.fecha).push(x);
  }
  return map;
}
function toHM(t) {
  return (t || '').substring(0, 5);
}
function overlaps(aS, aE, bS, bE) {
  return aS < bE && bS < aE;
}
function fmtDateLong(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
function minutesDiff(a, b) {
  const [h1, m1] = a.split(':').map(Number);
  const [h2, m2] = b.split(':').map(Number);
  return h2 * 60 + m2 - (h1 * 60 + m1);
}
function normalizePhoneForWA(raw) {
  if (!raw) return '';
  let p = String(raw).replace(/[^\d]/g, '');
  if (p.startsWith('0')) p = p.slice(1);
  if (!p.startsWith('54')) p = '549' + p;
  else if (p.startsWith('54') && !p.startsWith('549')) p = '549' + p.slice(2);
  return p;
}
function buildWA({ pac, fechaISO, start, end, prof, centro, dir }) {
  return `Hola ${pac.apellido}, ${pac.nombre}! Te confirmamos tu turno el ${fmtDateLong(
    fechaISO
  )} de ${start} a ${end} con ${prof} en ${centro} (${dir}). Si no podés asistir, por favor avisá. ¡Gracias!`;
}
function dateToISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
function nativeFirstDow(d) {
  const g = d.getDay();
  return g === 0 ? 6 : g - 1;
}
function getProfLabel() {
  return UI.profesionalSelect.options[UI.profesionalSelect.selectedIndex]?.textContent || 'Profesional';
}
function pacFromTurno(t) {
  const p = t?.pacientes || null;
  if (!p && pacienteSeleccionado) return pacienteSeleccionado;
  return p
    ? { id: p.id, nombre: p.nombre, apellido: p.apellido, dni: p.dni, telefono: p.telefono }
    : null;
}
function buildModalTitle(iso) {
  const fecha = fmtDateLong(iso);
  const badge = pacienteSeleccionado
    ? `<span class="tw-ok-badge">Paciente: ${pacienteSeleccionado.apellido}, ${pacienteSeleccionado.nombre}${
        pacienteSeleccionado.dni ? ' · DNI ' + pacienteSeleccionado.dni : ''
      }</span>`
    : '';
  return `Turnos del ${fecha}${badge ? ' ' + badge : ''}`;
}
function refreshModalTitle() {
  if (modalDateISO) UI.modalTitle.innerHTML = buildModalTitle(modalDateISO);
}
function setSlotsDisabled(disabled) {
  UI.slotsList.querySelectorAll('.tw-icon-btn').forEach((b) => {
    b.disabled = disabled;
  });
}

/* =====================
 * Centros / Profesionales
 * ===================== */
async function fetchCentroById(id) {
  const { data } = await supabase.from('centros_medicos').select('nombre,direccion').eq('id', id).single();
  return { nombre: data?.nombre || '', direccion: data?.direccion || '' };
}

async function getCentrosDeProfesional(pid) {
  const { data, error } = await supabase
    .from('profesional_centro')
    .select('centro_id,activo,centros_medicos(id,nombre)')
    .eq('profesional_id', pid)
    .eq('activo', true);
  if (error || !data) return [];
  return data.filter((r) => r.centros_medicos).map((r) => ({ id: r.centros_medicos.id, nombre: r.centros_medicos.nombre }));
}

async function ensureCentro() {
  // Mostrar como select siempre (solo cambia si sos asistente)
  UI.centroSelect.style.display = '';
  UI.centroNombre.style.display = 'none';

  // Buscar centros asociados al profesional logueado
  if (!loggedProfesionalId) {
    UI.centroSelect.innerHTML = '<option value="">Sin profesional asignado</option>';
    return;
  }

  const centros = await getCentrosDeProfesional(loggedProfesionalId);

  if (!centros.length) {
    UI.centroSelect.innerHTML = '<option value="">Sin centros vinculados</option>';
    return;
  }

  // Armar las opciones del dropdown
  UI.centroSelect.innerHTML = centros
    .map((c) => `<option value="${c.id}">${c.nombre}</option>`)
    .join('');

  // Seleccionar el centro actual si está guardado
  if (currentCentroId && centros.some((c) => String(c.id) === String(currentCentroId))) {
    UI.centroSelect.value = currentCentroId;
  } else {
    currentCentroId = centros[0].id;
    UI.centroSelect.value = currentCentroId;
  }

  // Guardar nombre y dirección
  const c = await fetchCentroById(currentCentroId);
  currentCentroNombre = c.nombre || UI.centroSelect.options[UI.centroSelect.selectedIndex]?.textContent || '';
  currentCentroDireccion = c.direccion || '';

  // Guardar en localStorage para la próxima
  safeLocalStorage.setItem('centro_medico_id', currentCentroId);
  safeLocalStorage.setItem('centro_medico_nombre', currentCentroNombre);

  // Escuchar cambios
  UI.centroSelect.addEventListener('change', async () => {
    currentCentroId = UI.centroSelect.value;
    const c2 = await fetchCentroById(currentCentroId);
    currentCentroNombre = c2.nombre || UI.centroSelect.options[UI.centroSelect.selectedIndex]?.textContent || '';
    currentCentroDireccion = c2.direccion || '';

    safeLocalStorage.setItem('centro_medico_id', currentCentroId);
    safeLocalStorage.setItem('centro_medico_nombre', currentCentroNombre);

    await loadProfesionales();
    await loadDuraciones(currentProfesional);
    await renderCalendar();

    if (UI.modal.style.display === 'flex') await renderMiniCalFor(modalDateISO);
  });
}


async function loadProfesionales() {
  const sel = UI.profesionalSelect;

  // Caso: médico logueado (solo su agenda)
  if (userRole === 'medico' && loggedProfesionalId) {
    let label = null;
    try {
      const { data } = await supabase
        .from('profesionales')
        .select('id,nombre,apellido')
        .eq('id', loggedProfesionalId)
        .single();

      if (data) {
        label = [data.apellido, data.nombre].filter(Boolean).join(', ') || data.nombre || data.apellido;
      }
    } catch (_) {}

    if (!label) {
      label =
        safeLocalStorage.getItem('user_name') ||
        safeLocalStorage.getItem('email') ||
        'Mi agenda';
    }

    sel.innerHTML = `<option value="${loggedProfesionalId}">${label}</option>`;
    sel.disabled = true;
    currentProfesional = loggedProfesionalId;
    return;
  }

  // Caso: asistente/admin -> lista de profesionales del centro
  sel.disabled = false;

  const { data: map } = await supabase
    .from('profesional_centro')
    .select('profesional_id')
    .eq('centro_id', currentCentroId)
    .eq('activo', true);

  const ids = [...new Set((map || []).map((r) => r.profesional_id).filter(Boolean))];

  if (!ids.length) {
    sel.innerHTML = '<option value="">Sin profesionales</option>';
    currentProfesional = null;
    return;
  }

  const { data: profs } = await supabase
    .from('profesionales')
    .select('id,nombre,apellido')
    .in('id', ids)
    .order('apellido', { ascending: true });

  sel.innerHTML = (profs || [])
    .map((p) => {
      const nombre = [p.apellido, p.nombre].filter(Boolean).join(', ') || p.nombre || p.apellido || p.id;
      return `<option value="${p.id}">${nombre}</option>`;
    })
    .join('');

  currentProfesional = profs?.[0]?.id || null;
  if (currentProfesional) sel.value = currentProfesional;
}

async function loadDuraciones(pid) {
  // valores por defecto
  duracionCfg = {
    nueva_consulta: 15,
    recurrente: 15,
    sobreturno: 15,
  };

  if (!pid) return;

  const { data, error } = await supabase
    .from('config_duracion_turnos')
    .select('tipo_turno,minutos')
    .eq('profesional_id', pid)
    .eq('centro_id', currentCentroId);

  if (error) {
    console.warn('Error cargando duraciones:', error.message);
    return;
  }

  (data || []).forEach((r) => {
    if (r.tipo_turno && r.minutos) {
      duracionCfg[r.tipo_turno] = r.minutos;
    }
  });
}


/* =====================
 * Obras Sociales
 * ===================== */
async function loadObrasSociales() {
  const { data } = await supabase.from('obras_sociales').select('id,obra_social,condicion_copago,valor_copago').order('obra_social', { ascending: true });
  obrasSocialesCache = data || [];
  obrasSocialesById.clear();
  (obrasSocialesCache || []).forEach((o) => {
    obrasSocialesById.set(String(o.id), o);
  });
  if (UI.npObra) {
    UI.npObra.innerHTML =
      '<option value="">(Sin obra social)</option>' + obrasSocialesCache.map((o) => `<option value="${o.obra_social}">${o.obra_social}</option>`).join('');
  }
}

UI.npObra?.addEventListener('change', () => {
  const sel = obrasSocialesCache.find((o) => o.obra_social === UI.npObra.value);
  if (!sel) {
    UI.npObraInfo.textContent = '';
    return;
  }
  const cond = sel.condicion_copago ? `Condición: ${sel.condicion_copago}` : '';
  const val = sel.valor_copago != null ? ` · Copago: ${sel.valor_copago}` : '';
  UI.npObraInfo.textContent = cond || val ? cond + val : '';
});

/* =====================
 * Pacientes (typeahead)
 * ===================== */
let suggestTimer = null;
function hideSuggest() {
  UI.pacSuggest.style.display = 'none';
  UI.pacSuggest.innerHTML = '';
}
function showSuggest() {
  UI.pacSuggest.style.display = 'block';
}
UI.pacInput.addEventListener('input', () => {
  clearTimeout(suggestTimer);
  const q = UI.pacInput.value.trim();
  if (!q) {
    hideSuggest();
    return;
  }
  suggestTimer = setTimeout(() => fetchSuggestions(q), 180);
});
window.addEventListener('click', (e) => {
  if (!UI.pacSuggest.contains(e.target) && e.target !== UI.pacInput) {
    hideSuggest();
  }
});
async function fetchSuggestions(q) {
  let result = [];
  if (/^\d{6,}$/.test(q)) {
    const { data } = await supabase.from('pacientes').select('id,dni,apellido,nombre,telefono,email,obra_social_id').eq('dni', q).limit(10);
    result = data || [];
  } else {
    const parts = q.toLowerCase().split(/\s+/).filter(Boolean);
    let query = supabase.from('pacientes').select('id,dni,apellido,nombre,telefono,email,obra_social_id').eq('activo', true).limit(10).order('apellido', { ascending: true });
    if (parts[0]) query = query.ilike('apellido', `%${parts[0]}%`);
    if (parts[1]) query = query.ilike('nombre', `%${parts[1]}%`);
    const { data } = await query;
    result = data || [];
  }
  if (!result.length) {
    UI.pacSuggest.innerHTML = `
      <div class="tw-s-item" data-act="create">
        <div>
          <div class="tw-s-title">+ Crear nuevo paciente</div>
          <div class="tw-s-meta">No se encontraron coincidencias para “${q}”.</div>
        </div>
      </div>`;
    showSuggest();
    bindSuggestHandlers(q, []);
    return;
  }
  UI.pacSuggest.innerHTML =
    result
      .map(
        (p) => `
      <div class="tw-s-item" data-act="select" data-id="${p.id}">
        <div>
          <div class="tw-s-title">${p.apellido}, ${p.nombre}</div>
          <div class="tw-s-meta">DNI ${p.dni}${p.telefono ? ' · ' + p.telefono : ''}${p.email ? ' · ' + p.email : ''}</div>
        </div>
      </div>`
      )
      .join('') +
    `
      <div class="tw-s-item" data-act="create">
        <div>
          <div class="tw-s-title">+ Crear nuevo paciente</div>
          <div class="tw-s-meta">Agregar manualmente.</div>
        </div>
      </div>`;
  showSuggest();
  bindSuggestHandlers(q, result);
}

function bindSuggestHandlers(q, result) {
  UI.pacSuggest.querySelectorAll('.tw-s-item').forEach((el) => {
    el.addEventListener('click', async () => {
      const act = el.getAttribute('data-act');
      if (act === 'select') {
        const id = el.getAttribute('data-id');
        const p = result.find((r) => String(r.id) === id);
        if (p) selectPaciente(p);
      } else if (act === 'create') {
        openPacienteModal();  // para crear
      }
    });
  });
}

function selectPaciente(p) {
  pacienteSeleccionado = {
    id: p.id,
    nombre: p.nombre,
    apellido: p.apellido,
    dni: p.dni,
    telefono: p.telefono || '',
    obra_social_id: p.obra_social_id || null,
  };
  UI.pacChipText.textContent = `${p.apellido}, ${p.nombre} · DNI ${p.dni}`;
  UI.pacChip.style.display = 'flex';
  hideSuggest();
  enforceTipoTurnoByPaciente(p.id);
  if (UI.modal.style.display === 'flex') refreshModalTitle();
}

UI.pacClear.addEventListener('click', () => {
  pacienteSeleccionado = null;
  UI.pacChip.style.display = 'none';
  enforceTipoTurnoByPaciente(null);
  if (UI.modal.style.display === 'flex') refreshModalTitle();
});

async function enforceTipoTurnoByPaciente(pacienteId) {
  const optNueva = UI.tipoTurno.querySelector('option[value="nueva_consulta"]');
  if (!optNueva) return;
  if (!pacienteId) {
    optNueva.disabled = false;
    return;
  }
  const { count } = await supabase.from('turnos').select('id', { count: 'exact', head: true }).eq('paciente_id', pacienteId);
  if ((count ?? 0) > 0) {
    optNueva.disabled = true;
    if (UI.tipoTurno.value === 'nueva_consulta') UI.tipoTurno.value = 'recurrente';
  } else {
    optNueva.disabled = false;
  }
}


/* =====================
 * Agenda / Turnos
 * ===================== */
async function fetchAgendaYTurnos(pid, y, m) {
  const last = new Date(y, m + 1, 0);
  const start = toISODate(y, m, 1),
    end = toISODate(y, m, last.getDate());
  const [agendaRes, turnosRes] = await Promise.all([
    supabase.from('agenda').select('id, fecha, hora_inicio, hora_fin').eq('centro_id', currentCentroId).eq('profesional_id', pid).gte('fecha', start).lte('fecha', end).order('fecha', { ascending: true }),
    supabase
      .from('turnos')
      .select(
        'id, fecha, hora_inicio, hora_fin, estado, paciente_id, obra_social_id, agenda_id, centro_id, profesional_id, copago, pacientes(id, apellido, nombre, dni, telefono)'
      )
      .eq('centro_id', currentCentroId)
      .eq('profesional_id', pid)
      .gte('fecha', start)
      .lte('fecha', end)
      .order('hora_inicio', { ascending: true }),
  ]);
  return { agenda: agendaRes.data || [], turnos: turnosRes.data || [] };
}

function generarSlots(agendaDia, turnosDia, tipo, excludeId) {
  const dur = Number(duracionCfg[tipo] || 15);
  if (!dur || dur <= 0) return [];
  const out = [];
  const vivos = (turnosDia || []).filter((t) => ((t.estado || '').toLowerCase() !== 'cancelado') && t.id !== excludeId);
  for (const bloque of agendaDia || []) {
    const bStart = toHM(bloque.hora_inicio),
      bEnd = toHM(bloque.hora_fin);
    let t = bStart;
    while (addMinutes(t, dur) <= bEnd) {
      const start = t,
        end = addMinutes(t, dur);
      const oc = vivos.find((tr) => {
        const s = toHM(tr.hora_inicio),
          e = toHM(tr.hora_fin);
        return overlaps(start, end, s, e);
      });
      const turnoDur = oc ? minutesDiff(toHM(oc.hora_inicio), toHM(oc.hora_fin)) : null;
      out.push({ start, end, agenda_id: bloque.id, disponible: !oc, turno: oc || null, turno_duracion: turnoDur });
      t = end;
    }
  }
  return out;
}

/* =====================
 * Calendario
 * ===================== */
function renderDow() {
  UI.calDow.innerHTML = DOW.map((d) => `<div>${d}</div>`).join('');
}

async function renderCalendar() {
  if (!currentProfesional) {
    UI.status.textContent = 'No hay profesional seleccionado.';
    UI.calGrid.innerHTML = '';
    return;
  }
  UI.status.textContent = 'Cargando agenda...';
  const { agenda, turnos } = await fetchAgendaYTurnos(currentProfesional, view.y, view.m);
  const gA = groupByFecha(agenda),
    gT = groupByFecha(turnos);
  const tipo = UI.tipoTurno.value;
  UI.calGrid.innerHTML = '';
  const first = new Date(view.y, view.m, 1),
    last = new Date(view.y, view.m + 1, 0);
  UI.calTitle.textContent = first.toLocaleString('es-AR', { month: 'long', year: 'numeric' });
  const offset = nativeFirstDow(first);
  const total = offset + last.getDate();
  const rows = Math.ceil(total / 7);
  let day = 1;
  for (let i = 0; i < rows * 7; i++) {
    const cell = document.createElement('div');
    if (i < offset || day > last.getDate()) {
      cell.className = 'tw-day empty';
      UI.calGrid.appendChild(cell);
      continue;
    }
    const iso = toISODate(view.y, view.m, day);
    const agendaDia = gA.get(iso) || [];
    const turnosDia = gT.get(iso) || [];
    const preview = generarSlots(agendaDia, turnosDia, tipo, null);
    const libres = preview.filter((s) => s.disponible).length;
    let cls = 'tw-day';
    let badge = 'sin agenda';
    if (!agendaDia.length) {
      cls += ' empty';
    } else if (libres > 0) {
      cls += ' free clickable';
      badge = `${libres} libres`;
    } else {
      cls += ' busy clickable';
      badge = 'sin huecos';
    }
    cell.className = cls;
    cell.innerHTML = `<div class="num">${day}</div><div class="badge">${badge}</div>`;
    if (cls.includes('clickable')) {
      cell.addEventListener('click', () => openDayModal(iso, agendaDia, turnosDia, { preserveReprogram: !!reprogramState }));
    }
    UI.calGrid.appendChild(cell);
    day++;
  }
  UI.status.textContent = agenda.length ? '' : 'No hay agenda cargada para este mes.';
}

/* =====================
 * Render slots del día
 * ===================== */
function renderSlots(slots) {
  const ahora = new Date();
  const hoyISO = dateToISO(ahora);
  const ahoraHM = `${pad(ahora.getHours())}:${pad(ahora.getMinutes())}`;
  const filtroSlots = slots.filter((s) => {
    if (!modalDateISO) return true;
    if (modalDateISO > hoyISO) return true;
    if (modalDateISO < hoyISO) return false;
    return s.start > ahoraHM;
  });
  if (!filtroSlots.length) {
    UI.slotsList.innerHTML = '<div style="color:#888;padding:14px;text-align:center;">No hay horarios disponibles.</div>';
    return;
  }
  UI.slotsList.innerHTML = '';
  if (reprogramState) {
    const banner = document.createElement('div');
    banner.className = 'tw-banner-rep';
    banner.innerHTML = `
      <div>Reprogramando turno ${toHM(reprogramState.turno.hora_inicio)}–${toHM(reprogramState.turno.hora_fin)}. 
      Seleccioná nuevo horario (${reprogramState.durMin} min).</div>
      <button class="tw-linklike" id="tw-cancel-rep">Cancelar</button>`;
    UI.slotsList.appendChild(banner);
    banner.querySelector('#tw-cancel-rep').addEventListener('click', () => {
      reprogramState = null;
      refreshDayModal();
    });
  }
  filtroSlots.forEach((slot) => {
    const slotElem = document.createElement('div');
    slotElem.style =
      'display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e8e2f2;padding:10px 18px;min-height:44px;font-size:15px;transition:background 0.2s, opacity 0.2s;';
    if (slot.turno) slotElem.style.background = '#eae6f7';

    const horario = document.createElement('span');
    horario.textContent = `${toHM(slot.start)} - ${toHM(slot.end)}`;
    horario.style = 'font-weight:500;font-size:1em;min-width:110px;margin-right:16px;';

    const nombrePaciente = document.createElement('span');
    nombrePaciente.style =
      'color:#6b6480;font-size:1em;font-style:italic;margin-right:auto;margin-left:10px;min-width:140px;white-space:nowrap;';

    const btns = document.createElement('div');
    btns.style = 'display:flex;gap:8px;';

    if (slot.turno) {
      const p = slot.turno.pacientes;
      const osName = (slot.turno.obra_social_id && obrasSocialesById.get(String(slot.turno.obra_social_id))?.obra_social) || 'Particular';
      nombrePaciente.textContent = p ? `${p.apellido}, ${p.nombre} · DNI ${p.dni} · ${osName}` : `Ocupado · ${osName}`;

      const mkBtn = (txt, title) => {
        const b = document.createElement('button');
        b.className = 'tw-icon-btn';
        b.textContent = txt;
        b.title = title;
        b.style = 'background:#7b5da7;color:#fff;border:none;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:1em;';
        return b;
      };
      const btnBorrar = mkBtn('🗑️', 'Eliminar turno');
      btnBorrar.onclick = () => cancelarTurno(slot.turno);
      btns.appendChild(btnBorrar);

      const durMin =
        reprogramState?.durMin || slot.turno_duracion || minutesDiff(toHM(slot.turno.hora_inicio), toHM(slot.turno.hora_fin));
      const btnReprog = mkBtn('↻', 'Reprogramar');
      btnReprog.onclick = () => {
        reprogramState = { turno: slot.turno, durMin };
        refreshDayModal();
      };
      btns.appendChild(btnReprog);
    } else {
      const btnReservar = document.createElement('button');
      btnReservar.className = 'tw-icon-btn';
      btnReservar.textContent = '+';
      btnReservar.title = 'Reservar turno';
      btnReservar.style =
        'background:#7b5da7;color:#fff;border:none;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:1em;';
      btnReservar.onclick = () => (reprogramState ? confirmReprogram(slot) : tryAgendar(slot));
      btns.appendChild(btnReservar);
    }

    slotElem.appendChild(horario);
    slotElem.appendChild(nombrePaciente);
    slotElem.appendChild(btns);
    UI.slotsList.appendChild(slotElem);
  });
}

/* =====================
 * Modal día
 * ===================== */
async function openDayModal(isoDate, agendaDia, turnosDiaRaw, { preserveReprogram = false } = {}) {
  if (!preserveReprogram) reprogramState = null;
  modalDateISO = isoDate;
  UI.modalTitle.innerHTML = buildModalTitle(isoDate);
  UI.modalDateInput.value = isoDate;
  UI.modal.style.display = 'flex';
  const exclude = reprogramState?.turno.id || null;
  const slots = generarSlots(agendaDia, turnosDiaRaw, UI.tipoTurno.value, exclude);
  renderSlots(slots);
  await renderMiniCalFor(isoDate);
}

UI.modalClose.addEventListener('click', () => (UI.modal.style.display = 'none'));
window.addEventListener('click', (e) => {
  if (e.target === UI.modal) UI.modal.style.display = 'none';
  if (e.target === UI.okBackdrop) UI.okBackdrop.style.display = 'none';
  
});

async function refreshDayModal() {
  if (!modalDateISO) return;
  const { data: agendaDia } = await supabase
    .from('agenda')
    .select('id,fecha,hora_inicio,hora_fin')
    .eq('centro_id', currentCentroId)
    .eq('profesional_id', currentProfesional)
    .eq('fecha', modalDateISO)
    .order('hora_inicio', { ascending: true });
  const { data: turnosDiaRaw } = await supabase
    .from('turnos')
    .select('id,fecha,hora_inicio,hora_fin,estado,paciente_id,obra_social_id,agenda_id,pacientes(id,apellido,nombre,dni,telefono)')
    .eq('centro_id', currentCentroId)
    .eq('profesional_id', currentProfesional)
    .eq('fecha', modalDateISO)
    .order('hora_inicio', { ascending: true });
  const slots = generarSlots(agendaDia || [], turnosDiaRaw || [], UI.tipoTurno.value, reprogramState?.turno.id || null);
  renderSlots(slots);
}
/* =====================
 * Mini calendario del modal
 * ===================== */
async function renderMiniCalFor(iso) {
  if (!UI.miniCal) return;
  UI.miniCal.innerHTML = '';
  const d = new Date(iso + 'T00:00:00');
  const y = d.getFullYear(),
    m = d.getMonth();
  const { agenda, turnos } = await fetchAgendaYTurnos(currentProfesional, y, m);
  const gA = groupByFecha(agenda),
    gT = groupByFecha(turnos);
  const first = new Date(y, m, 1),
    last = new Date(y, m + 1, 0);
  const offset = nativeFirstDow(first);
  const total = offset + last.getDate();
  const rows = Math.ceil(total / 7);
  const todayISO = dateToISO(new Date());
  let day = 1;

  for (let i = 0; i < rows * 7; i++) {
    if (i < offset || day > last.getDate()) {
      const dot = document.createElement('div');
      dot.className = 'dot none';
      UI.miniCal.appendChild(dot);
      continue;
    }
    const isoD = toISODate(y, m, day);
    const agendaDia = gA.get(isoD) || [];
    const turnosDia = gT.get(isoD) || [];
    const preview = generarSlots(agendaDia, turnosDia, UI.tipoTurno.value, null);
    const libres = preview.filter((s) => s.disponible).length;

    const dot = document.createElement('div');
    dot.className = 'dot';
    if (!agendaDia.length) dot.classList.add('none');
    else if (libres > 0) {
      dot.classList.add('free', 'clickable');
      dot.style.outline = '2px solid #0a7d38'; // verde cuando hay turnos libres
    } else dot.classList.add('busy', 'clickable');

    if (isoD === todayISO) dot.classList.add('today');
    if (isoD === modalDateISO) dot.classList.add('selected');
    if (dot.classList.contains('clickable')) dot.addEventListener('click', () => loadModalDate(isoD));

    UI.miniCal.appendChild(dot);
    day++;
  }
}

async function loadModalDate(newISO) {
  modalDateISO = newISO;
  UI.modalDateInput.value = newISO;
  UI.modalTitle.innerHTML = buildModalTitle(newISO);
  await refreshDayModal();
  await renderMiniCalFor(newISO);
}

UI.modalPrevDay.addEventListener('click', async () => {
  if (!modalDateISO) return;
  const d = new Date(modalDateISO + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  await loadModalDate(dateToISO(d));
});
UI.modalNextDay.addEventListener('click', async () => {
  if (!modalDateISO) return;
  const d = new Date(modalDateISO + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  await loadModalDate(dateToISO(d));
});
UI.modalDateInput.addEventListener('change', async () => {
  if (UI.modalDateInput.value) {
    await loadModalDate(UI.modalDateInput.value);
  }
});

/* =====================
 * Reserva / Cupo / OK modal
 * ===================== */
function abrirModalCupoAgotado(copago) {
  document.getElementById('modal-cupo-copago').textContent = `$${copago}`;
  document.getElementById('modal-cupo-agotado').style.display = 'flex';
}
function cerrarModalCupoAgotado() {
  document.getElementById('modal-cupo-agotado').style.display = 'none';
}

async function getCupoObraSocial(obraSocialId, centroId, profesionalId, fechaISO) {
  const { data: turnos } = await supabase
    .from('turnos')
    .select('id')
    .eq('obra_social_id', obraSocialId)
    .eq('centro_id', centroId)
    .eq('profesional_id', profesionalId)
    .eq('fecha', fechaISO);
  return (turnos || []).length < 2; // cupo ficticio
}
async function getCopagoParticular() {
  return 1000;
}

async function tryAgendar(slot) {
  if (bookingBusy) return;
  bookingBusy = true;
  setSlotsDisabled(true);
  try {
    if (!pacienteSeleccionado) {
      alert('Seleccioná un paciente primero.');
      return;
    }
    if (!isValidHourRange(slot.start, slot.end)) {
      alert('Rango horario inválido.');
      return;
    }

    let cupoDisponible = true;
    let copagoParticular = 0;
    let obraSocialId = pacienteSeleccionado.obra_social_id || null;

    if (obraSocialId) {
      cupoDisponible = await getCupoObraSocial(obraSocialId, currentCentroId, currentProfesional, modalDateISO);
      if (!cupoDisponible) {
        copagoParticular = await getCopagoParticular(currentCentroId, currentProfesional, modalDateISO);
        abrirModalCupoAgotado(copagoParticular);
        const res = await new Promise((resolve) => {
          document.getElementById('modal-cupo-aceptar').onclick = () => {
            cerrarModalCupoAgotado();
            resolve('aceptar');
          };
          document.getElementById('modal-cupo-cancelar').onclick = () => {
            cerrarModalCupoAgotado();
            resolve('cancelar');
          };
        });
        if (res !== 'aceptar') return;
        obraSocialId = null;
      }
    }

    const payload = {
      agenda_id: slot.agenda_id || null,
      centro_id: currentCentroId,
      profesional_id: currentProfesional,
      paciente_id: pacienteSeleccionado.id,
      fecha: modalDateISO,
      hora_inicio: slot.start,
      hora_fin: slot.end,
      estado: 'asignado',
      notas: UI.tipoTurno.value === 'sobreturno' ? 'Sobreturno' : null,
      obra_social_id: obraSocialId,
      copago: obraSocialId === null ? copagoParticular : null,
    };
    const { data: inserted, error } = await supabase.from('turnos').insert([payload]).select('id').single();
    if (error) {
      alert(error.message || 'No se pudo reservar el turno.');
      return;
    }
    openOkModal({ pac: pacienteSeleccionado, fechaISO: modalDateISO, start: slot.start, end: slot.end, profLabel: getProfLabel() });
  } finally {
    bookingBusy = false;
    setSlotsDisabled(false);
    await refreshDayModal();
    await renderCalendar();
    refreshModalTitle();
  }
}

/* =====================
 * Reprogramar / Cancelar
 * ===================== */
async function confirmReprogram(slot) {
  if (!reprogramState || reprogramBusy) return;
  reprogramBusy = true;
  setSlotsDisabled(true);
  try {
    const t = reprogramState.turno;
    if (!isValidHourRange(slot.start, slot.end)) {
      alert('Rango horario inválido.');
      return;
    }
    const centroId = t.centro_id ?? currentCentroId;
    const profesionalId = t.profesional_id ?? currentProfesional;
    const pacienteId = t.paciente_id;
    if (!centroId || !profesionalId || !pacienteId || !modalDateISO) {
      alert('Faltan datos para reprogramar.');
      return;
    }
    const nuevoTurno = {
      agenda_id: slot.agenda_id || null,
      centro_id: centroId,
      profesional_id: profesionalId,
      paciente_id: pacienteId,
      fecha: modalDateISO,
      hora_inicio: slot.start,
      hora_fin: slot.end,
      estado: t.estado || 'asignado',
      notas: t.notas || null,
      obra_social_id: t.obra_social_id ?? null,
      copago: t.obra_social_id == null ? t.copago ?? null : null,
      reprogramado_desde: `${t.fecha} ${toHM(t.hora_inicio)}-${toHM(t.hora_fin)}`,
    };
    const { error: errorInsert } = await supabase.from('turnos').insert([nuevoTurno]);
    if (errorInsert) {
      alert(errorInsert.message || 'No se pudo reprogramar.');
      return;
    }
    await supabase.from('turnos').delete().eq('id', t.id);
    const pac = pacFromTurno(t);
    if (pac) openOkModal({ pac, fechaISO: modalDateISO, start: slot.start, end: slot.end, profLabel: getProfLabel() });
    reprogramState = null;
  } finally {
    reprogramBusy = false;
    setSlotsDisabled(false);
    await refreshDayModal();
    await renderCalendar();
  }
}

async function cancelarTurno(t) {
  if (!confirm('¿Anular este turno?')) return;
  const { error } = await supabase.from('turnos').delete().eq('id', t.id);
  if (error) alert(error.message || 'No se pudo cancelar el turno.');
  else if (reprogramState?.turno.id === t.id) reprogramState = null;
  await refreshDayModal();
  await renderCalendar();
}

/* =====================
 * Modal OK
 * ===================== */
function openOkModal({ pac, fechaISO, start, end, profLabel }) {
  UI.okTitle.textContent = 'Turno reservado';
  UI.okPaciente.textContent = `${pac.apellido}, ${pac.nombre}`;
  UI.okDni.textContent = pac.dni || '';
  UI.okFechaHora.textContent = `${fmtDateLong(fechaISO)} · ${start}–${end}`;
  UI.okProf.textContent = profLabel || '';
  UI.okCentro.textContent = currentCentroNombre || '';
  UI.okDir.textContent = currentCentroDireccion || '';
  const waPhone = normalizePhoneForWA(pac.telefono);
  const waText = buildWA({ pac, fechaISO, start, end, prof: profLabel, centro: currentCentroNombre, dir: currentCentroDireccion });
  const waLink = waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(waText)}` : `https://wa.me/?text=${encodeURIComponent(waText)}`;
  UI.okWa.href = waLink;
  UI.okMsg.textContent = '';
  UI.okBackdrop.style.display = 'flex';
}
UI.okClose.addEventListener('click', () => (UI.okBackdrop.style.display = 'none'));
UI.okCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(UI.okWa.href);
    UI.okMsg.textContent = 'Link copiado ✔';
    setTimeout(() => (UI.okMsg.textContent = ''), 2000);
  } catch {
    UI.okMsg.textContent = 'No se pudo copiar';
  }
});

/* =====================
 * Vencidos
 * ===================== */
async function marcarTurnosVencidos() {
  const now = new Date();
  const { data: turnos } = await supabase.from('turnos').select('id, fecha, hora_inicio, hora_fin, estado, paciente_id').eq('estado', 'asignado');
  for (const turno of turnos || []) {
    const finTurno = new Date(`${turno.fecha}T${toHM(turno.hora_fin)}:00`);
    finTurno.setHours(finTurno.getHours() + 1);
    if (now > finTurno) {
      await supabase.from('turnos').update({ estado: 'vencido' }).eq('id', turno.id);
    }
  }
}
// setInterval(marcarTurnosVencidos, 15 * 60 * 1000);

/* =====================
 * Eventos globales e Init
 * ===================== */
UI.tipoTurno.addEventListener('change', async () => {
  await renderCalendar();
  if (UI.modal.style.display === 'flex') {
    await refreshDayModal();
    await renderMiniCalFor(modalDateISO);
  }
});
UI.profesionalSelect.addEventListener('change', async () => {
  currentProfesional = UI.profesionalSelect.value || null;
  await loadDuraciones(currentProfesional);
  await renderCalendar();
  if (UI.modal.style.display === 'flex') {
    await refreshDayModal();
    await renderMiniCalFor(modalDateISO);
  }
});
UI.btnHoy.addEventListener('click', async () => {
  view = todayInfo();
  await renderCalendar();
});
UI.prevMonth.addEventListener('click', async () => {
  if (--view.m < 0) {
    view.m = 11;
    view.y--;
  }
  await renderCalendar();
});
UI.nextMonth.addEventListener('click', async () => {
  if (++view.m > 11) {
    view.m = 0;
    view.y++;
  }
  await renderCalendar();
});

// ✅ Esto lo dejás exportado para que lo llame el dashboard
export async function initTurnos() {
  renderDow();
  if (!currentCentroId) {
    UI.status.textContent = 'Seleccioná un centro para ver turnos.';
    return;
  }
  await ensureCentro();
  await loadObrasSociales();
  await loadProfesionales();
  await loadDuraciones(currentProfesional);
  await renderCalendar();
}

