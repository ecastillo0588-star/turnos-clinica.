// payments.js
// Modal de cobro reutilizable para Inicio/Turnos
// Requiere: supabaseClient.js (ESM)
// Bucket de storage: 'turnos_pagos'

import supabase from './supabaseClient.js';

const BUCKET = 'turnos_pagos';

// ------------------------------
// Utils
// ------------------------------
const toPesoInt = (v) => {
  if (v == null) return null;
  const s = String(v).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(n);
};

const money = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
    .format(Math.max(0, Math.round(n || 0)));

async function getUserId() {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id || null;
  } catch { return null; }
}

async function fetchTurnoCopago(turnoId) {
  const { data, error } = await supabase
    .from('turnos')
    .select('copago')
    .eq('id', turnoId)
    .maybeSingle();
  if (error) throw error;
  return Number(data?.copago || 0);
}

async function fetchPagado(turnoId) {
  const { data, error } = await supabase
    .from('turnos_pagos')
    .select('importe')
    .eq('turno_id', turnoId);
  if (error) throw error;
  return (data || []).reduce((a, r) => a + Number(r.importe || 0), 0);
}

function buildPath(turnoId, file) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const ts = Date.now();
  const safe = (file?.name || 'archivo').replace(/\s+/g, '_');
  return `${turnoId}/${yyyy}/${mm}/${dd}/${ts}__${safe}`;
}

async function uploadComprobante(file, path) {
  if (!file) return { path: null, meta: {} };
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    });
  if (error) throw error;

  // meta simple (si querés sha256 lo agregamos después)
  return {
    path: data?.path || path,
    meta: {
      comprobante_mime: file.type || null,
      comprobante_size: file.size || null,
      comprobante_filename: file.name || null,
    }
  };
}

// ------------------------------
// Modal
// ------------------------------
function buildModalDOM() {
  // Contenedor + estilos mínimos inline (para que funcione incluso sin CSS global)
  const backdrop = document.createElement('div');
  backdrop.className = 'pm-backdrop';
  backdrop.style.cssText = `
    position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    background:rgba(0,0,0,.35); z-index:9999;
  `;

  const modal = document.createElement('div');
  modal.className = 'pm-modal';
  modal.role = 'dialog';
  modal.ariaModal = 'true';
  modal.style.cssText = `
    background:#fff; border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,.2);
    width:min(560px, calc(100vw - 24px)); max-width:560px; padding:16px 16px 12px; position:relative;
    font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell, Noto Sans, sans-serif;
  `;

  // header
  const header = document.createElement('div');
  header.style.cssText = "display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;";
  const title = document.createElement('h3');
  title.textContent = 'Registrar pago';
  title.style.cssText = "margin:0; font-size:18px; color:#3c2a72;";
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.title = 'Cerrar';
  closeBtn.style.cssText = `
    border:none; background:transparent; font-size:24px; line-height:1; cursor:pointer; color:#444;
  `;
  header.appendChild(title);
  header.appendChild(closeBtn);

  // info
  const info = document.createElement('div');
  info.id = 'pm-info';
  info.style.cssText = `
    background:#f6f2ff; color:#46317a; border:1px solid #e6ddff; padding:8px 10px; border-radius:8px;
    margin-bottom:12px; font-size:14px;
  `;
  info.textContent = '…';

  // form
  const form = document.createElement('div');
  form.style.cssText = "display:grid; grid-template-columns: 1fr 1fr; gap:12px;";

  const gImporte = document.createElement('div');
  gImporte.innerHTML = `<label style="display:block;font-weight:600;margin-bottom:4px;">Importe</label>`;
  const inpImporte = document.createElement('input');
  inpImporte.type = 'text';
  inpImporte.inputMode = 'numeric';
  inpImporte.placeholder = '$ 0';
  inpImporte.className = 'pm-inp';
  inpImporte.style.cssText = "width:100%; padding:8px 10px; border-radius:8px; border:1px solid #ccc;";
  gImporte.appendChild(inpImporte);

  const gMedio = document.createElement('div');
  gMedio.innerHTML = `<label style="display:block;font-weight:600;margin-bottom:4px;">Medio de pago</label>`;
  const selMedio = document.createElement('select');
  selMedio.className = 'pm-sel';
  selMedio.style.cssText = "width:100%; padding:8px 10px; border-radius:8px; border:1px solid #ccc; background:#fff;";
  selMedio.innerHTML = `
    <option value="" selected disabled>Elija una forma de pago</option>
    <option value="efectivo">Efectivo</option>
    <option value="transferencia">Transferencia</option>
  `;
  gMedio.appendChild(selMedio);

  const gNota = document.createElement('div');
  gNota.style.gridColumn = '1 / -1';
  gNota.innerHTML = `<label style="display:block;font-weight:600;margin-bottom:4px;">Nota (opcional)</label>`;
  const taNota = document.createElement('textarea');
  taNota.rows = 3;
  taNota.className = 'pm-note';
  taNota.placeholder = 'Observaciones…';
  taNota.style.cssText = "width:100%; padding:8px 10px; border-radius:8px; border:1px solid #ccc; resize:vertical;";
  gNota.appendChild(taNota);

  const gFile = document.createElement('div');
  gFile.style.gridColumn = '1 / -1';
  gFile.innerHTML = `<label style="display:block;font-weight:600;margin-bottom:4px;">Comprobante (PDF o imagen) — opcional</label>`;
  const inpFile = document.createElement('input');
  inpFile.type = 'file';
  inpFile.accept = "application/pdf,image/*";
  gFile.appendChild(inpFile);

  form.appendChild(gImporte);
  form.appendChild(gMedio);
  form.appendChild(gNota);
  form.appendChild(gFile);

  // footer
  const footer = document.createElement('div');
  footer.style.cssText = "display:flex; gap:8px; justify-content:flex-end; margin-top:12px;";
  const btnCancel = document.createElement('button');
  btnCancel.textContent = 'Cancelar';
  btnCancel.className = 'pm-cancel';
  btnCancel.style.cssText = "padding:8px 14px; border-radius:8px; border:1px solid #bbb; background:#fff; cursor:pointer;";
  const btnOk = document.createElement('button');
  btnOk.textContent = 'Guardar pago';
  btnOk.className = 'pm-ok';
  btnOk.style.cssText = "padding:8px 14px; border-radius:8px; border:none; background:#6c4cc9; color:#fff; cursor:pointer;";

  footer.appendChild(btnCancel);
  footer.appendChild(btnOk);

  modal.appendChild(header);
  modal.appendChild(info);
  modal.appendChild(form);
  modal.appendChild(footer);
  backdrop.appendChild(modal);

  return {
    backdrop, modal, closeBtn, info,
    inpImporte, selMedio, taNota, inpFile,
    btnCancel, btnOk
  };
}

// ------------------------------
// API principal
// ------------------------------
/**
 * Abre el modal de pago.
 * @param {Object} opts
 * @param {string} opts.turnoId               - ID del turno (obligatorio)
 * @param {number|null} [opts.copagoTotal]    - Copago del turno (opcional; si no viene, lo lee)
 * @param {number|null} [opts.defaultImporte] - Sugerencia de importe inicial
 * @param {Function} [opts.onSaved]           - Callback({ pagoId, totalPagado, pendiente })
 * @returns {Promise<{saved:boolean, pagoId?:string}>}
 */
export async function openPaymentModal({ turnoId, copagoTotal = null, defaultImporte = null, onSaved } = {}) {
  if (!turnoId) throw new Error('turnoId es requerido');

  // Construir UI
  const ui = buildModalDOM();
  document.body.appendChild(ui.backdrop);

  // estado
  let saving = false;
  let cleanup;

  // helpers cierre
  const close = (result = { saved: false }) => {
    if (cleanup) cleanup();
    try { ui.backdrop.remove(); } catch {}
    return result;
  };

  // validar y toggle botón
  function validate() {
    const imp = toPesoInt(ui.inpImporte.value);
    const medio = ui.selMedio.value || '';
    const ok = !!imp && medio !== '';
    ui.btnOk.disabled = !ok || saving;
    return ok;
  }

  // pre-carga de info (copago/pagado)
  const copago = (copagoTotal != null) ? Number(copagoTotal) : await fetchTurnoCopago(turnoId);
  const pagado = await fetchPagado(turnoId);
  const pendiente = Math.max(0, copago - pagado);

  // pintar info
  ui.info.textContent =
    copago > 0
      ? `Total copago: ${money(copago)} · Pagado: ${money(pagado)} · Pendiente: ${money(pendiente)}`
      : `Sin copago informado para este turno.`;

  // set defaults
  if (defaultImporte != null) {
    ui.inpImporte.value = String(defaultImporte);
  } else {
    if (pendiente > 0) ui.inpImporte.value = String(pendiente);
  }
  validate();

  // event listeners
  const onBackdropClick = (e) => { if (e.target === ui.backdrop && !saving) resolve(close({ saved:false })); };
  const onEsc = (e) => { if (e.key === 'Escape' && !saving) resolve(close({ saved:false })); };
  const onInput = () => validate();

  let resolve; // promise resolver

  ui.backdrop.addEventListener('click', onBackdropClick);
  document.addEventListener('keydown', onEsc);
  ui.inpImporte.addEventListener('input', onInput);
  ui.selMedio.addEventListener('change', onInput);

  ui.closeBtn.onclick = () => { if (!saving) resolve(close({ saved:false })); };
  ui.btnCancel.onclick = () => { if (!saving) resolve(close({ saved:false })); };

  ui.btnOk.onclick = async () => {
    if (saving) return;
    if (!validate()) return;

    const importe = toPesoInt(ui.inpImporte.value);
    const medio = ui.selMedio.value;
    const nota = (ui.taNota.value || '').trim();
    const file = ui.inpFile.files?.[0] || null;

    try {
      saving = true; ui.btnOk.disabled = true; ui.btnCancel.disabled = true; ui.closeBtn.disabled = true;
      ui.btnOk.textContent = 'Guardando…';

      // 1) upload (opcional)
      let up = { path: null, meta: {} };
      if (file) {
        const path = buildPath(turnoId, file);
        up = await uploadComprobante(file, path);
      }

      // 2) user id
      const uid = await getUserId();

      // 3) insert pago
      const payload = {
        turno_id: turnoId,
        importe,
        medio_pago: medio,          // 'efectivo' | 'transferencia'
        nota: nota || null,

        // metadata del comprobante
        comprobante_path: up.path,
        comprobante_mime: up.meta.comprobante_mime || null,
        comprobante_size: up.meta.comprobante_size || null,
        comprobante_filename: up.meta.comprobante_filename || null,

        // quién registró y quién subió (si hay auth)
        registrado_por: uid,
        comprobante_subido_por: uid,
      };

      const { data, error } = await supabase
        .from('turnos_pagos')
        .insert([payload])
        .select('id')
        .single();

      if (error) throw error;

      // 4) recomputar totales
      const nuevoPagado = await fetchPagado(turnoId);
      const nuevoPend = Math.max(0, copago - nuevoPagado);

      // callback opcional
      onSaved?.({ pagoId: data?.id, totalPagado: nuevoPagado, pendiente: nuevoPend });

      resolve(close({ saved: true, pagoId: data?.id }));
    } catch (err) {
      console.error('[payments] insert/upload error:', err);
      alert(err?.message || 'No se pudo registrar el pago.');
      saving = false; ui.btnOk.disabled = !validate(); ui.btnCancel.disabled = false; ui.closeBtn.disabled = false;
      ui.btnOk.textContent = 'Guardar pago';
    }
  };

  cleanup = () => {
    ui.backdrop.removeEventListener('click', onBackdropClick);
    document.removeEventListener('keydown', onEsc);
    ui.inpImporte.removeEventListener('input', onInput);
    ui.selMedio.removeEventListener('change', onInput);
  };

  // focus inicial
  setTimeout(() => ui.inpImporte.focus(), 0);

  return new Promise((res) => { resolve = res; });
}
