// 1. Inicialización de Supabase (poné tus claves reales)
const supabase = createClient('https://TU_SUPABASE_URL.supabase.co', 'TU_SUPABASE_ANON_KEY');

// 2. Renderiza el formulario de login
function renderLogin() {
  document.body.innerHTML = `
    <form id="login-form" style="margin:50px auto;max-width:350px;padding:24px;border:1px solid #eee;border-radius:8px;">
      <h2>Login</h2>
      <input type="email" id="email" placeholder="Email" required style="width:100%;margin-bottom:10px;padding:8px;" />
      <input type="password" id="password" placeholder="Contraseña" required style="width:100%;margin-bottom:10px;padding:8px;" />
      <button type="submit" style="width:100%;padding:8px;">Ingresar</button>
    </form>
  `;

  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email || !password) {
      alert('Por favor, completa ambos campos.');
      return;
    }

    // Llama a Supabase para autenticación
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      alert('Error: ' + error.message);
      console.error(error);
      return;
    }

    if (data && data.session && data.user) {
      // Sesión exitosa
      renderApp(data.user);
    } else {
      alert('No se pudo iniciar sesión. Intenta de nuevo.');
    }
  });
}

// 3. Renderiza la app si el login fue exitoso
function renderApp(user) {
  // Acá ponés tu lógica real. Ejemplo básico:
  document.body.innerHTML = `
    <h1>Bienvenido, ${user.email}</h1>
    <button id="logout">Cerrar sesión</button>
    <div id="dashboard">
      <!-- Aquí iría tu dashboard real -->
      <p>Acá va la lógica de tu app.</p>
    </div>
  `;

  document.getElementById('logout').onclick = async () => {
    await supabase.auth.signOut();
    renderLogin();
  };
}

// 4. Arranque inicial: chequea sesión y muestra login o app
async function bootstrap() {
  // Obtiene la sesión actual
  const { data } = await supabase.auth.getSession();
  if (data.session && data.session.user) {
    renderApp(data.session.user);
  } else {
    renderLogin();
  }

  // Escucha cambios de sesión, por si el usuario cierra sesión en otro tab
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session && session.user) {
      renderApp(session.user);
    } else {
      renderLogin();
    }
  });
}

// 5. Ejecuta bootstrap al cargar la página
bootstrap();
