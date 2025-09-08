import supabase from './supabaseClient.js';

/**
 * Abre modal para crear o editar paciente
 * @param {Object|null} paciente - Si se pasa un objeto abre en modo edición, si no en modo nuevo.
 */
export function openPacienteModal(paciente = null) {
  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) {
    console.error("⚠️ No se encontró #modal-root en el DOM");
    return;
  }

  modalRoot.innerHTML = '';
  const isEdit = !!paciente;

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
              <div class="form-group"><label>Obra Social</label><input name="obra_social" value="${paciente?.obra_social ?? ''}"></div>
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

export function closeModal() {
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot) modalRoot.innerHTML = '';
}

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
    'fecha_nacimiento','telefono','email','obra_social','numero_afiliado',
    'contacto_nombre','contacto_apellido','contacto_celular','vinculo',
    'credencial','historia_clinica','proximo_control','renovacion_receta'
  ].forEach(k => { if (o[k] === '') o[k] = null; });
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

      // Insertar paciente
      const { data: inserted, error: insErr } = await supabase
        .from('pacientes')
        .insert([data])
        .select('id')
        .single();
      if (insErr) throw insErr;

      // Insertar relación paciente-profesional
      const pacienteId = inserted.id;
      const profesionalId = localStorage.getItem('profesional_id') || window.currentProfesional;

      if (pacienteId && profesionalId) {
        const { error: relErr } = await supabase
          .from('paciente_profesional')
          .insert([{ paciente_id: pacienteId, profesional_id: profesionalId }]);
        if (relErr) throw relErr;
      }

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
