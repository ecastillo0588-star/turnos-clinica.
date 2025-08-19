// ui.js
export function buildLayout(user, me) {
  return `
    <div class="app">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-title">Gestión de Turnos</div>
          <div class="brand-sub">${user.email}</div>
        </div>

        <nav class="menu">
          <button class="menu-item" data-view="today">🗓️ Turnos de hoy</button>
          <button class="menu-item" data-view="new-appointment">➕ Nuevo turno</button>

          <div class="separator"></div>

          <button class="menu-item submenu-toggle" data-submenu="patients">
            Pacientes <span class="caret">▸</span>
          </button>
          <div class="submenu-items" id="submenu-patients">
            <button class="menu-subitem" data-view="new-patient">＋ Nuevo paciente</button>
            <button class="menu-subitem" data-view="patients">📋 Listado</button>
          </div>
        </nav>

        <div class="settings-slot">
          ${['propietario','medico'].includes(me.role)
            ? `<button class="btn settings-btn" data-view="config">⚙️ Configuración</button>`
            : ''}
        </div>

        <div style="padding:10px 8px 14px">
          <span class="badge" id="status">Listo</span>
          <button id="btn-logout" class="btn" style="width:100%; margin-top:10px">Cerrar sesión</button>
        </div>
      </aside>

      <main class="main">
        <div class="topbar">
          <h2 id="page-title">Turnos de hoy</h2>
          <button id="btn-home" class="btn" style="display:none">← Volver</button>
        </div>

        <!-- Nuevo Turno -->
        <section class="card hidden" id="view-new-appointment">
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

        <!-- Pacientes (Listado) -->
        <section class="card hidden" id="view-patients">
          <div class="toolbar">
            <input type="search" id="q" placeholder="Buscar por DNI, nombre o apellido…">
            <span class="muted" id="rows-count"></span>
          </div>
          <div class="table-wrap"><table id="tbl-pacientes"></table></div>
        </section>

        <!-- Turnos de hoy (Home) -->
        <section class="card" id="view-today">
          <h3>Turnos de hoy</h3>
          <div class="table-wrap"><table id="tbl-hoy"></table></div>
        </section>

        <!-- Configuración -->
        <section class="card hidden" id="view-config">
          <div id="settings-root"></div>
        </section>
      </main>
    </div>
  `;
}

export function bindLayoutHandlers({ switchView, onLogout }) {
  // Navegación por data-view (evita navegar si no hay data-view)
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view) switchView(view);
    });
  });

  // Toggle submenú Pacientes
  const toggle = document.querySelector('.submenu-toggle');
  const sub = document.getElementById('submenu-patients');
  toggle?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle.classList.toggle('open');
    sub?.classList.toggle('show');
  });

  // Botón volver (home)
  const homeBtn = document.getElementById('btn-home');
  homeBtn?.addEventListener('click', ()=> switchView('today'));

  // Logout (delegado al caller)
  document.getElementById('btn-logout')?.addEventListener('click', onLogout);
}
