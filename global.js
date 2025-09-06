// Exporta la función para abrir el modal "Nuevo paciente"
// Recibe un objeto opcional "prefill" con los campos que quieras prellenar

export async function openPacienteModal(prefill = {}) {
  // Cargar obras sociales si hace falta
  if (!window.obrasSocialesCache || !window.obrasSocialesCache.length) {
    await window.loadObrasSociales?.();
  }

  // Referencias a los elementos del modal
  const UI = {
    modalPac: document.getElementById('turnos-modal-paciente'),
    npDni: document.getElementById('np-dni'),
    npNombre: document.getElementById('np-nombre'),
    npApellido: document.getElementById('np-apellido'),
    npFechaNac: document.getElementById('np-fecha-nac'),
    npTel: document.getElementById('np-telefono'),
    npEmail: document.getElementById('np-email'),
    npObra: document.getElementById('np-obra'),
    npObraInfo: document.getElementById('np-obra-info'),
    npAfiliado: document.getElementById('np-afiliado'),
    npConNom: document.getElementById('np-contacto-nombre'),
    npConApe: document.getElementById('np-contacto-apellido'),
    npConCel: document.getElementById('np-contacto-cel'),
    npVinculo: document.getElementById('np-vinculo'),
    npHistoria: document.getElementById('np-historia'),
    npHistoriaOpen: document.getElementById('np-historia-open'),
    npCredFile: document.getElementById('np-cred-file'),
    npCredSelect: document.getElementById('np-cred-select'),
    npCredPreview: document.getElementById('np-cred-preview'),
    npGuardar: document.getElementById('turnos-guardar-paciente'),
    npMsg: document.getElementById('turnos-np-msg'),
    modalPacClose: document.getElementById('turnos-modal-paciente-close'),
  };

  // Rellenar campos si hay prefill
  UI.npDni.value = prefill.dni || '';
  UI.npApellido.value = prefill.apellido || '';
  UI.npNombre.value = prefill.nombre || '';
  UI.npFechaNac.value = prefill.fecha_nacimiento || '';
  UI.npTel.value = prefill.telefono || '';
  UI.npEmail.value = prefill.email || '';
  UI.npObra.value = prefill.obra_social || '';
  UI.npObraInfo.textContent = '';
  UI.npAfiliado.value = prefill.numero_afiliado || '';
  UI.npConNom.value = prefill.contacto_nombre || '';
  UI.npConApe.value = prefill.contacto_apellido || '';
  UI.npConCel.value = prefill.contacto_celular || '';
  UI.npVinculo.value = prefill.vinculo || '';
  UI.npHistoria.value = prefill.historia_clinica || '';
  UI.npCredFile.value = '';
  UI.npCredPreview.style.display = 'none';
  UI.npCredPreview.innerHTML = '';
  UI.npMsg.textContent = '';

  // Mostrar el modal
  UI.modalPac.style.display = 'flex';

  // Listeners del modal (solo se agregan una vez)
  if (!UI.modalPac.__listenersAdded) {
    UI.modalPacClose?.addEventListener('click', () => UI.modalPac.style.display = 'none');
    window.addEventListener('click', e => { if (e.target === UI.modalPac) UI.modalPac.style.display = 'none'; });
    UI.npHistoriaOpen?.addEventListener('click', e => { if (!UI.npHistoria.value) { e.preventDefault(); } });
    UI.npCredSelect?.addEventListener('click', () => UI.npCredFile.click());
    UI.npCredFile?.addEventListener('change', () => {
      const f = UI.npCredFile.files?.[0];
      UI.npCredPreview.innerHTML = '';
      if (!f) { UI.npCredPreview.style.display = 'none'; return; }
      if (/^image\//.test(f.type)) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        img.alt = 'credencial';
        UI.npCredPreview.appendChild(img);
      }
      const meta = document.createElement('div');
      meta.className = 'tw-hint';
      meta.innerHTML = `${f.name} · ${(f.size / 1024).toFixed(0)} KB <a href="#" id="np-cred-remove">Quitar</a>`;
      UI.npCredPreview.appendChild(meta); UI.npCredPreview.style.display = 'flex';
      meta.querySelector('#np-cred-remove').addEventListener('click', ev => {
        ev.preventDefault();
        UI.npCredFile.value = ''; UI.npCredPreview.style.display = 'none'; UI.npCredPreview.innerHTML = '';
      });
    });
    UI.npGuardar?.addEventListener('click', async () => {
      const dni = UI.npDni.value.trim(),
        nombre = UI.npNombre.value.trim(),
        apellido = UI.npApellido.value.trim(),
        fecha_nacimiento = UI.npFechaNac.value || '',
        telefono = UI.npTel.value.trim();
      if (!dni || !nombre || !apellido || !fecha_nacimiento || !telefono) {
        UI.npMsg.textContent = 'Completá los campos obligatorios (*)'; return;
      }
      UI.npMsg.textContent = 'Guardando...';
      let credencialUrl = null; const file = UI.npCredFile.files?.[0];
      if (file) {
        // Supabase lógica (ajusta según tu proyecto)
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
        const path = `${dni}_${Date.now()}.${ext}`;
        const { data: up, error: upErr } = await window.supabase.storage.from('credenciales').upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
        if (upErr) { UI.npMsg.textContent = 'No se pudo subir credencial: ' + (upErr.message || ''); return; }
        const { data: pub } = await window.supabase.storage.from('credenciales').getPublicUrl(up.path); credencialUrl = pub?.publicUrl || null;
      }
      const payload = {
        dni, nombre, apellido, fecha_nacimiento, telefono,
        email: UI.npEmail.value.trim() || null,
        obra_social: UI.npObra.value || null,
        numero_afiliado: UI.npAfiliado.value.trim() || null,
        contacto_nombre: UI.npConNom.value.trim() || null,
        contacto_apellido: UI.npConApe.value.trim() || null,
        contacto_celular: UI.npConCel.value.trim() || null,
        vinculo: UI.npVinculo.value.trim() || null,
        credencial: credencialUrl,
        historia_clinica: UI.npHistoria.value.trim() || null,
        activo: true
      };
      const { data, error } = await window.supabase.from('pacientes').insert([payload]).select('id,dni,nombre,apellido,telefono').single();
      if (error) { UI.npMsg.textContent = 'Error: ' + (error.message || 'no se pudo crear'); return; }
      UI.modalPac.style.display = 'none';
      window.selectPaciente?.(data); // llama selectPaciente si existe en el contexto
      // Opcional: desbloquea opción "nueva consulta"
      const optNueva = document.getElementById('turnos-tipo')?.querySelector('option[value="nueva_consulta"]');
      if (optNueva) optNueva.disabled = false;
      document.getElementById('turnos-tipo').value = 'nueva_consulta';
    });
    UI.modalPac.__listenersAdded = true;
  }
}
