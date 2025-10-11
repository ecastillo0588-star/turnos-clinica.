// payments.js
import supabase from './supabaseClient.js';

// --- Carga única del HTML externo ---
let modalReady = false;
async function ensureModalMounted() {
  if (modalReady && document.getElementById('tpl-modal-pago') && document.getElementById('modal-root')) return;

  // Ajustá la ruta si el archivo está en otra carpeta
  const resp = await fetch('./payment-modal.html', { cache: 'no-store' });
  if (!resp.ok) throw new Error('No se pudo cargar payment-modal.html (revisá la ruta).');

  const html = await resp.text();
  const holder = document.createElement('div');
  holder.innerHTML = html;

  const root = holder.querySelector('#modal-root');
  const tpl  = holder.querySelector('#tpl-modal-pago');

  if (!root || !tpl) {
    throw new Error('payment-modal.html debe contener div#modal-root y template#tpl-modal-pago');
  }
  if (!document.getElementById('modal-root')) document.body.appendChild(root);
  if (!document.getElementById('tpl-modal-pago')) document.body.appendChild(tpl);

  modalReady = true;
}

// --- helpers UI ---
function $id(id){ return document.getElementById(id); }
function money(n){ return Number(n||0).toLocaleString('es-AR', { style:'currency', currency:'ARS', maximumFractionDigits:0 }); }
function toIntPeso(v){
  const s = String(v||'').replace(/[^\d]/g,'');
  return s ? parseInt(s,10) : 0;
}

// --- abrir modal de pago ---
export async function openPagoModal({
  turnoId,
  defaultImporte = 0,
  defaultMedio   = 'efectivo',
  defaultNota    = '',
  confirmLabel   = 'Guardar pago',
  cancelLabel    = 'Cancelar',
  onSaved        = null,
  onCancel       = null,
} = {}) {
  if (!turnoId) throw new Error('openPagoModal: falta turnoId');

  await ensureModalMounted();

  const tpl = /** @type {HTMLTemplateElement} */ ($id('tpl-modal-pago'));
  const root = $id('modal-root');
  if (!tpl || !root) throw new Error('Falta template o root del modal (tpl-modal-pago / modal-root)');

  // instanciar
  const frag = tpl.content.cloneNode(true);
  root.innerHTML = ''; // limpiar instancia anterior
  root.appendChild(frag);

  // refs
  const backdrop = root.querySelector('.modal-backdrop');
  const btnClose = root.querySelector('.modal-close');
  const btnCancel= $id('btn-cancel');
  const btnOk    = $id('btn-confirm');

  const infoBox  = $id('pay-info');
  const inpImporte = $id('pay-importe');
  const selMedio   = $id('pay-medio');
  const txtNota    = $id('pay-nota');
  const inpFile    = $id('pay-file');
  const hintFile   = $id('pay-file-hint');
  const prevWrap   = $id('pay-file-preview');
  const prevImg    = $id('pay-preview-img');
  const prevPdf    = $id('pay-preview-pdf');

  if (!backdrop || !btnOk || !btnCancel) {
    throw new Error('payment-modal.html: faltan nodos obligatorios (#btn-confirm, #btn-cancel o .modal-backdrop)');
  }

  // estado inicial
  inpImporte.value = defaultImporte ? String(defaultImporte) : '';
  selMedio.value   = defaultMedio || 'efectivo';
  txtNota.value    = defaultNota || '';
  btnOk.textContent    = confirmLabel || 'Guardar pago';
  btnCancel.textContent= cancelLabel || 'Cancelar';
  infoBox.style.display = 'none';
  hintFile.textContent = '';
  prevWrap.style.display = 'none';
  prevImg.style.display  = 'none';
  prevPdf.style.display  = 'none';

  // previsualización de archivo
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

  // abrir
  backdrop.style.display = 'flex';

  // cerrar helpers
  const close = (cb) => {
    backdrop.style.display = 'none';
    root.innerHTML = '';
    if (cb) cb();
  };
  btnCancel.onclick = () => close(onCancel);
  btnClose.onclick  = () => close(onCancel);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(onCancel); });

  // guardar
  btnOk.onclick = async () => {
    const importe = toIntPeso(inpImporte.value);
    if (!importe || importe <= 0) {
      infoBox.style.display = 'block';
      infoBox.textContent = 'Ingresá un importe válido.';
      return;
    }

    // 1) insertar pago
    const payload = {
      turno_id: turnoId,
      importe: importe,
      medio: selMedio.value || 'efectivo',  // OJO: si tu columna es medio_pago, alinealo acá y en el resto de la app
      nota: (txtNota.value || '').trim() || null,
      fecha: new Date().toISOString(),
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

    // 2) subir comprobante (opcional)
    const file = inpFile.files?.[0];
    if (file) {
      try {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const path = `${turnoId}/${pagoRow.id}-${Date.now()}.${ext || (file.type.startsWith('image/')?'jpg':'pdf')}`;

        const { error: upErr } = await supabase
          .storage.from('turnos_pagos')
          .upload(path, file, { upsert: false, contentType: file.type || undefined });

        if (upErr) throw upErr;

        await supabase
          .from('turnos_pagos')
          .update({ comprobante_path: path, comprobante_mime: file.type || null })
          .eq('id', pagoRow.id);
      } catch (e) {
        // no rompas el guardado por falla de upload
        console.warn('Upload comprobante failed:', e?.message || e);
      }
    }

    close(onSaved);
  };
}

// --- Bridge e inicialización idempotente ---
let _bridgeInit = false;
export function initPaymentsBridge(){
  if (_bridgeInit) return;
  _bridgeInit = true;

  // Botones declarativos: data-open-pago="TURNO_ID"
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

  // 🔗 Listener global del bridge usado por Inicio.js y Turnos.js
  document.addEventListener('payment:open', async (ev) => {
    const d = ev?.detail || {};
    if (!d.turnoId) return;
    try {
      await openPagoModal({
        turnoId: d.turnoId,
        defaultImporte: d.amount ?? 0,        // sugerencia de importe/saldo
        confirmLabel: d.confirmLabel || 'Guardar pago',
        cancelLabel:  d.skipLabel    || 'Cancelar',
        onSaved:      d.onPaid       || null, // callback al guardar
        onCancel:     d.onSkip       || null, // callback al cerrar sin guardar
      });
    } catch (e) {
      console.error('[payments] payment:open failed:', e);
      alert(e?.message || 'No se pudo abrir el modal de pago.');
    }
  });
}
