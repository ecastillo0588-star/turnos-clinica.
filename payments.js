// payments.js
import supabase from './supabaseClient.js';

/* =========================
   Carga única del HTML modal
   ========================= */
let modalReady = false;
async function ensureModalMounted () {
  if (modalReady && document.getElementById('tpl-modal-pago') && document.getElementById('modal-root')) return;

  const resp = await fetch('./payment-modal.html', { cache: 'no-store' });
  if (!resp.ok) throw new Error('No se pudo cargar payment-modal.html (revisá la ruta).');

  const html = await resp.text();
  const holder = document.createElement('div');
  holder.innerHTML = html;

  const root = holder.querySelector('#modal-root');
  const tpl  = holder.querySelector('#tpl-modal-pago');

  if (!root || !tpl) throw new Error('payment-modal.html debe contener div#modal-root y template#tpl-modal-pago');

  if (!document.getElementById('modal-root')) document.body.appendChild(root);
  if (!document.getElementById('tpl-modal-pago')) document.body.appendChild(tpl);

  modalReady = true;
}

/* =========================
   Helpers UI / formato
   ========================= */
const $id = (id) => document.getElementById(id);

function toIntPeso (v) {
  const s = String(v ?? '').replace(/[^\d]/g, '');
  return s ? parseInt(s, 10) : 0;
}
function money (n) {
  return Number(n || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}
const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
const toHM = (val) => {
  if (!val) return '';
  const s = String(val);
  // acepta HH:MM o HH:MM:SS
  const m = s.match(/^(\d{2}):(\d{2})/);
  if (!m) return s;
  return `${m[1]}:${m[2]}`;
};
function formatFechaHora (fecha, hi, hf) {
  const rango = hi && hf ? `${toHM(hi)} — ${toHM(hf)}` : (hi || hf ? toHM(hi || hf) : '—');
  return `${fecha || '—'} · ${rango}`;
}

/* =========================
   Apertura del modal (público)
   ========================= */
/**
 * openPagoModal({
 *   turnoId (req),
 *   defaultImporte = 0,
 *   defaultMedio   = 'transferencia',
 *   defaultNota    = '',
 *   confirmLabel   = 'Guardar pago',
 *   cancelLabel    = 'Cancelar',
 *   onSaved        = null,       // callback después de guardar
 *   onCancel       = null        // callback al cerrar sin guardar
 * })
 */
export async function openPagoModal ({
  turnoId,
  defaultImporte = 0,
  defaultMedio   = 'transferencia',
  defaultNota    = '',
  confirmLabel   = 'Guardar pago',
  cancelLabel    = 'Cancelar',
  onSaved        = null,
  onCancel       = null
} = {}) {
  if (!turnoId) throw new Error('openPagoModal: falta turnoId');

  await ensureModalMounted();

  const tpl  = /** @type {HTMLTemplateElement} */ ($id('tpl-modal-pago'));
  const root = $id('modal-root');
  if (!tpl || !root) throw new Error('Falta template o root del modal (tpl-modal-pago / modal-root)');

  // Instanciar template
  const frag = tpl.content.cloneNode(true);
  root.innerHTML = '';
  root.appendChild(frag);

  // Refs básicas
  const backdrop  = root.querySelector('.modal-backdrop');
  const btnClose  = root.querySelector('.modal-close');
  const btnCancel = $id('btn-cancel');
  const btnOk     = $id('btn-confirm');

  // Refs de encabezado (opcional en el HTML)
  const lblPac = $id('pay-paciente');
  const lblFh  = $id('pay-fecha');
  const lblPro = $id('pay-profesional');

  // Refs form
  const infoBox     = $id('pay-info');
  const inpImporte  = $id('pay-importe');
  const selMedio    = $id('pay-medio');
  const txtNota     = $id('pay-nota');
  const inpFile     = $id('pay-file');
  const hintFile    = $id('pay-file-hint');
  const prevWrap    = $id('pay-file-preview');
  const prevImg     = $id('pay-preview-img');
  const prevPdf     = $id('pay-preview-pdf');

  if (!backdrop || !btnOk || !btnCancel) {
    throw new Error('payment-modal.html: faltan nodos obligatorios (#btn-confirm, #btn-cancel o .modal-backdrop)');
  }

  // Estado inicial del form
  inpImporte.value = defaultImporte ? String(defaultImporte) : '';
  selMedio.value   = defaultMedio || 'transferencia';
  txtNota.value    = defaultNota || '';
  btnOk.textContent     = confirmLabel || 'Guardar pago';
  btnCancel.textContent = cancelLabel || 'Cancelar';
  infoBox.style.display = 'none';
  hintFile.textContent  = '';
  prevWrap.style.display = 'none';
  prevImg.style.display  = 'none';
  prevPdf.style.display  = 'none';

  // Cargar encabezado (paciente / fecha-hora / profesional)
  try {
    const { data: t, error } = await supabase
      .from('turnos')
      .select(`
        id, fecha, hora_inicio, hora_fin, profesional_id,
        pacientes:pacientes ( nombre, apellido ),
        profesionales:profesionales ( nombre, apellido )
      `)
      .eq('id', turnoId)
      .maybeSingle();

    if (!error && t) {
      if (lblPac) lblPac.textContent = [t.pacientes?.nombre, t.pacientes?.apellido].filter(Boolean).join(' ') || '—';
      if (lblFh)  lblFh.textContent  = formatFechaHora(t.fecha, t.hora_inicio, t.hora_fin);
      if (lblPro) lblPro.textContent = [t.profesionales?.nombre, t.profesionales?.apellido].filter(Boolean).join(' ') || '—';
    } else {
      if (lblPac) lblPac.textContent = '—';
      if (lblFh)  lblFh.textContent  = '—';
      if (lblPro) lblPro.textContent = '—';
    }
  } catch (_) {
    if (lblPac) lblPac.textContent = '—';
    if (lblFh)  lblFh.textContent  = '—';
    if (lblPro) lblPro.textContent = '—';
  }

  // Preview de archivo
  inpFile.onchange = () => {
    const f = inpFile.files?.[0];
    prevWrap.style.display = f ? 'block' : 'none';
    prevImg.style.display = 'none';
    prevPdf.style.display = 'none';
    hintFile.textContent = '';

    if (f) {
      const isPdf = /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
      if (isPdf) {
        prevPdf.style.display = 'block';
      } else if (/^image\//i.test(f.type)) {
        const url = URL.createObjectURL(f);
        prevImg.src = url;
        prevImg.style.display = 'inline-block';
      } else {
        hintFile.textContent = 'Formato no reconocido. Solo PDF o imagen.';
      }
    }
  };

  // Mostrar modal
  backdrop.style.display = 'flex';

  // Cerrar helpers
  const close = (cb) => {
    backdrop.style.display = 'none';
    root.innerHTML = '';
    if (typeof cb === 'function') cb();
  };
  btnCancel.onclick = () => close(onCancel);
  btnClose.onclick  = () => close(onCancel);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(onCancel); });

  // Guardar
  btnOk.onclick = async () => {
    const importe = toIntPeso(inpImporte.value);
    if (!importe || importe <= 0) {
      infoBox.style.display = 'block';
      infoBox.textContent = 'Ingresá un importe válido.';
      return;
    }

    // 1) Insertar pago
    const payload = {
      turno_id: turnoId,
      importe: importe,
      medio_pago: selMedio.value || 'transferencia',
      nota: (txtNota.value || '').trim() || null,
      fecha: new Date().toISOString()
    };

    const { data: pagoRow, error: e1 } = await supabase
      .from('turnos_pagos')
      .insert([payload])
      .select('id')
      .single();

    if (e1) {
      infoBox.style.display = 'block';
      infoBox.textContent = e1.message || 'No se pudo guardar el pago.';
      return;
    }

    // 2) Subir comprobante (opcional)
    const file = inpFile.files?.[0];
    if (file) {
      try {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const safeExt = ext || (file.type?.startsWith('image/') ? 'jpg' : 'pdf');
        const path = `${turnoId}/${pagoRow.id}-${Date.now()}.${safeExt}`;

        const { error: upErr } = await supabase
          .storage.from('turnos_pagos')
          .upload(path, file, { upsert: false, contentType: file.type || undefined });

        if (upErr) throw upErr;

        // URL pública (o ajustá a tu política de acceso)
        const { data: pub } = supabase
          .storage.from('turnos_pagos')
          .getPublicUrl(path);

        const publicUrl = pub?.publicUrl || null;

        await supabase
          .from('turnos_pagos')
          .update({ comprobante_url: publicUrl, mime_type: file.type || null })
          .eq('id', pagoRow.id);
      } catch (e) {
        console.warn('Upload comprobante failed:', e?.message || e);
        // no bloqueamos el pago por un fallo de upload
      }
    }

    close(onSaved);
  };
}

/* =========================
   Bridge e init idempotente
   ========================= */
let _bridgeInit = false;
export function initPaymentsBridge () {
  if (_bridgeInit) return;
  _bridgeInit = true;

  // Declarativo: data-open-pago="TURNO_ID"
  document.querySelectorAll('[data-open-pago]').forEach(btn => {
    if (btn._pagoInit) return;
    btn._pagoInit = true;
    btn.addEventListener('click', async () => {
      const turnoId = btn.getAttribute('data-open-pago');
      if (!turnoId) return;
      try {
        await openPagoModal({ turnoId });
      } catch (e) {
        console.error('openPagoModal error:', e);
        alert(e?.message || 'No se pudo abrir el modal de pago.');
      }
    });
  });

  // Listener global consumido por Inicio.js / Turnos.js (openPaymentBridge -> dispatchEvent)
  document.addEventListener('payment:open', async (ev) => {
    const d = ev?.detail || {};
    if (!d.turnoId) return;
    try {
      await openPagoModal({
        turnoId: d.turnoId,
        defaultImporte: d.amount ?? 0,
        defaultMedio: 'transferencia',
        confirmLabel: d.confirmLabel || 'Guardar pago',
        cancelLabel:  d.skipLabel    || 'Cancelar',
        onSaved:      d.onPaid       || null,
        onCancel:     d.onSkip       || null
      });
    } catch (e) {
      console.error('[payments] payment:open failed:', e);
      alert(e?.message || 'No se pudo abrir el modal de pago.');
    }
  });
}
