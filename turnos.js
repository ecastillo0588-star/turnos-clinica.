// turnos.js
import supabase from './supabaseClient.js';
import { isValidHourRange as _isValidHourRange } from './validators.js';
import { openPacienteModal, normalizePhoneForWA, buildWA } from './global.js';

/* ===================== *
 * Helpers
 * ===================== */
const isValidHourRange =
  typeof _isValidHourRange === 'function'
    ? _isValidHourRange
    : (s, e) => {
        const re = /^\d{2}:\d{2}$/;
        if (!re.test(s) || !re.test(e)) return false;
        return s < e;
      };

/* ===================== *
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
  miniCal: document.getElementById('turnos-mini-cal'),
};

/* ===================== *
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
let reprogramState = null;
let bookingBusy = false;
let reprogramBusy = false;

/* ===================== *
 * TODAS LAS FUNCIONES
 * (copiá acá el bloque entero que ya tenías en el script del HTML)
 * ===================== */

// 👉 helpers fecha
function todayInfo(){...}
function pad(n){...}
function toISODate(y,m,d){...}
function addMinutes(hhmm,mm){...}
// ... etc

// 👉 funciones de agenda / render / slots
async function fetchAgendaYTurnos(pid, y, m){...}
function generarSlots(...){...}
async function renderCalendar(){...}
function renderSlots(...){...}

// 👉 modales
async function openDayModal(...){...}
async function refreshDayModal(){...}
async function renderMiniCalFor(...){...}

// 👉 agendar, reprogramar, cancelar
async function tryAgendar(slot){...}
async function confirmReprogram(slot){...}
async function cancelarTurno(t){...}

// 👉 modal OK
function openOkModal(...){...}

// 👉 init
(async function init(){
  renderDow();
  if(!currentCentroId){
    UI.status.textContent='Seleccioná un centro para ver turnos.';
    return;
  }
  await ensureCentro();
  await loadObrasSociales();
  await loadProfesionales();
  await loadDuraciones(currentProfesional);
  await renderCalendar();
})();
