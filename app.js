// app.js (arriba del todo)
import { buildLayout, bindLayoutHandlers } from './ui.js';
import { initSettings, renderSettingsView } from './settings.js';

// ... tus const y helpers (SUPABASE_URL, supabase, VIEW_KEY, VALID_VIEWS, getViewFromHash, etc.)

async function renderApp(user){
  // Traer perfil
  const { data: me, error: meErr } = await supabase
    .from('profiles')
    .select('role, profesional_id, display_name, active')
    .eq('id', user.id)
    .single();
  if(meErr){ alert(meErr.message); return; }

  // 1) Construir layout
  document.body.innerHTML = buildLayout(user, me);

  // 2) Bind handlers del layout (router + logout)
  bindLayoutHandlers({
    switchView,
    onLogout: async ()=>{
      await supabase.auth.signOut();
      try { localStorage.removeItem(VIEW_KEY); } catch {}
      location.hash = '#/today';
      renderLogin();
    }
  });

  // 3) Eventos de vistas
  $('#btn-buscar-paciente')?.addEventListener('click', buscarPacientePorDni);
  $('#btn-asignar')?.addEventListener('click', asignarTurno);
  $('#form-paciente')?.addEventListener('submit', guardarPaciente);
  $('#q')?.addEventListener('input', filtrarPacientes);

  // 4) Init router/vistas
  const initialView = getViewFromHash()
    || (()=>{ try { const v = localStorage.getItem(VIEW_KEY); return VALID_VIEWS.includes(v) ? v : null; } catch { return null; } })()
    || 'today';
  switchView(initialView);

  // abrir submenú si corresponde
  if (['patients','new-patient'].includes(initialView)) {
    document.querySelector('.submenu-toggle')?.classList.add('open');
    document.getElementById('submenu-patients')?.classList.add('show');
  }

  // 5) Data inicial + settings ctx
  cargarPacientes();
  cargarTurnosDeHoy();
  initSettings({ supabase, me, setStatus, refreshToday: cargarTurnosDeHoy });
}

function renderLogin(){
  document.body.innerHTML = `
    <div class="auth">
      <div class="auth-card">
        <h2>Ingresar</h2>
        <form id="login-form" class="grid">
          <label>Email <input type="email" id="login-email" required></label>
          <label>Contraseña <input type="password" id="login-pass" required></label>
          <div class="actions">
            <button class="btn primary" type="submit">Entrar</button>
          </div>
        </form>
        <p class="muted" style="margin-top:8px">
          Acceso restringido — altas de usuarios desde el panel del propietario.
        </p>
      </div>
    </div>
  `;

  $('#login-form')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    setStatus('Ingresando…');

    const email = $('#login-email').value.trim();
    const pass  = $('#login-pass').value;

    console.log('🔑 Intentando login con:', email);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: pass
    });

    if (error) {
      setStatus('Error');
      console.error('❌ Error en signInWithPassword:', error);
      alert(`Login falló: ${error.message}`);
      return;
    }

    console.log('✅ Login OK, data:', data);
    setStatus('Listo');
  });
}

async function bootstrap(){
  // Escuchar cambios de sesión
  supabase.auth.onAuthStateChange((event, session) => {
    console.log('📡 onAuthStateChange:', event, session);
    if (session?.user) {
      console.log('👤 Usuario autenticado:', session.user.email);
      renderApp(session.user);
    } else {
      console.log('ℹ️ Sin sesión activa, mostrar login');
      renderLogin();
    }
  });

  // Cargar sesión actual al iniciar
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) console.error('⚠️ Error al obtener sesión:', error);

  console.log('🚀 bootstrap() session actual:', session);

  if (session?.user) {
    console.log('👤 Sesión encontrada al inicio:', session.user.email);
    renderApp(session.user);
  } else {
    console.log('ℹ️ No hay sesión, renderLogin()');
    renderLogin();
  }

  // Router: back/forward
  window.addEventListener('hashchange', () => {
    const v = getViewFromHash();
    console.log('🔄 hashchange ->', v);
    if (v) switchView(v);
  });
}

