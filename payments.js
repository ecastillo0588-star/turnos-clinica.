// payments.js
import supabase from './supabaseClient.js';

// ===========================
// Carga única del template
// ===========================
let modalReady = false;
async function ensureModalMounted() {
  if (modalReady && document.getElementById('tpl-modal-pago') && document.getElementById('modal-root')) return;

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

// ===========================
// Helpers UI y formateo
// ===========================
const $id = (id) => document.getElementById(id);
const pad2 = (n)=> (n<10?'0'+n:''+n);
const toHM = (t)=> (t??'').toString().slice(0,5);
function money(n){ return Number(n||0).toLocaleString('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}); }
function toIntPeso(v){ const s = String(v||'').replace(/[^\d]/g,''); return s ? parseInt(s,10) : 0; }
const titleCase = s => (s||'').split(' ').filter(Boolean).map(w=> w[0]?.toUpperCase()+w.slice(1).toLowerCase()).join(' ');

// ===========================
// Datos del turno (para header)
// ===========================
async function fetchTurnoInfo(turnoId){
  const { data: t, error } = await supabase
    .from('turnos')
    .select(`
      id, fecha, hora_inicio, hora_fin,
      paciente_id, profesional_id,
      pacientes(apellido, nombre),
      profesionales(apellido, nombre)
    `)
    .eq('id', turnoId)
    .maybeSingle();

  if (error) throw error;

  const pac = t?.pacientes || {};
  const pro = t?.profesionales || {};
  const paciente = [pac.nombre, pac.apellido].filter(Boolean).map(titleCase).join(' ').trim() || 'Paciente';
  const profesional = [pro.nombre, pro.apellido].filter(Boolean).map(titleCase).join(' ').trim() || '—';

  const hi = toHM(t?.hora_inicio);
  const hf = toHM(t?.hora_fin);
  let rango = '—';
  if (hi && hf)      rango = `${hi} — ${hf}`;
  else if (hi)       rango = hi;
  else if (hf)       rango = hf;

  return {
    paciente,
    fecha: t?.fecha || '—',
    rango,
    profesional
  };
}

// ===========================
// Abrir modal (público)
// ===========================
export async function openPagoModal({
  turnoId,
  defaultImporte = 0,
  // por pedido: default a "transferencia"
  defaultMedio   = 'transferencia',
  defaultNota    = '',
  confirmLabel   = 'Guardar pago',
  cancelLabel    = 'Cancelar',
  onSaved        = null,
  onCancel       = null,
} = {}) {
  if (!turnoId) throw new Error('openPagoModal: falta turnoId');
  await ensureModalMounted();

  const tpl  = /** @type {HTMLTemplateElement} */ ($id('tpl-modal-pago'));
  const root = $id('modal-root');
  if (!tpl || !root) throw new Error('Falta template o root del modal (tpl-modal-pago / modal-root)');

  // Instanciar
  const frag = tpl.content.cloneNode(true);
  root.innerHTML = '';
  root.appendChild(frag);

  // Refs UI
  const backdrop   = root.querySelector('.modal-backdrop');
  const btnClose   = root.querySelector('.modal-close');
  const btnCancel  = $id('btn-cancel');
  const btnOk      = $id('btn-confirm');

  const infoBox    = $id('pay-info');
  const inpImporte = $id('pay-importe');
  const selMedio   = $id('pay-medio');
  const txtNota    = $id('pay-nota');
  const inpFile    = $id('pay-file');
  const hintFile   = $id('pay-file-hint');
  const prevWrap   = $id('pay-file-preview');
  const prevImg    = $id('pay-preview-img');
  const prevPdf    = $id('pay-preview-pdf');

  const hdrPac   = $id('tp-turno-paciente');
  const hdrMeta  = $id('tp-turno-meta');
  const hdrProf  = $id('tp-turno-prof');

  if (!backdrop || !btnOk || !btnCancel) {
    throw new Error('payment-modal.html: faltan nodos obligatorios (#btn-confirm, #btn-cancel o .modal-backdrop)');
  }

  // Header del turno
  try {
    const info = await fetchTurnoInfo(turnoId);
    if (hdrPac)  hdrPac.textContent  = info.paciente;
    if (hdrMeta) hdrMeta.textContent = `${info.fecha} · ${info.rango}`;
    if (hdrProf) hdrProf.textContent = info.profesional;
  } catch (e) {
    if (hdrPac)  hdrPac.textContent  = 'Paciente';
    if (hdrMeta) hdrMeta.textContent = '—';
    if (hdrProf) hdrProf.textContent = '—';
  }

  // Estado inicial del form
  inpImporte.value = defaultImporte ? String(defaultImporte) : '';
  selMedio.value   = (defaultMedio === 'efectivo' || defaultMedio === 'transferencia') ? defaultMedio : 'transferencia';
  txtNota.value    = defaultNota || '';
  btnOk.textContent     = confirmLabel || 'Guardar pago';
  btnCancel.textContent = cancelLabel || 'Cancelar';
  infoBox.style.display = 'none';
  hintFile.textContent  = '';
  prevWrap.style.display= 'none';
  prevImg.style.display = 'none';
  prevPdf.style.display = 'none';

  // Preview del archivo
  inpFile.onchange = () => {
    const f = inpFile.files?.[0];
    prevWrap.style.display = f ? 'block' : 'none';
    prevImg.style.display  = 'none';
    prevPdf.style.display  = 'none';
    hintFile.textContent   = '';

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

  // Abrir
  backdrop.style.display = 'flex';

  // Cerrar helpers
  const close = (cb) => {
    backdrop.style.display = 'none';
    root.innerHTML = '';
    if (cb) cb();
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

    // 1) INSERT en turnos_pagos (usa nombres EXACTOS del DDL)
    const payload = {
      turno_id: turnoId,
      importe: importe,                   // numeric(12,2) con check > 0
      medio_pago: selMedio.value,         // 'efectivo' | 'transferencia'
      nota: (txtNota.value || '').trim() || null,
      // fecha tiene default now()
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

    // 2) Subir comprobante a Storage (opcional) y PATCHear fila
    const file = inpFile.files?.[0];
    if (file) {
      try {
        // Subida
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const safeExt = ext || (file.type.startsWith('image/') ? 'jpg' : 'pdf');
        const path = `${turnoId}/${pagoRow.id}-${Date.now()}.${safeExt}`;

        const { error: upErr } = await supabase
          .storage.from('turnos_pagos')
          .upload(path, file, { upsert: false, contentType: file.type || undefined });

        if (upErr) throw upErr;

        // Update de metadatos de comprobante (usa nombres EXACTOS del DDL)
        const patch = {
          comprobante_path: path,
          comprobante_mime: file.type || null,
          comprobante_size: file.size ?? null,
          comprobante_filename: file.name || null,
          // sha256: opcional (si querés calcularlo en cliente)
          comprobante_subido_en: new Date().toISOString(),
          // comprobante_subido_por: (si tenés user_id) -> agregalo acá
        };

        const { error: updErr } = await supabase
          .from('turnos_pagos')
          .update(patch)
          .eq('id', pagoRow.id);

        if (updErr) throw updErr;
      } catch (e) {
        console.warn('Upload/patch comprobante falló:', e?.message || e);
        // No cortar el flujo si falla el upload: dejamos el pago registrado
      }
    }

    close(onSaved);
  };
}

// ===========================
// Bridge global e init idempotente
// ===========================
let _bridgeInit = false;
export function initPaymentsBridge(){
  if (_bridgeInit) return;
  _bridgeInit = true;

  // Declarativo por data-open-pago (opcional)
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

  // Listener del bridge usado desde Inicio.js (openPaymentBridge)
  document.addEventListener('payment:open', async (ev) => {
    const d = ev?.detail || {};
    if (!d.turnoId) return;
    try {
      await openPagoModal({
        turnoId: d.turnoId,
        defaultImporte: d.amount ?? 0,
        // Por defecto Transferencia, salvo que nos pasen explícito
        defaultMedio: d.defaultMedio || 'transferencia',
        confirmLabel: d.confirmLabel || 'Guardar pago',
        cancelLabel:  d.skipLabel    || 'Cancelar',
        onSaved:      d.onPaid       || null,
        onCancel:     d.onSkip       || null,
      });
    } catch (e) {
      console.error('[payments] payment:open failed:', e);
      alert(e?.message || 'No se pudo abrir el modal de pago.');
    }
  });
}
