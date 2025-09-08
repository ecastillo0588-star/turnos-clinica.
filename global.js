// global.js

export function openPacienteModal(paciente = null) {
  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = '';
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <button class="modal-close" aria-label="Cerrar">&times;</button>
      <div class="modal-header">
        <h3>${paciente ? 'Editar Paciente' : 'Nuevo Paciente'}</h3>
      </div>
      <form id="form-paciente">
        <div class="modal-body">
          <!-- ... los mismos fieldset que ya tenés en pacientes.html ... -->
        </div>
        <div class="modal-footer">
          <button type="button" class="btn secondary" id="btn-cancelar">Cancelar</button>
          <button type="submit" class="btn">${paciente ? 'Guardar Cambios' : 'Crear Paciente'}</button>
        </div>
      </form>
    </div>
  `;
  modalRoot.appendChild(modal);

  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.querySelector('#btn-cancelar').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  function closeModal() { modalRoot.innerHTML = ''; }
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
