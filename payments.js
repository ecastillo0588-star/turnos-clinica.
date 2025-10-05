// payments.js
// Modal unificado de pagos (Inicio + Turnos)
// - Carga el HTML partial (payment-modal.html) una sola vez
// - Muestra total/pagado/pendiente
// - Inserta registro en turnos_pagos
// - (Opcional) Subir comprobante a Supabase Storage 'comprobantes'
// ---------------------------------------------------------------

import supabase from './supabaseClient.js';

const MODAL_PARTIAL_URL = '/payment-modal.html'; // Cambiá si lo servís en otra ruta
const BUCKET = 'comprobantes';
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_SIZE = 20 * 1024 * 1024; // 20 MB

let _modalLoaded = false;
let _dom = null; // refs a nodos del modal
let _backdrop = null;

/* ===========================
   Helpers de dinero / parsing
   =========================== */
function toPesoInt(v) {
  if (v === null || v === undefined) return null;
  const s = String(v)
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number(s);
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(n);
}
function money(n) {
  const val = toPesoInt(n);
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(val ?? 0);
}
const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

/* ===========================
   Supabase helpers
   =========================== */
async function getPagoResumen(turnoId) {
  const { data = [], error } = await supabase
    .from('turnos_pagos')
    .select('importe, medio_pago, fecha')
    .eq('turno_id', turnoId)
    .order('fecha', { ascending: false });

  if (error) {
    console.warn('[payments] getPagoResumen error:', error);
    return { totalPagado: 0, ultimoMedio: null };
  }
  const totalPagado = data.reduce((a, r) => a + Number(r.importe || 0), 0);
  const ultimoMedio = data[0]?.medio_pago || null;
  return { totalPagado, ultimoMedio };
}

async function getTurnoCopago(turnoId) {
  const { data, error } = await supabase
    .from('turnos')
    .select('copago, fecha')
    .eq('id', turnoId)
    .maybeSingle();
  if (error) throw error;
  return { copago: Number(data?.copago || 0), fechaISO: data?.fecha || null };
}

/* ===========================
   File helpers
   =========================== */
function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file) {
  if (!file) return { ok: true, msg: '' }; // archivo opcional
  if (!ALLOWED_MIME.has(file.type)) {
    return { ok: false, msg: 'Solo PDF o imágenes (JPG/PNG/WEBP/GIF).' };
  }
  if (file.size > MAX_SIZE) {
    return { ok: false, msg: `Archivo demasiado grande (máx. ${humanSize(MAX_SIZE)}).` };
  }
  return { ok: true, msg: '' };
}

async function sha256Hex(file) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(hash);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sube el archivo y devuelve metadatos para guardar en DB.
 * path: comprobantes/<turnoId>/<YYYY>/<MM>/<DD>/<timestamp>__<original>
 */
async function uploadComprobante(turnoId, file, fechaISO) {
  if (!file) return null;

  const { ok, msg } = validateFile(file);
  if (!ok) throw new Error(msg);

  const d = fechaISO ? new Date(fechaISO + 'T00:00:00') : new Date();
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());

  const stamp = Date.now();
  const safeName = (file.name || 'archivo').replace(/[^\w.\-]+/g, '_').slice(0, 80);
  const path = `comprobantes/${turnoId}/${y}/${m}/${day}/${stamp}__${safeName}`;

  // Hash (opcional pero útil)
  let sha256 = null;
  try { sha256 = await sha256Hex(file); } catch { /* ignore */ }

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: '31536000',
      upsert: false,
      contentType: file.type || undefined
    });

  if (upErr) {
    console.error('[payments] upload error:', upErr);
    throw new Error(upErr.message || 'No se pudo subir el comprobante');
  }

  return {
    comprobante_path: path,
    comprobante_mime: file.type || null,
    comprobante_size: file.size ?? null,
    comprobante_filename: file.name || null,
    comprobante_sha256: sha256,
  };
}

/* ===========================
   Modal loader (partial)
   =========================== */
async function ensureModalLoaded() {
  if (_modalLoaded) return;

  // Cargar partial
  const res = await fetch(MODAL_PARTIAL_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error('No se pudo cargar payment-modal.html');
  const html = await res.text();

  // Montar en DOM
  const wrap = document.createElement('div');
  wrap.innerHTML = html;

  // Soportar dos variantes de partial:
  //  1) <template id="tpl-modal-pago">...</template>
  //  2) markup directo con .modal-backdrop
  const tpl = wrap.querySelector('#tpl-modal-pago');
  if (tpl?.content) {
    document.body.appendChild(tpl.content.cloneNode(true));
  } else {
    // Asumimos que el partial ya trae la .modal-backdrop
    document.body.appendChild(wrap.firstElementChild);
  }

  _backdrop = document.querySelector('.modal-backdrop[data-modal="pago"]') ||
              document.querySelector('.modal-backdrop'); // fallback

  if (!_backdrop) throw new Error('payment-modal: no se encontró .modal-backdrop');

  // Cache refs
  _dom = {
    info:       _backdrop.querySelector('#pay-info'),
    imp:        _backdrop.querySelector('#pay-importe'),
    medio:      _backdrop.querySelector('#pay-medio'),
    nota:       _backdrop.querySelector('#pay-nota'),
    file:       _backdrop.querySelector('#pay-file'),
    fileHint:   _backdrop.querySelector('#pay-file-hint'),
    fileClear:  _backdrop.querySelector('#pay-file-clear'),
    btnOk:      _backdrop.querySelector('#btn-confirm'),
    btnCancel:  _backdrop.querySelector('#btn-cancel') || _backdrop.querySelector('.modal-close'),
    closeX:     _backdrop.querySelector('.modal-close'),
    modal:      _backdrop.querySelector('.modal')
  };

  // Listeners fijos
  // Cerrar al click afuera
  _backdrop.addEventListener('click', (e) => {
    if (e.target === _backdrop) hide();
  });
  // Botón X
  _dom.closeX?.addEventListener('click', hide);
  _dom.btnCancel?.addEventListener('click', hide);

  // File UI
  if (_dom.file) {
    _dom.file.addEventListener('change', () => {
      const f = _dom.file.files?.[0] || null;
      if (!f) {
        _dom.fileHint.textContent = 'PDF o imagen (opcional).';
        return;
      }
      const { ok, msg } = validateFile(f);
      if (!ok) {
        _dom.file.value = '';
        _dom.fileHint.textContent = msg;
      } else {
        _dom.fileHint.textContent = `${f.name} · ${f.type || '—'} · ${humanSize(f.size)}`;
      }
    });
  }
  if (_dom.fileClear) {
    _dom.fileClear.addEventListener('click', () => {
      if (_dom.file) _dom.file.value = '';
      if (_dom.fileHint) _dom.fileHint.textContent = 'PDF o imagen (opcional).';
    });
  }

  _modalLoaded = true;
}

function show() {
  _backdrop?.classList.add('show');
}
function hide() {
  _backdrop?.classList.remove('show');
  // Limpieza liviana
  if (_dom?.imp)   _dom.imp.value = '';
  if (_dom?.nota)  _dom.nota.value = '';
  if (_dom?.medio) _dom.medio.value = 'efectivo';
  if (_dom?.file)  _dom.file.value = '';
  if (_dom?.fileHint) _dom.fileHint.textContent = 'PDF o imagen (opcional).';
  if (_dom?.info) {
    _dom.info.classList.remove('error-box');
    _dom.info.classList.remove('success-box');
    _dom.info.style.display = 'none';
    _dom.info.textContent = '';
  }
}

/* ===========================
   API principal
   =========================== */
export async function openPagoModal(turnoId, { afterPay } = {}) {
  await ensureModalLoaded();

  // 1) Leer copago + resumen pagado
  let copago = 0, fechaISO = null, totalPagado = 0;
  try {
    const t = await getTurnoCopago(turnoId);
    copago = Number(t.copago || 0);
    fechaISO = t.fechaISO || null;
    const r = await getPagoResumen(turnoId);
    totalPagado = Number(r.totalPagado || 0);
  } catch (e) {
    console.warn('[payments] no se pudo leer turno/resumen:', e);
  }

  const pendiente = Math.max(0, copago - totalPagado);
  if (_dom.info) {
    _dom.info.style.display = '';
    _dom.info.classList.remove('error-box');
    _dom.info.classList.add('success-box');
    _dom.info.innerHTML = `
      Total copago: <b>${money(copago)}</b> · Pagado: <b>${money(totalPagado)}</b> · Pendiente: <b>${money(pendiente)}</b>
    `;
  }
  if (_dom.imp) _dom.imp.value = pendiente > 0 ? String(pendiente) : '';

  // 2) Confirmar → subir (si hay archivo) → insertar pago
  const onConfirm = async () => {
    if (!_dom.btnOk) return;
    if (_dom.btnOk.disabled) return;

    const rawImp = _dom.imp?.value ?? '';
    const imp = toPesoInt(rawImp);
    const medio = _dom.medio?.value || 'efectivo';
    const nota = (_dom.nota?.value || '').trim();

    if (!imp || imp <= 0) {
      alert('Ingresá un importe válido (> 0).');
      return;
    }
    if (medio !== 'efectivo' && medio !== 'transferencia') {
      alert('Medio de pago inválido.');
      return;
    }

    // Validar archivo (si existe)
    const file = _dom.file?.files?.[0] || null;
    const v = validateFile(file);
    if (!v.ok) {
      alert(v.msg);
      return;
    }

    _dom.btnOk.disabled = true;
    const prev = _dom.btnOk.textContent;
    _dom.btnOk.textContent = 'Guardando…';

    try {
      // 2.a) Subir archivo (opcional)
      let meta = null;
      if (file) {
        meta = await uploadComprobante(turnoId, file, fechaISO);
      }

      // 2.b) Insert en turnos_pagos
      const row = {
        turno_id: turnoId,
        importe: imp,
        medio_pago: medio,
        nota: nota || null,
        // metadatos del comprobante (si hay)
        ...(meta || {}),
      };

      const { error: insErr } = await supabase.from('turnos_pagos').insert([row]);
      if (insErr) throw insErr;

      hide();
      if (typeof afterPay === 'function') {
        await afterPay();
      }
    } catch (e) {
      console.error('[payments] insert/upload error:', e);
      alert(e.message || 'No se pudo registrar el pago.');
    } finally {
      if (_dom.btnOk) {
        _dom.btnOk.disabled = false;
        _dom.btnOk.textContent = prev;
      }
    }
  };

  // Bind/cancel previous handler to avoid duplicates
  if (_dom.btnOk) {
    _dom.btnOk.onclick = onConfirm;
  }

  show();
}

/* ===========================
   (Opcional) utilidad para abrir directo con datos mock
   =========================== */
// window.__openPagoDemo = () => openPagoModal('00000000-0000-0000-0000-000000000000');

export default { openPagoModal };

