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
