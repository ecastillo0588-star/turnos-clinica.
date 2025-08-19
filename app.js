// app.js — Frontend puro (ESM)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ==== CREDENCIALES SUPABASE ====
const SUPABASE_URL = "https://vwkszvdvswznlgxlfdtz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3a3N6dmR2c3d6bmxneGxmZHR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU1NDM4NDQsImV4cCI6MjA3MTExOTg0NH0.TnDGheCSTUqGwTCMiHZ_CUgcAztCqVTc1cINkMud8p0";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==== HELPERS ====
const $  = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));
const setStatus = (t)=>{ const el=$("#status"); if(el) el.textContent=t; };
const dmy = (date)=>{
  if(!date) return "";
  const d = new Date(date);
  if(Number.isNaN(d.getTime())) return date;
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
};

// Chequeo de solapamiento (mismo profesional + centro + fecha)
async function haySolapamiento({ profesional_id, centro_id, fecha, hi, hf }) {
  // si no se pasó hora_fin, usamos misma hora_inicio como rango mínimo
  const horaFin = hf || hi;

  // Traemos turnos del día y checamos overlaps
  const { data, error } = await supabase
    .from('turnos')
    .select('hora_inicio, hora_fin')
    .eq('profesional_id', profesional_id)
    .eq('centro_id', centro_id)
    .eq('fecha', fecha);

  if(error) throw error;

  // overlap si: startA < endB && startB < endA
  const toMins = (t)=>{ const [H,M]=t.split(':'); return (+H)*60 + (+M); };
  const Astart = toMins(hi);
  const Aend   = toMins(horaFin);

  return (data || []).some(t => {
    const Bstart = toMins(t.hora_inicio);
    const Bend   = toMins(t.hora_fin || t.hora_inicio);
    return Astart < Bend && Bstart < Aend;
  });
}

// ====================== UI: APP ======================
function renderApp(user){
  // Reemplaza todo el body por la app
  document.body.innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-title">Gestión de Turnos</div>
          <div class="brand-sub">${user.email}</div>
        </div>
        <nav class="menu">
          <button class="menu-item active" data-view="new-appointment">➕ Nuevo turno</button>
          <button class="menu-item" data-view="new-patient">👤 Nuevo paciente</button>
          <button class="menu-item" data-view="patients">📋 Pacientes</button>
          <button class="menu-item" data-view="today">🗓️ Turnos de hoy</button>
        </nav>
        <div style="margin-top:auto">
          <span class="badge" id="status">Listo</span>
          <div style="margin-top:10px">
            <button id="btn-logout" class="btn" style="width:100%">Cerrar sesión</button>
          </div>
        </div>
      </aside>

      <main class="main">
        <div class="topbar"><h2 id="page-title">Nuevo turno</h2></div>

        <!-- Nuevo Turno -->
        <section class="card" id="view-new-appointment">
          <h3>Asignar Turno</h3>
          <div class="grid">
            <label>DNI Paciente <input type="text" id="dni-buscar" placeholder="30123456" required></label>
            <label>Profesional <input type="text" id="ap-profesional" placeholder="Dra. Castillo" required></label>
            <label>Centro Médico <input type="text" id="ap-centro" placeholder="Consultorio Central" required></label>
            <label>Fecha <input type="date" id="ap-fecha" required></label>
            <label>Hora Inicio <input type="time" id="ap-hora-inicio" required></label>
            <label>Hora Fin <input type="time" id="ap-hora-fin"></label>
          </div>
          <div class="actions">
            <button id="btn-buscar-paciente" class="btn">Buscar paciente</button>
            <button id="btn-asignar" class="btn primary">Asignar turno</button>
          </div>
          <div id="paciente-preview" class="muted" style="margin-top:8px"></div>
        </section>

        <!-- Nuevo Paciente -->
        <section class="card hidden" id="view-new-patient">
          <h3>Registrar Paciente</h3>
          <form id="form-paciente">
            <div class="grid">
              <label>DNI <input type="text" name="dni" required></label>
              <label>Apellido <input type="text" name="apellido" required></label>
              <label>Nombre <input type="text" name="nombre" required></label>
              <label>Fecha nacimiento <input type="date" name="fecha_nacimiento"></label>
              <label>Teléfono <input type="tel" name="telefono"></label>
              <label>Email <input type="email" name="email"></label>
              <label>Obra social <input type="text" name="obra_social"></label>
              <label>N° afiliado <input type="text" name="numero_afiliado"></label>
              <label>Contacto nombre <input type="text" name="contacto_nombre"></label>
              <label>Contacto apellido <input type="text" name="contacto_apellido"></label>
              <label>Contacto celular <input type="tel" name="contacto_celular"></label>
              <label>Vínculo <input type="text" name="vinculo"></label>
              <label>Credencial <input type="text" name="credencial"></label>
              <label>Historia clínica <input type="text" name="historia_clinica"></label>
              <label>Próximo control <input type="date" name="proximo_control"></label>
              <label>Renovación receta <input type="date" name="renovacion_receta"></label>
            </div>
            <div class="actions"><button class="btn primary" type="submit">Guardar paciente</button></div>
          </form>
        </section>

        <!-- Pacientes -->
        <section class="card hidden" id="view-patients">
          <div class="toolbar">
            <input type="search" id="q" placeholder="Buscar por DNI, nombre o apellido…">
            <span class="muted" id="rows-count"></span>
          </div>
          <div class="table-wrap"><table id="tbl-pacientes"></table></div>
        </section>

        <!-- Turnos de hoy -->
        <section class="card hidden" id="view-today">
          <h3>Turnos de hoy</h3>
          <div class="table-wrap"><table id="tbl-hoy"></table></div>
        </section>
      </main>
    </div>
  `;

  // Eventos globales
  $('#btn-logout')?.addEventListener('click', async ()=>{
    await supabase.auth.signOut();
    renderLogin(); // volver al login sin recargar
  });
  $$('.menu .menu-item').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));

  // Eventos de vistas
  $('#btn-buscar-paciente')?.addEventListener('click', buscarPacientePorDni);
  $('#btn-asignar')?.addEventListener('click', asignarTurno);
  $('#form-paciente')?.addEventListener('submit', guardarPaciente);
  $('#q')?.addEventListener('input', filtrarPacientes);

  // Init
  switchView('new-appointment');
  cargarPacientes();
  cargarTurnosDeHoy();
}

// ====================== UI: LOGIN ======================
function renderLogin(){
  document.body.innerHTML = `
    <div class="login-container">
      <h1>Gestión de Turnos</h1>
      <form id="login-form">
        <input type="email" id="email" placeholder="Email" required />
        <input type="password" id="password" placeholder="Contraseña" required />
        <button type="submit">Ingresar</button>
      </form>
      <p id="error-message"></p>
    </div>
  `;
  $('#login-form')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const email=$('#email').value.trim();
    const pass=$('#password').value.trim();
    $('#error-message').textContent='Ingresando…';
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if(error){ $('#error-message').textContent = error.message; return; }
    // onAuthStateChange renderiza la app automáticamente
  });
}

// Escuchar cambios de sesión (login, logout, refresh)
supabase.auth.onAuthStateChange((_evt, session)=>{
  if(session?.user) renderApp(session.user);
  else renderLogin();
});

// ====================== NAV ======================
function switchView(view){
  $$('.menu .menu-item').forEach(b=>b.classList.toggle('active', b.dataset.view===view));
  $('#page-title').textContent =
    view==='patients' ? 'Pacientes' :
    view==='new-patient' ? 'Nuevo paciente' :
    view==='today' ? 'Turnos de hoy' : 'Nuevo turno';

  ['view-new-appointment','view-new-patient','view-patients','view-today']
    .forEach(id=>$('#'+id)?.classList.add('hidden'));

  if(view==='new-appointment') $('#view-new-appointment')?.classList.remove('hidden');
  if(view==='new-patient')     $('#view-new-patient')?.classList.remove('hidden');
  if(view==='patients')        $('#view-patients')?.classList.remove('hidden');
  if(view==='today')           $('#view-today')?.classList.remove('hidden');
}

// ====================== PACIENTES ======================
let pacientesCache = [];

async function cargarPacientes(){
  setStatus('Cargando pacientes…');
  const { data, error } = await supabase.from('pacientes')
    .select('*').order('apellido', {ascending:true}).limit(1000);
  if(error){ alert(error.message); setStatus('Error'); return; }
  pacientesCache = data||[];
  renderPacientes(pacientesCache);
  setStatus('Listo');
}
function renderPacientes(rows){
  const headers = ['dni','apellido','nombre','fecha_nacimiento','telefono','email','obra_social','numero_afiliado'];
  const tbl = $('#tbl-pacientes'); if(!tbl) return;
  tbl.innerHTML='';
  const thead=document.createElement('thead'); const trh=document.createElement('tr');
  headers.forEach(h=>{ const th=document.createElement('th'); th.textContent=h; trh.appendChild(th); });
  thead.appendChild(trh); tbl.appendChild(thead);
  const tbody=document.createElement('tbody');
  rows.forEach(r=>{
    const tr=document.createElement('tr');
    headers.forEach(h=>{
      const td=document.createElement('td');
      td.textContent = h.includes('fecha') ? dmy(r[h]) : (r[h]??'');
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  const rc = $('#rows-count'); if(rc) rc.textContent = `${rows.length} paciente(s)`;
}
function filtrarPacientes(e){
  const q = e.target.value.toLowerCase().trim();
  if(!q) return renderPacientes(pacientesCache);
  const f = pacientesCache.filter(p =>
    String(p.dni||'').toLowerCase().includes(q) ||
    String(p.apellido||'').toLowerCase().includes(q) ||
    String(p.nombre||'').toLowerCase().includes(q)
  );
  renderPacientes(f);
}
async function guardarPaciente(e){
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const payload = Object.fromEntries(fd.entries());
  if(!payload.dni) return alert('El DNI es obligatorio');

  setStatus('Guardando paciente…');
  // 1) si existe, avisamos y no insertamos
  const { data: existente, error: e1 } = await supabase
    .from('pacientes')
    .select('id, apellido, nombre, telefono, email')
    .eq('dni', payload.dni)
    .maybeSingle();

  if(e1){ setStatus('Error'); return alert(e1.message); }

  if(existente){
    setStatus('Ya existe');
    alert(`Ya existe un paciente con DNI ${payload.dni}:\n${existente.apellido}, ${existente.nombre}`);
    // opcional: llevar a Nuevo turno con ese DNI prellenado
    $('#dni-buscar').value = payload.dni;
    switchView('new-appointment');
    return;
  }

  // 2) insert
  const { error } = await supabase.from('pacientes').insert(payload);
  if(error){
    setStatus('Error');
    // clave duplicada u otro error
    return alert(error.message.includes('duplicate key') ?
      'Ese DNI ya está registrado.' : error.message);
  }
  setStatus('Paciente guardado');
  e.currentTarget.reset();
  await cargarPacientes();
  switchView('new-appointment');
}


// ====================== NUEVO TURNO ======================
let pacienteActual = null;

async function buscarPacientePorDni(){
  const dni = $('#dni-buscar').value.trim();
  if(!dni) return alert('Ingresá un DNI');
  setStatus('Buscando paciente…');
  const { data, error } = await supabase.from('pacientes').select('*').eq('dni', dni).maybeSingle();
  if(error){ setStatus('Error'); return alert(error.message); }
  pacienteActual = data || null;
  $('#paciente-preview').textContent = pacienteActual
    ? `Paciente: ${pacienteActual.apellido}, ${pacienteActual.nombre} • Tel: ${pacienteActual.telefono||'-'}`
    : 'No existe. Cargalo en "Nuevo paciente" y luego asigná el turno.';
  setStatus('Listo');
}

async function asignarTurno(){
  const dni = $('#dni-buscar').value.trim();
  if(!dni) return alert('DNI requerido');
  if(!pacienteActual){
    const go = confirm('No se encontró el paciente. ¿Querés crearlo ahora?');
    if(go) switchView('new-patient');
    return;
  }
  const profesionalTxt = $('#ap-profesional').value.trim();
  const centroTxt = $('#ap-centro').value.trim();
  const fecha = $('#ap-fecha').value;                // YYYY-MM-DD
  const hi = $('#ap-hora-inicio').value;             // HH:MM
  const hf = $('#ap-hora-fin').value || null;
  if(!profesionalTxt || !centroTxt || !fecha || !hi) return alert('Completá todos los campos');

  // Profesional (crear si no existe)
  let { data: pro, error: e1 } = await supabase.from('profesionales').select('id').ilike('apellido', profesionalTxt).limit(1);
  if(e1) return alert(e1.message);
  let profesional_id = pro?.[0]?.id;
  if(!profesional_id){
    const { data: np, error: e2 } = await supabase.from('profesionales')
      .insert({ apellido: profesionalTxt, nombre: profesionalTxt }).select().single();
    if(e2) return alert('Error creando profesional: '+e2.message);
    profesional_id = np.id;
  }

  // Centro Médico (crear si no existe)
  let { data: cen, error: e3 } = await supabase.from('centros_medicos').select('id').ilike('nombre', centroTxt).limit(1);
  if(e3) return alert(e3.message);
  let centro_id = cen?.[0]?.id;
  if(!centro_id){
    const { data: nc, error: e4 } = await supabase.from('centros_medicos')
      .insert({ nombre: centroTxt }).select().single();
    if(e4) return alert('Error creando centro: '+e4.message);
    centro_id = nc.id;
  }

  // Chequear solapamiento antes de insertar
  try {
    const overlap = await haySolapamiento({
      profesional_id, centro_id, fecha, hi, hf
    });
    if (overlap) {
      return alert('Ya existe un turno en ese horario para ese profesional/centro. Elegí otra hora.');
    }
  } catch (e) {
    console.error(e);
    return alert('No se pudo validar superposición de turnos.');
  }

  // Insertar turno
  setStatus('Asignando turno…');
  const { error } = await supabase.from('turnos').insert({
    paciente_id: pacienteActual.id,
    profesional_id,
    centro_id,
    fecha,
    hora_inicio: hi,
    hora_fin: hf || null
  });
  if(error){ setStatus('Error'); return alert(error.message); }

  setStatus('Turno asignado');
  $('#paciente-preview').textContent = '';
  $('#dni-buscar').value = '';
  $('#ap-profesional').value = '';
  $('#ap-centro').value = '';
  $('#ap-fecha').value = '';
  $('#ap-hora-inicio').value = '';
  $('#ap-hora-fin').value = '';
  await cargarTurnosDeHoy();
  switchView('today');
}


// ====================== TURNOS HOY ======================
async function cargarTurnosDeHoy(){
  const hoy = new Date();
  const ymd = hoy.toISOString().split('T')[0];
  setStatus('Cargando turnos…');
  const { data, error } = await supabase.from('turnos')
    .select(`id, fecha, hora_inicio, hora_fin,
      pacientes(dni,apellido,nombre,telefono),
      profesionales(apellido,nombre),
      centros_medicos(nombre)`)
    .eq('fecha', ymd).order('hora_inicio');
  if(error){ setStatus('Error'); return alert(error.message); }

  const tbl = $('#tbl-hoy'); if(!tbl) return;
  tbl.innerHTML='';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  ['Hora','Paciente','Profesional','Centro','Teléfono'].forEach(h=>{
    const th=document.createElement('th'); th.textContent=h; trh.appendChild(th);
  });
  thead.appendChild(trh); tbl.appendChild(thead);

  const tbody=document.createElement('tbody');
  (data||[]).forEach(t=>{
    const hora = `${t.hora_inicio||''}${t.hora_fin?'-'+t.hora_fin:''}`;
    const pac  = t.pacientes ? `${t.pacientes.apellido}, ${t.pacientes.nombre}` : '';
    const pro  = t.profesionales ? `${t.profesionales.apellido} ${t.profesionales.nombre||''}` : '';
    const cen  = t.centros_medicos ? t.centros_medicos.nombre : '';
    const tr=document.createElement('tr');
    tr.innerHTML = `<td>${hora}</td><td>${pac}</td><td>${pro}</td><td>${cen}</td><td>${t.pacientes?.telefono||''}</td>`;
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  setStatus('Listo');
}

// ====================== INIT ======================
(async ()=>{
  const { data:{ session } } = await supabase.auth.getSession();
  if(session?.user) renderApp(session.user);
  else renderLogin();
})();
