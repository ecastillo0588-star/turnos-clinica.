export function openPacienteModal(prefill = {}) {
  const { dni = '' } = prefill; // Si no viene DNI, es vacío

  showModal(`
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true">
        <button class="modal-close" aria-label="Cerrar" onclick="globalThis.closeModal()">&times;</button>
        <div class="modal-header"><h3>Nuevo Paciente</h3></div>
        <div class="modal-body">
          <div id="form-alerts"></div>
          <form id="paciente-form">
            <label>DNI</label>
            <input type="text" id="paciente-dni" value="${dni}" />
            <!-- Aquí irán más campos -->
          </form>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn secondary" onclick="globalThis.closeModal()">Cancelar</button>
        </div>
      </div>
    </div>
  `);
  globalThis.closeModal = closeModal;
}
