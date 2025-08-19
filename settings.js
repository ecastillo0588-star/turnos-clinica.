// settings.js (ESM)
// ctx esperado: { supabase, me, setStatus, refreshToday }
let CTX = null;

export function initSettings(ctx) {
  CTX = ctx;
}

export async function renderSettingsView(container) {
  const { supabase, me, setStatus } = CTX;

  container.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <h3>Configuración</h3>
      <p class="muted">Verás los bloques permitidos por tu rol.</p>
    </div>

    ${me.role === 'propietario' ? `
      <div class="card" style="margin-bottom:12px">
        <h3>Centros Médicos (Propietario)</h3>
        <div class="grid">
          <label>Nombre <input id="cfg-centro-nombre" placeholder="Consultorio Central"></label>
          <label>Dirección <input id="cfg-centro-dir"></label>
          <label>Teléfono <input id="cfg-centro-tel"></label>
        </div>
        <div class="actions"><button class="btn primary" id="btn-crear-centro">Crear centro</button></div>
      </div>

      <div class="card" style="margin-bottom:12px">
        <h3>Médicos (Propietario)</h3>
        <div class="grid">
          <label>Apellido <input id="cfg-med-apellido"></label>
          <label>Nombre <input id="cfg-med-nombre"></label>
          <label>Especialidad <input id="cfg-med-esp"></label>
          <label>Matrícula <input id="cfg-med-mat"></label>
        </div>
        <div class="grid" id="cfg-centros-list"></div>
        <div class="actions"><button class="btn primary" id="btn-crear-medico">Crear médico y asignar centros</button></div>
      </div>

      <div class="card" style="margin-bottom:12px">
        <h3>Vincular Usuario ↔ Profesional (Propietario)</h3>
        <div class="grid">
          <label>Usuario (email)
            <select id="link-user"></select>
          </label>
          <label>Profesional
            <select id="link-prof"></select>
          </label>
        </div>
        <div class="actions"><button class="btn primary" id="btn-vincular">Vincular</button></div>
      </div>
    ` : ''}

    <div class="card" style="margin-bottom:12px">
      <h3>Ajustes de Duración de Turnos ${me.role==='propietario' ? '(Elegí médico)' : '(Tu configuración)'}</h3>
      <div class="grid">
        ${me.role==='propietario' ? `<label>Médico <select id="cfg-medico-dur"></select></label>` : ''}
        <label>Duración paciente NUEVO (min) <input id="cfg-dur-nuevo" type="number" min="5" step="5" value="40"></label>
        <label>Duración CONTROL (min) <input id="cfg-dur-control" type="number" min="5" step="5" value="20"></label>
      </div>
      <div class="actions"><button class="btn primary" id="btn-guardar-dur">Guardar</button></div>
    </div>

    <div class="card">
      <h3>Crear Agenda (slot)</h3>
      <div class="grid">
        ${me.role==='propietario' ? `<label>Médico <select id="ag-medico"></select></label>` : ''}
        <label>Centro <select id="ag-centro"></select></label>
        <label>Fecha <input type="date" id="ag-fecha"></label>
        <label>Hora inicio <input type="time" id="ag-hi"></label>
        <label>Hora fin <input type="time" id="ag-hf"></label>
        <label>Disponible
          <select id="ag-disp">
            <option value="true" selected>Sí</option>
            <option value="false">No</option>
          </select>
        </label>
      </div>
      <div class="actions"><button class="btn primary" id="btn-crear-agenda">Crear slot</button></div>
      <p class="muted">Más adelante podemos generar múltiples slots por rango.</p>
    </div>
  `;

  // ======= Datasources =======
  // Centros (para checklist + agenda)
  const { data: centros } = await supabase.from('centros_medicos').select('id,nombre').order('nombre');
  const centrosList = container.querySelector('#cfg-centros-list');
  if (centrosList) {
    centrosList.innerHTML = `<div style="grid-column:1/-1"><strong>Asignar a centros:</strong></div>` +
      (centros||[]).map(c => `
        <label style="flex-direction:row;align-items:center;gap:8px">
          <input type="checkbox" class="chk-centro" value="${c.id}"> ${c.nombre}
        </label>
      `).join('');
  }
  const agCentro = container.querySelector('#ag-centro');
  if (agCentro) agCentro.innerHTML = (centros||[]).map(c=>`<option value="${c.id}">${c.nombre}</option>`).join('');

  // Profesionales (para selects propietario)
  const { data: profesionales } = await supabase.from('profesionales').select('id,apellido,nombre').order('apellido');
  const optionsProfes = (profesionales||[]).map(p => `<option value="${p.id}">${p.apellido} ${p.nombre||''}</option>`).join('');
  const linkProf = container.querySelector('#link-prof');
  if (linkProf) linkProf.innerHTML = optionsProfes;
  const cfgMedicoDur = container.querySelector('#cfg-medico-dur');
  if (cfgMedicoDur) cfgMedicoDur.innerHTML = `<option value="">— Elegí —</option>` + optionsProfes;
  const agMed = container.querySelector('#ag-medico');
  if (agMed) agMed.innerHTML = optionsProfes;

  // Usuarios con rol médico
  const { data: usuariosMed } = await supabase
    .from('profiles').select('id,email,profesional_id').eq('role','medico').order('email');
  const linkUser = container.querySelector('#link-user');
  if (linkUser) linkUser.innerHTML = (usuariosMed||[]).map(u=>`<option value="${u.id}">${u.email}</option>`).join('');

  // ======= Handlers =======
  // Crear centro (propietario)
  container.querySelector('#btn-crear-centro')?.addEventListener('click', async ()=>{
    const nombre = container.querySelector('#cfg-centro-nombre').value.trim();
    const direccion = container.querySelector('#cfg-centro-dir').value.trim();
    const telefono = container.querySelector('#cfg-centro-tel').value.trim();
    if(!nombre) return alert('Nombre requerido');
    setStatus('Creando centro…');
    const { error } = await supabase.from('centros_medicos').insert({ nombre, direccion, telefono });
    setStatus(error ? 'Error' : 'Centro creado');
    if(error) alert(error.message);
  });

  // Crear médico + asignar centros (propietario)
  container.querySelector('#btn-crear-medico')?.addEventListener('click', async ()=>{
    const ap = container.querySelector('#cfg-med-apellido').value.trim();
    const no = container.querySelector('#cfg-med-nombre').value.trim();
    const es = container.querySelector('#cfg-med-esp').value.trim();
    const ma = container.querySelector('#cfg-med-mat').value.trim();
    const centrosSel = Array.from(container.querySelectorAll('.chk-centro:checked')).map(ch=> Number(ch.value));
    if(!ap) return alert('Apellido requerido');

    setStatus('Creando médico…');
    const { data: med, error } = await supabase.from('profesionales')
      .insert({ apellido: ap, nombre: no, especialidad: es, matricula: ma })
      .select().single();
    if(error){ setStatus('Error'); return alert(error.message); }

    if(centrosSel.length){
      const rows = centrosSel.map(cid => ({ profesional_id: med.id, centro_id: cid }));
      await supabase.from('profesional_centro').insert(rows);
    }
    setStatus('Médico creado');
  });

  // Vincular usuario ↔ profesional (propietario)
  container.querySelector('#btn-vincular')?.addEventListener('click', async ()=>{
    const uid = container.querySelector('#link-user').value;      // uuid de profile.id
    const pid = container.querySelector('#link-prof').value;      // uuid de profesionales.id
    if(!uid || !pid) return alert('Elegí usuario y profesional');
    setStatus('Vinculando…');
    const { error } = await supabase.from('profiles').update({ profesional_id: pid }).eq('id', uid);
    setStatus(error ? 'Error' : 'Vinculado');
    if(error) alert(error.message);
  });

  // Duraciones
  async function cargarDuraciones(profesionalId){
    if(!profesionalId) return;
    const { data: cfg } = await supabase
      .from('medico_config')
      .select('duracion_nuevo_min,duracion_control_min')
      .eq('profesional_id', profesionalId)
      .maybeSingle();
    container.querySelector('#cfg-dur-nuevo').value   = cfg?.duracion_nuevo_min ?? 40;
    container.querySelector('#cfg-dur-control').value = cfg?.duracion_control_min ?? 20;
  }

  if (me.role === 'propietario') {
    cfgMedicoDur?.addEventListener('change', e=>{
      const pid = e.target.value; // uuid string
      if (pid) cargarDuraciones(pid);
    });
  } else if (me.role === 'medico') {
    if (me.profesional_id) cargarDuraciones(me.profesional_id);
  }

  container.querySelector('#btn-guardar-dur')?.addEventListener('click', async ()=>{
    const nuevo   = +container.querySelector('#cfg-dur-nuevo').value || 40;
    const control = +container.querySelector('#cfg-dur-control').value || 20;
    const profesionalId = (me.role==='propietario')
      ? container.querySelector('#cfg-medico-dur').value
      : me.profesional_id;

    if(!profesionalId) return alert('Elegí un médico');
    setStatus('Guardando configuración…');

    const { error } = await supabase.from('medico_config')
      .upsert({ profesional_id: profesionalId, duracion_nuevo_min: nuevo, duracion_control_min: control }, { onConflict: 'profesional_id' });
    setStatus(error ? 'Error' : 'Configuración guardada');
    if(error) alert(error.message);
  });

  // Crear agenda (slot)
  container.querySelector('#btn-crear-agenda')?.addEventListener('click', async ()=>{
    const profesionalId = (me.role==='propietario')
      ? (container.querySelector('#ag-medico').value)   // uuid string
      : me.profesional_id;                              // uuid string
    const centroId = Number(container.querySelector('#ag-centro').value); // bigint
    const fecha = container.querySelector('#ag-fecha').value;
    const hi = container.querySelector('#ag-hi').value;
    const hf = container.querySelector('#ag-hf').value;
    const disp = container.querySelector('#ag-disp').value === 'true';

    if(!profesionalId || !centroId || !fecha || !hi) return alert('Completá médico/centro/fecha/hora');

    setStatus('Creando slot…');
    const { error } = await supabase.from('agenda').insert({
      profesional_id: profesionalId, centro_id: centroId,
      fecha, hora_inicio: hi, hora_fin: hf || null, disponible: disp
    });
    setStatus(error ? 'Error' : 'Slot creado');
    if(error) alert(error.message);
  });

  // Si el propietario ya tiene uno seleccionado, precarga
  if (me.role==='propietario' && cfgMedicoDur && cfgMedicoDur.value) {
    cargarDuraciones(cfgMedicoDur.value);
  }
}
