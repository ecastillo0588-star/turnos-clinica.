// Tu función principal para abrir el modal de paciente
export function openPacienteModal(paciente=null) {
  showModal(`
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true">
        <button class="modal-close" aria-label="Cerrar" onclick="globalThis.closeModal()">&times;</button>
        <div class="modal-header"><h3>${paciente ? 'Editar Paciente' : 'Nuevo Paciente'}</h3></div>
        <div class="modal-body">
          <div id="form-alerts"></div>
          <p>Formulario de paciente (próximamente aquí)</p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn secondary" onclick="globalThis.closeModal()">Cancelar</button>
        </div>
      </div>
    </div>
  `);
  // Exponemos closeModal globalmente para el modal HTML
  globalThis.closeModal = closeModal;
}
