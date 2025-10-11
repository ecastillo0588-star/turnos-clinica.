// payments.js
// Modal de pagos que usa payment-modal.html (template #tpl-modal-pago en #modal-root)
import supabase from './supabaseClient.js';

/* ============= Helpers dinero/fecha ============= */
const toInt = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^\d,-.]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
};
const isoNow = () => new Date().toISOString();

/* ============= Estado interno ============= */
let _mounted = null;     // {root, elBackdrop, elModal, refs:{...}}
let _bridgeInit = false;

/* ============= DOM mounting desde template ============= */
function ensureModalMounted() {
  const root = document.getElementById('modal-root');
  const tpl  = document.getElementById('tpl-modal-pago');
  if (!root || !tpl) throw new Error('Falta payment-modal.html (div#modal-root y template#tpl-modal-pago)');

  // Si ya está montado y visible, lo reutilizamos
  if (_mounted?.root === root) {
    return _mounted;
  }

  // Limpieza previa
  root.innerHTML = '';

  const frag = tpl.content.cloneNode(true);
  root.appendChild(frag);

  const elBackdrop = root.querySelector('.modal-backdrop');
  const elModal    = root.querySelector('.modal');

  const refs = {
    close: elModal.querySelector('.modal-close'),
    info:  elModal.querySelector('#pay-info'),

    imp:   elModal.querySelector('#pay-importe'),
    medio: elModal.querySelector('#pay-medio'),
    nota:  elModal.querySelector('#pay-nota'),

    file:       elModal.querySelector('#pay-file'),
    fileHint:   elModal.querySelector('#pay-file-hint'),
    prevWrap:   elModal.querySelector('#pay-file-preview'),
    prevImg:    elModal.querySelector('#pay-preview-img'),
    prevPdf:    elModal.querySelector('#pay-preview-pdf'),

    btnCancel:  elModal.querySelector('#btn-cancel'),
    btnConfirm: elModal.querySelector('#btn-confirm'),
  };

  _mounted = { root, elBackdrop, elModal, refs };
  return _mounted;
}

function openUI()  { if (_mounted) _mounted.elBackdrop.style.display = 'block'; }
function closeUI() { if (_mounted) _mounted.elBackdrop.style.display = 'none'; }

/* ============= Cálculos de pagos ============= */
async function getCopago(turnoId) {
  const { data, error } = await supabase
    .from('turnos')
    .select('copago')
    .eq('id', turnoId)
    .maybeSingle();
  if (error) throw error;
  return toInt(data?.copago) ?? 0;
}

async function getTotalPagado(turnoId) {
  const { data = [], error } = await supabase
    .from('turnos_pagos')
    .select('importe')
    .eq('turno_id', turnoId);
  if (error) throw error;
  return (data || []).reduce((a, r) => a + (toInt(r.importe) || 0), 0);
}

/* ============= Upload de comprobante ============= */
async function uploadComprobante(turnoId, file) {
  if (!file) return { path: null, mime: null };

  const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(0, 140);
  const folder   = String(turnoId);
  const key      = `${folder}/${Date.now()}_${safeName}`;

  const { data, error } = await supabase
    .storage
    .from('turnos_pagos')        // <-- Bucket
    .upload(key, file, { upsert: false, contentType: file.type || undefined });

  if (error) throw error;
  return { path: data?.path || key, mime: file.type || null };
}

/* ============= Inserción DB (con fallback por columna "nota") ============= */
async function insertPago({ turnoId, importe, medio, nota, compPath, compMime }) {
  const baseRow = {
    turno_id: turnoId,
    importe,               // INTEGER / NUMERIC
    medio_pago: medio,     // TEXT
    fecha: isoNow(),       // timestamp/iso (la vista que ordena por fecha lo aceptará)
    comprobante_path: compPath || null,
    comprobante_mime: compMime || null,
  };

  // Intento con nota, por si la tabla la tiene
  try {
    const { error } = await supabase.from('turnos_pagos').insert([{ ...baseRow, nota: (nota || null) }]);
    if (error) throw error;
    return;
  } catch (e) {
    // Si la columna "nota" no existe, reintento sin ella
    const noSuchCol = typeof e?.message === 'string' && /column .*nota.* does not exist/i.test(e.message);
    if (!noSuchCol) throw e;
    const { error: e2 } = await supabase.from('turnos_pagos').insert([baseRow]);
    if (e2) throw e2;
  }
}

/* ============= Preview archivo en UI ============= */
function wireFilePreview(refs) {
  const { file, fileHint, prevWrap, prevImg, prevPdf } = refs;
  if (!file) return;

  file.onchange = () => {
    const f = file.files?.[0] || null;
    if (!f) {
      prevWrap.style.display = 'none';
      prevImg.style.display = 'none';
      prevPdf.style.display = 'none';
      fileHint.textContent  = '';
      return;
    }
    prevWrap.style.display = 'block';
    const isImg = (f.type || '').startsWith('image/');
    prevImg.style.display = isImg ? 'block' : 'none';
    prevPdf.style.display = isImg ? 'none'  : 'block';
    fileHint.textContent  = `${f.name} · ${(f.size/1024).toFixed(1)} KB`;

    if (isImg) {
      const reader = new FileReader();
      reader.onload = () => { prevImg.src = reader.result; };
      reader.readAsDataURL(f);
    } else {
      prevImg.removeAttribute('src');
    }
  };
}

/* ============= Abrir modal programáticamente ============= */
/**
 * openPagoModal
 * @param {{
 *   turnoId:number|string,
 *   defaultImporte?:number|null,
 *   confirmLabel?:string,
 *   skipLabel?:string,
 *   onSaved?:Function,
 *   onSkip?:Function
 * }} opts
 */
export async function openPagoModal(opts = {}) {
  const { turnoId } = opts;
  if (!turnoId) throw new Error('openPagoModal: falta turnoId');

  const ui = ensureModalMounted();
  const { refs, elBackdrop } = ui;

  // Textos botones (si vienen del bridge)
  if (opts.confirmLabel) refs.btnConfirm.textContent = opts.confirmLabel;
  else refs.btnConfirm.textContent = 'Guardar pago';

  if (opts.skipLabel) refs.btnCancel.textContent = opts.skipLabel;
  else refs.btnCancel.textContent = 'Cancelar';

  // Sugerir importe
  refs.imp.value = '';
  refs.medio.value = refs.medio.options?.[0]?.value || '';
  refs.nota.value = '';

  try {
    const sugerido =
      opts.defaultImporte != null
        ? toInt(opts.defaultImporte)
        : (await (async () => {
            const cop = await getCopago(turnoId);
            const pag = await getTotalPagado(turnoId);
            const pen = Math.max(0, cop - pag);
            return pen || cop || 0;
          })());
    if (sugerido != null) refs.imp.value = String(sugerido);
    // info box opcional
    if (refs.info) {
      const cop = await getCopago(turnoId).catch(() => null);
      const pag = await getTotalPagado(turnoId).catch(() => null);
      const pen = cop != null && pag != null ? Math.max(0, cop - pag) : null;
      refs.info.style.display = 'block';
      refs.info.textContent =
        (cop != null && pag != null)
          ? `Copago: $${cop.toLocaleString('es-AR')} · Pagado: $${pag.toLocaleString('es-AR')} · Pendiente: $${pen.toLocaleString('es-AR')}`
          : 'Ingrese el pago y medio.';
    }
  } catch {
    if (refs.info) { refs.info.style.display = 'block'; refs.info.textContent = 'Ingrese el pago y medio.'; }
  }

  // Preview archivo
  wireFilePreview(refs);

  // Mostrar
  openUI();

  // Cerrar por backdrop
  const onBackdrop = (e) => { if (e.target === elBackdrop) doCancel(); };
  elBackdrop.addEventListener('click', onBackdrop);

  // Acciones
  const doCancel = () => {
    cleanup();
    closeUI();
    if (typeof opts.onSkip === 'function') opts.onSkip();
  };

  const doConfirm = async () => {
    refs.btnConfirm.disabled = true;
    refs.btnCancel.disabled  = true;

    try {
      const importe = toInt(refs.imp.value);
      const medio   = (refs.medio.value || '').trim();
      const nota    = (refs.nota?.value || '').trim();

      if (!importe || importe <= 0) { alert('Importe inválido'); return; }
      if (!medio) { alert('Seleccioná el medio de pago'); return; }

      // Upload (si hay)
      let compPath = null, compMime = null;
      const chosen = refs.file?.files?.[0] || null;
      if (chosen) {
        const up = await uploadComprobante(turnoId, chosen);
        compPath = up.path; compMime = up.mime;
      }

      // Insert
      await insertPago({ turnoId, importe, medio, nota, compPath, compMime });

      // Listo
      cleanup();
      closeUI();
      if (typeof opts.onSaved === 'function') await opts.onSaved({ importe, medio });

    } catch (e) {
      console.error('[payments] guardar pago:', e);
      alert(e?.message || 'No se pudo guardar el pago.');
    } finally {
      refs.btnConfirm.disabled = false;
      refs.btnCancel.disabled  = false;
    }
  };

  // Listeners
  refs.btnCancel.addEventListener('click', doCancel);
  refs.close?.addEventListener('click', doCancel);
  refs.btnConfirm.addEventListener('click', doConfirm);
  const onKey = (ev) => { if (ev.key === 'Escape') doCancel(); };
  document.addEventListener('keydown', onKey);

  // Limpieza
  function cleanup() {
    refs.btnCancel.removeEventListener('click', doCancel);
    refs.close?.removeEventListener('click', doCancel);
    refs.btnConfirm.removeEventListener('click', doConfirm);
    elBackdrop.removeEventListener('click', onBackdrop);
    document.removeEventListener('keydown', onKey);
  }
}

/* ============= Bridge: escucha payment:open del resto de la app ============= */
export function initPaymentsBridge() {
  if (_bridgeInit) return;
  _bridgeInit = true;

  document.addEventListener('payment:open', async (e) => {
    const d = e?.detail || {};
    try {
      await openPagoModal({
        turnoId: d.turnoId,
        defaultImporte: d.amount ?? null,
        confirmLabel: d.confirmLabel || 'Registrar pago',
        skipLabel: d.skipLabel || 'Cerrar',
        onSaved: d.onPaid || null,
        onSkip: d.onSkip || null,
      });
    } catch (err) {
      console.error('payment:open handler error:', err);
      alert(err?.message || 'No se pudo abrir el modal de pago.');
    }
  });
}

// Export adicional con el alias que pedías en otros módulos (si te sirve)
export { openPagoModal as openPaymentModal };
