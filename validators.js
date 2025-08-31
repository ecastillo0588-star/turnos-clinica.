// validators.js
// Helpers comunes para validaciones de formularios y horarios.
// No cambian tu lógica: solo centralizan funciones repetidas.

//
// --- Validaciones generales ---
//

/** Valida que un input requerido no esté vacío */
export function isRequired(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

/** Valida que fechaInicio <= fechaFin */
export function isValidDateRange(fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin) return false;
  return new Date(fechaInicio) <= new Date(fechaFin);
}

//
// --- Validaciones de horarios ---
//

/** Valida que una hora inicio sea < que una hora fin */
export function isValidHourRange(horaInicio, horaFin) {
  if (!horaInicio || !horaFin) return false;
  return horaInicio < horaFin;
}

/** 
 * Valida bloque de horario de mañana.
 * Restricción: fin <= 13:00
 */
export function isValidMorning(horaInicio, horaFin) {
  return isValidHourRange(horaInicio, horaFin) && horaFin <= "13:00";
}

/**
 * Valida bloque de horario de tarde.
 * Restricción: inicio >= 13:00
 */
export function isValidAfternoon(horaInicio, horaFin) {
  return isValidHourRange(horaInicio, horaFin) && horaInicio >= "13:00";
}
