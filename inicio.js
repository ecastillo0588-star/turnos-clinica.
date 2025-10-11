// payments.js
// Modal de pagos universal (ESM) para turnos.
// - Abre con openPagoModal({ turnoId, amount, confirmLabel, skipLabel, onPaid, onSkip })
// - También responde a CustomEvent 'payment:open' (bridge) con mismo detail.
// - Sube comprobante (opcional) a Storage 'turnos_pagos' y registra en tabla 'turnos_pagos'.
// - Incluye estilos inyectados y manejo de errores.
// Requisitos de DB/Storage:
//   * Tabla: turnos_pagos(id, turno_id, importe, medio_pago, fecha, comprobante_path, comprobante_mime)
//   * Storage bucket: 'turnos_pagos'
//   * RLS acorde a tu app.

import supabase from './supabaseClient.js';

// ==============================
// Helpers (dinero, DOM, únicos)
// ==============================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function toPesoInt(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^\d,-.]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (!isFinite(n)) return null;
  return Math.round(n);
}

function money(n) {
  const val = toPesoInt(n);
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(val ?? 0);
}

function once(fn) {
  let done = false;
  return (...args) => { if (done) return; done = true; return fn(...args); };
}

function nowISO() { return new Date().toISOString(); }

function sanitizeFileName(name = '') {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

// ==============================
// UI (creación modal y estilos)
// ==============================
let modalRoot = null;

function ensureStyles() {
  if ($('#payment-modal-styles')) return;
  const css = document.createElement('style');
  css.id = 'payment-modal-styles';
  css.textContent = `
  .pm-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35);display:none;align-items:center;justify-content:center;z-index:1200}
  .pm-backdrop.show{display:flex}
  .pm-modal{width:min(640px,92vw);background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.25);overflow:hidden;border:1px solid #ded7f2}
  .pm-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#f6f3ff;border-bottom:1px solid #eadfff}
  .pm-title{font-weight:700;color:#4b3a78;font-size:16px}
  .pm-close{border:0;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:#7861b5}
  .pm-body{padding:14px 16px;display:grid;gap:12px}
  .pm-row{display:grid;grid-template-columns:140px 1fr;align-items:center;gap:10px}
  .pm-row > label{color:#5b4a86;font-weight:600}
  .pm-inp, .pm-sel, .pm-file, .pm-ta{width:100%;box-sizing:border-box;border:1px solid #d8d0ef;border-radius:10px;padding:10px 12px;font-size:14px;outline:none}
  .pm-inp:focus, .pm-sel:focus, .pm-ta:focus{border-color:#7b5da7;box-shadow:0 0 0 3px rgba(123,93,167,.15)}
  .pm-hint{color:#6b6480;font-size:12px}
  .pm-actions{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #eee;background:#faf9ff}
  .pm-btn{border:0;border-radius:10px;padding:10px 14px;font-weight:600;cursor:pointer}
  .pm-btn.ok{background:#7b5da7;color:#fff}
  .pm-btn.ghost{background:#efeafc;color:#4b3a78}
  .pm-msg{min-height:18px;font-size:13px;margin-left:16px;color:#6b6480}
  .pm-msg.ok{color:#2e7d32}
  .pm-msg.warn{color:#b00020}
  .pm-spinner{display:none;width:18px;height:18px;border-radius:50%;border:2px solid #cdbef0;border-top-color:#7b5da7;animation:pmspin .8s linear infinite}
  .pm-busy .pm-spinner{display:inline-block}
  @keyframes pmspin{to{transform:rotate(360deg)}}
  `;
  document.head.appendChild(css);
}

function ensureModal() {
  if (modalRoot) return modalRoot;
  ensureStyles();

  modalRoot = document.createElement('div');
  modalRoot.className = 'pm-backdrop';
  modalRoot.innerHTML = `
    <div class="pm-modal" role="dialog" aria-modal="true" aria-labelledby="pm-title">
      <div class="pm-head">
        <div class="pm-title" id="pm-title">Registrar pago</div>
        <button class="pm-close" id="pm-x" aria-label="Cerrar">×</button>
      </div>
      <div class="pm-body">
        <div class="pm-row">
          <label>Importe</label>
          <input id="pm-amount" class="pm-inp" placeholder="$ 0" inputmode="numeric" />
        </div>
        <div class="pm-row">
          <label>Medio de pago</label>
          <select id="pm-medio" class="pm-sel">
            <option value="Efectivo">Efectivo</option>
            <option value="Débito">Débito</option>
            <option value="Crédito">Crédito</option>
            <option value="Transferencia">Transferencia</option>
            <option value="QR">QR</option>
            <option value="Otro">Otro</option>
          </select>
        </div>
        <div class="pm-row">
          <label>Comprobante</label>
          <input id="pm-file" class="pm-file" type="file" accept="image/*,.pdf" />
        </div>
        <div class="pm-row">
          <label>Notas</label>
          <textarea id="pm-notas" class="pm-ta" rows="2" placeholder="(opcional)"></textarea>
        </div>
        <div class="pm-hint">Podés dejar el comprobante vacío si no corresponde.</div>
      </div>
      <div class="pm-actions">
        <div class="pm-spinner" id="pm-spin"></div>
        <div class="pm-msg" id="pm-msg"></div>
        <button class="pm-btn ghost" id="pm-skip">Cerrar</button>
        <button class="pm-btn ok" id="pm-confirm">Registrar pago</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalRoot);

  // Cierres
  $('#pm-x', modalRoot).onclick = () => closeModal();
  modalRoot.addEventListener('click', (e) => { if (e.target === modalRoot) closeModal(); });

  return modalRoot;
}

function setBusy(on) {
  const modal = $('.pm-modal', modalRoot);
  if (!modal) return;
  modal.classList.toggle('pm-busy', !!on);
}

function setMsg(text, tone = '') {
  const m = $('#pm-msg', modalRoot);
  if (!m) return;
  m.textContent = text || '';
  m.className = 'pm-msg' + (tone ? ' ' + tone : '');
}

function closeModal() {
  if (!modalRoot) return;
  modalRoot.classList.remove('show');
  setTimeout(() => {
    // limpiar campos para próxima apertura
    $('#pm-amount', modalRoot).value = '';
    $('#pm-medio', modalRoot).value = 'Efectivo';
    $('#pm-file', modalRoot).value = '';
    $('#pm-notas', modalRoot).value = '';
    setMsg('');
  }, 50);
}

// =====================================
// Lógica principal (abrir / guardar)
// =====================================
let currentCtx = null; // { turnoId, amount, confirmLabel, skipLabel, onPaid, onSkip }

async function persistPayment({ turnoId, amount, medio, file, notas }) {
  // 1) (Opcional) Subida de comprobante
  let comprobante_path = null;
  let comprobante_mime = null;

  if (file) {
    const base = sanitizeFileName(file.name || 'archivo');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `${String(turnoId)}/${stamp}_${base}`;

    const { error: uErr } = await supabase
      .storage
      .from('turnos_pagos')
      .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });

    if (uErr) throw new Error(uErr.message || 'No se pudo subir el comprobante.');

    comprobante_path = path;
    comprobante_mime = file.type || null;
  }

  // 2) Insert en tabla
  const payload = {
    turno_id: turnoId,
    importe: amount,
    medio_pago: medio || 'Efectivo',
    fecha: nowISO(),
    comprobante_path,
    comprobante_mime,
    // Si querés guardar notas del pago, descomenta y agrega la columna:
    // notas,
  };

  const { error: iErr } = await supabase
    .from('turnos_pagos')
    .insert([payload]);

  if (iErr) throw new Error(iErr.message || 'No se pudo registrar el pago.');

  return { comprobante_path, comprobante_mime };
}

function bindModalHandlers() {
  const btnOk   = $('#pm-confirm', modalRoot);
  const btnSkip = $('#pm-skip', modalRoot);

  btnOk.onclick = async () => {
    if (!currentCtx?.turnoId) { setMsg('Falta turno.', 'warn'); return; }

    const rawAmount = $('#pm-amount', modalRoot).value;
    const amount = toPesoInt(rawAmount);
    const medio  = $('#pm-medio', modalRoot).value || 'Efectivo';
    const file   = $('#pm-file', modalRoot).files?.[0] || null;
    const notas  = $('#pm-notas', modalRoot).value?.trim() || null;

    if (!amount || amount <= 0) {
      setMsg('Ingresá un importe válido.', 'warn');
      return;
    }

    try {
      setBusy(true);
      setMsg('Guardando...');
      const { comprobante_path, comprobante_mime } = await persistPayment({
        turnoId: currentCtx.turnoId, amount, medio, file, notas
      });

      setMsg('Pago registrado ✓', 'ok');

      // Callback post-pago
      try { currentCtx?.onPaid?.({ importe: amount, medio, comprobante_path, comprobante_mime }); } catch {}

      // Cerramos luego de un pequeño delay
      setTimeout(() => closeModal(), 300);
    } catch (e) {
      setMsg(e?.message || 'Error registrando el pago.', 'warn');
    } finally {
      setBusy(false);
    }
  };

  btnSkip.onclick = () => {
    try { currentCtx?.onSkip?.(); } catch {}
    closeModal();
  };
}

/**
 * Abre el modal de pago (programáticamente).
 * @param {Object} options
 * @param {string|number} options.turnoId - ID del turno (obligatorio)
 * @param {number|null} options.amount - Importe sugerido (opcional)
 * @param {string} options.confirmLabel - Texto del botón confirmar
 * @param {string} options.skipLabel - Texto del botón cerrar/omitir
 * @param {function} options.onPaid - Callback { importe, medio, comprobante_path, comprobante_mime }
 * @param {function} options.onSkip - Callback si cierra sin pagar
 */
export function openPagoModal({
  turnoId,
  amount = null,
  confirmLabel = 'Registrar pago',
  skipLabel = 'Cerrar',
  onPaid = null,
  onSkip = null
} = {}) {
  if (!turnoId) {
    console.warn('[openPagoModal] turnoId es requerido');
    return;
  }
  ensureModal();

  currentCtx = { turnoId, amount, confirmLabel, skipLabel, onPaid, onSkip };

  // Prefill
  $('#pm-title',  modalRoot).textContent = 'Registrar pago';
  $('#pm-amount', modalRoot).value = amount != null ? String(amount) : '';
  $('#pm-confirm', modalRoot).textContent = confirmLabel || 'Registrar pago';
  $('#pm-skip',    modalRoot).textContent = skipLabel   || 'Cerrar';
  setMsg('');

  // Mostrar
  modalRoot.classList.add('show');

  // Foco inicial
  setTimeout(() => { $('#pm-amount', modalRoot)?.focus?.(); }, 30);
}

// Alias en inglés (compat)
export const openPaymentModal = openPagoModal;

// =====================================
// Bridge por data-atributos y por evento
// =====================================
let bridgeBound = false;
export function initPaymentsBridge() {
  ensureModal();
  if (!bridgeBound) {
    bridgeBound = true;

    // Atajos en la UI con data-open-pago
    $$('#[data-open-pago]').forEach(btn => {
      if (btn._pagoInit) return;
      btn._pagoInit = true;
      btn.addEventListener('click', () => {
        const turnoId = btn.getAttribute('data-open-pago');
        if (!turnoId) return;
        openPagoModal({ turnoId });
      });
    });

    // Escucha del bridge por evento (compat con openPaymentBridge de otros módulos)
    const handler = (ev) => {
      const d = ev?.detail || {};
      // d: { turnoId, amount, confirmLabel, skipLabel, onPaid, onSkip }
      openPagoModal(d);
    };
    // Evitar múltiples listeners
    document.removeEventListener('payment:open', handler);
    document.addEventListener('payment:open', handler);
  }

  // Handlers del modal (confirm/skip)
  bindModalHandlers();
}

// Auto-init perezoso si el módulo se importa y hay botones/bridge
setTimeout(() => { try { initPaymentsBridge(); } catch {} }, 0);
