
import supabase from './supabaseClient.js';

/**
 * Normaliza algunos helpers comunes y UI utilities compartidas.
 * Este archivo exporta:
 * - openPacienteModal / closeModal
 * - normalizePhoneForWA / buildWA
 * - normalizeRole / isUUID / profLabel
 * - getProfesionalesForContext / fillProfesionalSelect / applyRoleClasses / roleAllows / loadProfesionalesIntoSelect
 */

/* =====================
 * Utils básicos
 * ===================== */
export function normalizePhoneForWA(raw) {
  if (!raw) return '';
  let p = String(raw).replace(/[^\d]/g, '');
  if (p.startsWith('0')) p = p.slice(1);
  if (!p.startsWith('54')) p = '549' + p;
  else if (p.startsWith('54') && !p.startsWith('549')) p = '549' + p.slice(2);
  return p;
}

export function buildWA({ pac, fechaISO, start, end, prof, centro, dir }) {
  return `Hola ${pac.apellido}, ${pac.nombre}! \nTe confirmamos tu turno el ${new Date(fechaISO).toLocaleDateString(
    'es-AR',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
  )} de ${start} a ${end} con ${prof} en ${centro} (${dir}). \nSi no podés asistir, por favor avisá. ¡Gracias!`;
}

export function profLabel(p) {
  const ape = (p?.apellido || '').trim();
  const nom = (p?.nombre || '').trim();
  return [ape, nom].filter(Boolean).join(', ') || nom || ape || p?.id;
}

export function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (['apm','amp','asistente_personal','asistente_personal_medico'].includes(r)) return 'amp';
  if (['amc','acm','asistente','recepcion'].includes(r)) return 'amc';
  if (['owner','propietario'].includes(r)) return 'propietario';
  if (['doctor','medico'].includes(r)) return 'medico';
  return r;
}

export function isUUID(v) {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/* =====================
 * Roles y profesionales por contexto
 * ===================== */
export async function getProfesionalesForContext({ role, centroId, loggedProfesionalId }) {
  const R = normalizeRole(role);
  if (!centroId) return [];

  // 1) Médico logueado: solo él
  if (R === 'medico' && loggedProfesionalId) {
    const { data: p, error } = await supabase
      .from('profesionales')
      .select('id, nombre, apellido, rol')
      .eq('id', loggedProfesionalId)
      .maybeSingle();

    if (error) console.warn('[GFC][medico] error:', error);
    if (p?.rol !== 'medico') return [];
    return [{ id: p.id, label: profLabel(p) }];
  }

  // 2) AMP: médicos vinculados a este AMP en este centro (via medico_registrador_id)
  if (R === 'amp' && loggedProfesionalId) {
    const { data: links, error: linksErr } = await supabase
      .from('profesional_centro')
      .select('medico_registrador_id')
      .eq('profesional_id', loggedProfesionalId)
      .eq('centro_id', centroId)
      .eq('activo', true);

    if (linksErr) {
      console.warn('[GFC][AMP] error links:', linksErr);
      return [];
    }

    const ids = [...new Set((links || [])
      .map(r => r?.medico_registrador_id)
      .filter(isUUID))];

    if (ids.length === 0) {
      console.debug('[GFC][AMP] sin medico_registrador_id válidos para este AMP/centro');
      return [];
    }

    const { data: pros, error: prosErr } = await supabase
      .from('profesionales')
      .select('id, nombre, apellido, rol')
      .in('id', ids)
      .eq('rol', 'medico')
      .order('apellido', { ascending: true });

    if (prosErr) {
      console.warn('[GFC][AMP] error pros:', prosErr);
      return [];
    }
    return (pros || []).map(p => ({ id: p.id, label: profLabel(p) }));
  }

  // 3) AMC / propietario: todos los médicos del centro
  if (R === 'amc' || R === 'propietario') {
    const { data: map, error: mapErr } = await supabase
      .from('profesional_centro')
      .select('profesional_id')
      .eq('centro_id', centroId)
      .eq('activo', true);

    if (mapErr) {
      console.warn('[GFC][AMC/prop] error map:', mapErr);
      return [];
    }

    const ids = [...new Set((map || [])
      .map(r => r?.profesional_id)
      .filter(isUUID))];

    if (!ids.length) return [];

    const { data: pros, error: prosErr } = await supabase
      .from('profesionales')
      .select('id, nombre, apellido, rol')
      .in('id', ids)
      .eq('rol', 'medico')
      .order('apellido', { ascending: true });

    if (prosErr) {
      console.warn('[GFC][AMC/prop] error pros:', prosErr);
      return [];
    }
    return (pros || []).map(p => ({ id: p.id, label: profLabel(p) }));
  }

  return [];
}

/** Pinta opciones en un <select> */
export function fillProfesionalSelect(selectEl, items, {
  disabled = false,
  value = null,
  placeholder = 'Sin médicos'
} = {}) {
  if (!selectEl) return;
  if (!items.length) {
    selectEl.innerHTML = `<option value="">${placeholder}</option>`;
    selectEl.disabled = true;
    return;
  }
  selectEl.innerHTML = items.map(it => `<option value="${it.id}">${it.label}</option>`).join('');
  selectEl.disabled = !!disabled;
  const val = value ?? items[0]?.id ?? '';
  if (val) selectEl.value = val;
}

/** Aplica clases de rol al <body> (útil para CSS condicional) */
export function applyRoleClasses(role) {
  const R = normalizeRole(role);
  document.body.classList.toggle('role-amc', R === 'amc');
  document.body.classList.toggle('role-amp', R === 'amp');
  document.body.classList.toggle('role-medico', R === 'medico');
}

/** Permisos por acción (AMC puede ARRIBO y VOLVER; AMP/Médico todo) */
export function roleAllows(action, role) {
  const R = normalizeRole(role);
  const full  = (R === 'medico' || R === 'amp');
  const recep = (R === 'amc' || R === 'propietario');

  const map = {
    arribo:       full || recep,
    volver:       full || recep,
    cancelar:     full || recep,                 // AMC y propietario pueden anular
    atender:      full,                          // solo médico/AMP
    reprogramar:  true,                          // todos
    abrir_ficha:  full,
    finalizar:    full,

    // Turnos/slots
    bloquear:     full || (R === 'propietario'), // AMC NO puede bloquear
    desbloquear:  full || (R === 'propietario'), // AMC NO puede desbloquear
    reenviar_wa:  full || recep,                 // AMC sí puede reenviar WhatsApp
  };

  return !!map[action];
}



/** Helper: carga médicos, llena el select y devuelve el id elegido */
export async function loadProfesionalesIntoSelect(selectEl, { role, centroId, loggedProfesionalId }) {
  const R = normalizeRole(role);
  const items = await getProfesionalesForContext({ role: R, centroId, loggedProfesionalId });
  const disabled = (R === 'medico');
  const value = disabled ? loggedProfesionalId : (items[0]?.id ?? null);
  fillProfesionalSelect(selectEl, items, { disabled, value, placeholder: 'Sin médicos' });
  return selectEl?.value || null;
}

/* =====================
 * Modal de Paciente (crear/editar)
 * ===================== */
function showFormMessage(type, msg) {
  const c = document.querySelector('#form-paciente #form-alerts');
  if (!c) return;
  c.innerHTML = `<div class="${type === 'error' ? 'error-box' : 'success-box'}">
    <span style="font-size:18px;">${type === 'error' ? '⚠️' : '✅'}</span>
    <div>${msg}</div>
  </div>`;
}

function extractFormData(form) {
  const fd = new FormData(form);
  const o = {};
  fd.forEach((v, k) => o[k] = (v ?? '').toString().trim());
  o.activo = o.activo === 'true';
  [
    'fecha_nacimiento','telefono','email','numero_afiliado',
    'contacto_nombre','contacto_apellido','contacto_celular','vinculo',
    'credencial','historia_clinica','proximo_control','renovacion_receta'
  ].forEach(k => { if (o[k] === '') o[k] = null; });
  // obra_social_id: UUID o null
  if (!o.obra_social_id) o.obra_social_id = null;
  // nunca enviar obra_social (texto)
  delete o.obra_social;
  return o;
}

async function submitPacienteForm(form, pacienteExistente) {
  const data = extractFormData(form);

  // Validaciones mínimas
  if (!data.dni || !data.apellido || !data.nombre) {
    showFormMessage('error', 'DNI, Apellido y Nombre son obligatorios.');
    return;
  }
  if (data.historia_clinica && !/^https?:\/\//i.test(data.historia_clinica)) {
    showFormMessage('error', 'La Historia Clínica debe ser una URL válida (http/https).');
    return;
  }

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    if (pacienteExistente) {
      // UPDATE normal
      const { error } = await supabase
        .from('pacientes')
        .update(data)
        .eq('id', pacienteExistente.id);
      if (error) throw error;
      showFormMessage('success', 'Paciente actualizado.');
    } else {
      // Verificar duplicado por DNI
      const { data: existing, error: qErr } = await supabase
        .from('pacientes')
        .select('id')
        .eq('dni', data.dni)
        .limit(1);
      if (qErr) throw qErr;
      if (existing && existing.length) {
        showFormMessage('error', 'Ya existe un paciente con ese DNI.');
        btn.disabled = false;
        btn.textContent = 'Crear Paciente';
        return;
      }

      // Insertar paciente (devolvemos campos útiles para select posterior)
      const { data: inserted, error: insErr } = await supabase
        .from('pacientes')
        .insert([data])
        .select('id, apellido, nombre, dni, telefono, obra_social_id')
        .single();
      if (insErr) throw insErr;

      // Insertar relación paciente-profesional (usa el médico activo en la UI)
      const pacienteId = inserted.id;
      const profesionalId = localStorage.getItem('profesional_id') || window.currentProfesional;
      if (pacienteId && profesionalId) {
        const { error: relErr } = await supabase
          .from('paciente_profesional')
          .insert([{ paciente_id: pacienteId, profesional_id: profesionalId }]);
        if (relErr) throw relErr;
      }

      // Notificar a la app por si quiere autoseleccionar el nuevo paciente
      try {
        window.dispatchEvent(new CustomEvent('paciente-creado', { detail: { paciente: inserted } }));
      } catch {}

      showFormMessage('success', 'Paciente creado y vinculado al profesional.');
      form.reset();
    }

    setTimeout(() => closeModal(), 850);
  } catch (e) {
    showFormMessage('error', 'Error: ' + (e.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = pacienteExistente ? 'Guardar Cambios' : 'Crear Paciente';
  }
}

export function closeModal() {
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot) modalRoot.innerHTML = '';
}

/**
 * Abre modal para crear o editar paciente
 * @param {Object|null} paciente - Si se pasa un objeto abre en modo edición, si no en modo nuevo.
 */
export async function openPacienteModal(paciente = null) {
  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) {
    console.error('⚠️ No se encontró #modal-root en el DOM');
    return;
  }

  // Cargar catálogo de obras sociales para poblar el <select>
  let osOptions = '';
  try {
    const { data: catalogOS } = await supabase
      .from('obras_sociales')
      .select('id, obra_social')
      .order('obra_social', { ascending: true });
    osOptions = (catalogOS || [])
      .map(o => `<option value="${o.id}" ${String(o.id)===String(paciente?.obra_social_id) ? 'selected' : ''}>${o.obra_social}</option>`)
      .join('');
  } catch (e) {
    console.warn('[openPacienteModal] No se pudo cargar obras sociales:', e?.message || e);
  }

  modalRoot.innerHTML = '';
  const isEdit = !!(paciente && paciente.id);

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <button class="modal-close" aria-label="Cerrar">&times;</button>
      <div class="modal-header"><h3>${isEdit ? 'Editar Paciente' : 'Nuevo Paciente'}</h3></div>
      <form id="form-paciente">
        <div class="modal-body">
          <div id="form-alerts"></div>
          <fieldset class="fieldset">
            <legend>Datos Personales</legend>
            <div class="form-grid">
              <div class="form-group"><label>DNI *</label><input name="dni" required value="${paciente?.dni ?? ''}"></div>
              <div class="form-group"><label>Apellido *</label><input name="apellido" required value="${paciente?.apellido ?? ''}"></div>
              <div class="form-group"><label>Nombre *</label><input name="nombre" required value="${paciente?.nombre ?? ''}"></div>
              <div class="form-group"><label>Fecha Nacimiento</label><input name="fecha_nacimiento" type="date" value="${paciente?.fecha_nacimiento ?? ''}"></div>
              <div class="form-group"><label>Teléfono</label><input name="telefono" value="${paciente?.telefono ?? ''}"></div>
              <div class="form-group"><label>Email</label><input name="email" type="email" value="${paciente?.email ?? ''}"></div>
              <div class="form-group">
                <label>Obra Social</label>
                <select name="obra_social_id">
                  <option value="">(Sin obra social)</option>
                  ${osOptions}
                </select>
              </div>
              <div class="form-group"><label>N° Afiliado</label><input name="numero_afiliado" value="${paciente?.numero_afiliado ?? ''}"></div>
            </div>
          </fieldset>
          <fieldset class="fieldset">
            <legend>Contacto Emergencia</legend>
            <div class="form-grid">
              <div class="form-group"><label>Contacto Nombre</label><input name="contacto_nombre" value="${paciente?.contacto_nombre ?? ''}"></div>
              <div class="form-group"><label>Contacto Apellido</label><input name="contacto_apellido" value="${paciente?.contacto_apellido ?? ''}"></div>
              <div class="form-group"><label>Contacto Celular</label><input name="contacto_celular" value="${paciente?.contacto_celular ?? ''}"></div>
              <div class="form-group"><label>Vínculo</label><input name="vinculo" value="${paciente?.vinculo ?? ''}"></div>
            </div>
          </fieldset>
          <fieldset class="fieldset">
            <legend>Información Adicional</legend>
            <div class="form-grid">
              <div class="form-group"><label>Credencial</label><input name="credencial" value="${paciente?.credencial ?? ''}"></div>
              <div class="form-group"><label>Próximo Control</label><input name="proximo_control" type="date" value="${paciente?.proximo_control ?? ''}"></div>
              <div class="form-group"><label>Renovación Receta</label><input name="renovacion_receta" type="date" value="${paciente?.renovacion_receta ?? ''}"></div>
              <div class="form-group" style="grid-column:1/-1;">
                <label>Historia Clínica (URL Google Docs)</label>
                <input name="historia_clinica" placeholder="https://..." value="${paciente?.historia_clinica ?? ''}">
              </div>
              <div class="form-group"><label>Activo</label>
                <select name="activo">
                  <option value="true" ${paciente?.activo !== false ? 'selected' : ''}>Sí</option>
                  <option value="false" ${paciente?.activo === false ? 'selected' : ''}>No</option>
                </select>
              </div>
            </div>
          </fieldset>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn secondary" id="btn-cancelar">Cancelar</button>
          <button type="submit" class="btn">${isEdit ? 'Guardar Cambios' : 'Crear Paciente'}</button>
        </div>
      </form>
    </div>
  `;

  modalRoot.appendChild(modal);

  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.querySelector('#btn-cancelar').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  modal.querySelector('#form-paciente').addEventListener('submit', async e => {
    e.preventDefault();
    await submitPacienteForm(e.target, paciente);
  });
}
