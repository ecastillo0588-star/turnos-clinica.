// src/payments.js
// ----------------------------------------------------------------------------------
// Módulo de pagos: modal + bridge por evento.
// - openPaymentModal(opts)  -> abre modal y registra pago en turnos_pagos
// - openPagoModal           -> alias
// - initPaymentsBridge()    -> escucha 'payment:open' + [data-open-pago]
//
// Requisitos de HTML (ids):
//   #pay-modal (backdrop), #pay-title, #pay-importe, #pay-medio, #pay-comp,
//   #pay-confirm, #pay-skip, #pay-close
// ----------------------------------------------------------------------------------

import supabase from './supabaseClient.js';

/* ====================== Utils básicos ====================== */
const $ = (id) => document.getElementById(id);

const toIntARS = (v) => {
  if (v === '' || v == null) return null;
  const s = String(v).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
};

// Total pagado de un turno
async function getTotalPagado(turnoId) {
  const { data = [], error } = await supabase
    .from('turnos_pagos')
    .select('importe')
    .eq('turno_id', turnoId);

  if (error) {
    console.warn('[payments] getTotalPagado error:', error.message);
    return 0;
  }
  return (data || []).reduce((a, r) => a + Number(r.importe || 0), 0);
}

// Copago configurado del turno
async function getCopago(turnoId) {
  const { data, error } = await supabase
    .from('turnos')
    .select('copago')
    .eq('id', turnoId)
    .maybeSingle();

  if (error) {
    console.warn('[payments] getCopago error:', error.message);
    return 0;
  }
  const v = Number(data?.copago || 0);
  return Number.isFinite(v) ? v : 0;
}

// Subir comprobante (opcional) a Storage (bucket: turnos_pagos)
async function uploadComprobante(file, turnoId) {
  if (!file) return { path: null, mime: null };
  const ts = Date.now();
  const safeName = (file.name || 'comp').replace(/\s+/g, '_');
  const path = `${turnoId}/${ts}_${safeName}`;

  const { error } = await supabase.storage
    .from('turnos_pagos')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    });

  if (error) throw error;
  return { path, mime: file.type || null };
}

/* ====================== Modal principal ====================== */
/**
 * Abre el modal de pago y guarda en turnos_pagos.
 * @param {Object} opts
 * @param {string|number} opts.turnoId                  (requerido)
 * @param {number|null}   [opts.defaultImporte=null]    sugerido (si no se pasa, se calcula)
 * @param {string}        [opts.confirmLabel='Registrar pago']
 * @param {string}        [opts.skipLabel='Cerrar']
 * @param {Function}      [opts.onSaved]                callback({ importe, medio })
 * @param {Function}      [opts.onCancel]               callback()
 */
export async function openPaymentModal(opts = {}) {
  const {
    turnoId,
    defaultImporte = null,
    confirmLabel = 'Registrar pago',
    skipLabel = 'Cerrar',
    onSaved = null,
    onCancel = null,
  } = opts;

  if (!turnoId) {
    console.warn('[payments] turnoId es requerido');
    return;
  }

  // Referencias UI
  const modal   = $('pay-modal');
  const title   = $('pay-title');
  const input   = $('pay-importe');
  const medio   = $('pay-medio');
  const comp    = $('pay-comp');     // <input type="file">
  const btnOk   = $('pay-confirm');
  const btnSkip = $('pay-skip');
  const btnX    = $('pay-close');

  if (!modal || !input || !medio || !btnOk || !btnSkip) {
    alert('Falta el HTML del modal de pagos (#pay-*)');
    return;
  }

  // Etiquetas
  if (title) title.textContent = 'Registrar pago';
  btnOk.textContent   = confirmLabel;
  btnSkip.textContent = skipLabel;

  // Sugerencia de importe
  let sugerido = defaultImporte;
  if (sugerido == null) {
    const [cop, pag] = await Promise.all([
      getCopago(turnoId),
      getTotalPagado(turnoId),
    ]);
    const pendiente = Math.max(0, Number(cop || 0) - Number(pag || 0));
    sugerido = pendiente || 0;
  }
  input.value = sugerido ? String(sugerido) : '';

  // Abrir / cerrar
  const open  = () => (modal.style.display = 'flex');
  const close = () => (modal.style.display = 'none');
  open();

  // Limpieza de listeners
  const cleanup = () => {
    btnOk.removeEventListener('click', onOk);
    btnSkip.removeEventListener('click', onSkip);
    btnX?.removeEventListener('click', onSkip);
    window.removeEventListener('click', onBackdrop);
  };
  const onBackdrop = (e) => {
    if (e.target === modal) {
      cleanup();
      close();
      onCancel?.();
    }
  };
  const onSkip = () => {
    cleanup();
    close();
    onCancel?.();
  };

  async function onOk() {
    btnOk.disabled = true;
    try {
      const importe = toIntARS(input.value);
      const medioPago = medio.value || null;

      if (!importe || importe <= 0) {
        alert('Importe inválido.');
        btnOk.disabled = false;
        return;
      }
      if (!medioPago) {
        alert('Elegí un medio de pago.');
        btnOk.disabled = false;
        return;
      }

      // Comprobante (opcional)
      let compPath = null, compMime = null;
      try {
        const file = comp?.files?.[0];
        if (file) {
          const up = await uploadComprobante(file, turnoId);
          compPath = up.path;
          compMime = up.mime;
        }
      } catch (e) {
        console.warn('[payments] upload warn:', e?.message || e);
        // no bloqueamos el guardado si falla la subida
      }

      // Insert pago
      const payload = {
        turno_id: turnoId,
        importe,
        medio_pago: medioPago,
        fecha: new Date().toISOString(),
        comprobante_path: compPath,
        comprobante_mime: compMime,
      };

      const { error } = await supabase.from('turnos_pagos').insert([payload]);
      if (error) throw error;

      cleanup();
      close();
      onSaved?.({ importe, medio: medioPago });
    } catch (e) {
      console.error('[payments] save error:', e);
      alert(e?.message || 'No se pudo guardar el pago.');
    } finally {
      btnOk.disabled = false;
    }
  }

  btnOk.addEventListener('click', onOk);
  btnSkip.addEventListener('click', onSkip);
  btnX?.addEventListener('click', onSkip);
  window.addEventListener('click', onBackdrop);
}

// Alias
export { openPaymentModal as openPagoModal };

/* ====================== Bridge de inicialización ====================== */
// - Escucha CustomEvent('payment:open', { detail:{ turnoId, amount, confirmLabel, skipLabel, onPaid, onSkip } })
// - Auto-engancha botones con [data-open-pago="{turnoId}"]

let _bridgeInit = false;

export function initPaymentsBridge() {
  if (_bridgeInit) return;
  _bridgeInit = true;

  // 1) Bridge por evento
  document.addEventListener('payment:open', async (ev) => {
    const d = ev?.detail || {};
    if (!d.turnoId) return;

    await openPaymentModal({
      turnoId: d.turnoId,
      defaultImporte: d.amount ?? null,
      confirmLabel: d.confirmLabel || 'Registrar pago',
      skipLabel: d.skipLabel || 'Cerrar',
      onSaved: d.onPaid || null,
      onCancel: d.onSkip || null,
    });
  });

  // 2) Botones declarativos
  document.querySelectorAll('[data-open-pago]').forEach((btn) => {
    if (btn._pagoInit) return;
    btn._pagoInit = true;
    btn.addEventListener('click', async () => {
      const turnoId = btn.getAttribute('data-open-pago');
      if (!turnoId) return;
      await openPaymentModal({ turnoId });
    });
  });
}
