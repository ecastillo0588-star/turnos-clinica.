// global.js

export function openPacienteModal(defaults = {}) {
  const modal = document.getElementById('turnos-modal-paciente');
  if (!modal) {
    console.warn('Modal de paciente no encontrado');
    return;
  }
  modal.style.display = 'flex';
  if (defaults.dni) {
    const dniField = document.getElementById('np-dni');
    if (dniField) dniField.value = defaults.dni;
  }
}

export function normalizePhoneForWA(raw) {
  if (!raw) return '';
  let p = String(raw).replace(/[^\d]/g, '');
  if (p.startsWith('0')) p = p.slice(1);
  if (!p.startsWith('54')) p = '549' + p;
  else if (p.startsWith('54') && !p.startsWith('549')) p = '549' + p.slice(2);
  return p;
}

export function buildWA({ pac, fechaISO, start, end, prof, centro, dir }) {
  return `Hola ${pac.apellido}, ${pac.nombre}! 
Te confirmamos tu turno el ${new Date(fechaISO).toLocaleDateString(
    'es-AR',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
  )} de ${start} a ${end} con ${prof} en ${centro} (${dir}). 
Si no podés asistir, por favor avisá. ¡Gracias!`;
}
