// app.js

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 👇 Tus credenciales Supabase
const SUPABASE_URL = "https://vwkszvdvswznlgxlfdtz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3a3N6dmR2c3d6bmxneGxmZHR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU1NDM4NDQsImV4cCI6MjA3MTExOTg0NH0.TnDGheCSTUqGwTCMiHZ_CUgcAztCqVTc1cINkMud8p0";

// Cliente Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helpers
const $ = (s) => document.querySelector(s);

function renderApp(user) {
  document.body.innerHTML = `
    <div class="app">
      <header>
        <h1>Gestión de Turnos</h1>
        <div>
          <span style="margin-right:10px;font-size:14px;opacity:.8">
            Sesión: ${user.email}
          </span>
          <button id="btn-logout" class="btn">Cerrar sesión</button>
        </div>
      </header>

      <p>✅ Login correcto. Pronto: panel de pacientes, turnos, médicos y centros.</p>
    </div>
  `;
  $('#btn-logout').addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.reload();
  });
}

// Evento del login
$('#login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#email').value.trim();
  const password = $('#password').value.trim();
  $('#error-message').textContent = 'Ingresando…';
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    $('#error-message').textContent = error.message;
  } else {
    $('#error-message').textContent = '';
    renderApp(data.user);
  }
});

// Mantener sesión si ya estaba logueado
(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) renderApp(session.user);
})();
