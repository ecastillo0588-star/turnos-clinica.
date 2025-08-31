// centrosService.js
// Servicio reutilizable para Centros Médicos y asociaciones con profesionales.
// NO cambia la lógica existente: solo centraliza las mismas consultas que ya usás.
// Importa la instancia única de Supabase para evitar duplicaciones.

import supabase from './supabaseClient.js';

/** -----------------------------
 *  CENTROS MÉDICOS (CRUD mínimo)
 *  -----------------------------
 */

/**
 * Lista centros activos (id, nombre) ordenados por nombre (↑).
 * Equivalente a los selects que hacés en varias pantallas.
 */
export async function getCentrosActivos() {
  const { data, error } = await supabase
    .from('centros_medicos')
    .select('id, nombre')
    .eq('activo', true)
    .order('nombre', { ascending: true });

  return { data, error };
}

/**
 * Crea un centro médico. (Mismo shape que venías insertando)
 * No asocia al profesional: para eso usá associateProfesionalACentro.
 */
export async function createCentro({ nombre, direccion, telefono, email, notas, activo = true }) {
  const { data, error } = await supabase
    .from('centros_medicos')
    .insert([{ nombre, direccion, telefono, email, notas, activo }])
    .select()
    .single();

  return { data, error };
}

/**
 * Actualiza un centro médico por id.
 * Pasa sólo los campos que quieras modificar.
 */
export async function updateCentro(id, { nombre, direccion, telefono, email, notas, activo }) {
  const fields = { nombre, direccion, telefono, email, notas, activo };
  // quita undefined para no pisar columnas involuntariamente
  Object.keys(fields).forEach(k => fields[k] === undefined && delete fields[k]);

  const { error } = await supabase
    .from('centros_medicos')
    .update(fields)
    .eq('id', id);

  return { error };
}

/** -------------------------------------------------
 *  ASOCIACIONES profesional_centro (link & unlink)
 *  -------------------------------------------------
 */

/**
 * Devuelve centros asociados ACTIVOS a un profesional.
 * Incluye datos del centro (id, nombre, etc.) tal como ya consumís.
 */
export async function getCentrosAsociados(profesionalId) {
  const { data, error } = await supabase
    .from('profesional_centro')
    .select('centro_id, centros_medicos(id, nombre, direccion, telefono, email, notas)')
    .eq('profesional_id', profesionalId)
    .eq('activo', true);

  return { data, error };
}

/**
 * Verifica si existe la vinculación profesional-centro (opcionalmente solo activas).
 */
export async function existsVinculacion(profesionalId, centroId, { onlyActive = true } = {}) {
  let q = supabase
    .from('profesional_centro')
    .select('*', { count: 'exact', head: true })
    .eq('profesional_id', profesionalId)
    .eq('centro_id', centroId);

  if (onlyActive) q = q.eq('activo', true);

  const { error, count } = await q;
  return { exists: !!count, error };
}

/**
 * Asocia un profesional a un centro. (Mismo insert que ya hacés)
 * Parámetros por defecto: activo=true, prioridad=1.
 */
export async function associateProfesionalACentro(profesionalId, centroId, { activo = true, prioridad = 1 } = {}) {
  const { error } = await supabase
    .from('profesional_centro')
    .insert({ profesional_id: profesionalId, centro_id: centroId, activo, prioridad });

  return { error };
}

/**
 * Desasocia un profesional de un centro marcando activo=false (tu flujo actual).
 */
export async function desasociarProfesionalDeCentro(profesionalId, centroId) {
  const { error } = await supabase
    .from('profesional_centro')
    .update({ activo: false })
    .eq('profesional_id', profesionalId)
    .eq('centro_id', centroId);

  return { error };
}

/**
 * Centros activos NO asociados al profesional (útil para el modal “asociarme a un centro existente”).
 */
export async function getCentrosDisponiblesParaAsociar(profesionalId) {
  // 1) Centros ya asociados (activos)
  const { data: asociados, error: eAsoc } = await supabase
    .from('profesional_centro')
    .select('centro_id')
    .eq('profesional_id', profesionalId)
    .eq('activo', true);

  if (eAsoc) return { data: null, error: eAsoc };

  const asociadosIds = (asociados || []).map(r => r.centro_id);

  // 2) Centros activos no incluidos en la lista anterior
  // Si no hay asociados, devolvemos todos activos.
  let q = supabase
    .from('centros_medicos')
    .select('id, nombre')
    .eq('activo', true);

  if (asociadosIds.length > 0) {
    q = q.not('id', 'in', `(${asociadosIds.join(',')})`);
  }

  const { data, error } = await q;
  return { data, error };
}
