async function inicioOpenTurnoPanel(turnoId){
  // Helpers locales para UI
  const setText = (el, txt='—') => { if (el) el.textContent = txt; };
  const setChip = (el, txt, tone='') => {
    if (!el) return;
    el.textContent = txt;
    el.className = 'chip' + (tone ? ' ' + tone : '');
  };
  const show = (el, v=true) => { if (el) el.style.display = v ? '' : 'none'; };
  const enable = (el, v=true) => { if (el) el.disabled = !v; };

  // Lightbox simple para imágenes
  const openLightbox = (src) => {
    const overlay = document.createElement('div');
    overlay.className = 'lb-overlay';
    overlay.innerHTML = `
      <div class="lb-backdrop"></div>
      <div class="lb-content" role="dialog" aria-modal="true">
        <button class="lb-close" aria-label="Cerrar">×</button>
        <img class="lb-img" alt="Comprobante" />
      </div>
    `;
    const css = document.createElement('style');
    css.textContent = `
      .lb-overlay{position:fixed;inset:0;z-index:1000}
      .lb-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.6)}
      .lb-content{position:absolute;inset:6%;display:flex;align-items:center;justify-content:center}
      .lb-img{max-width:100%;max-height:100%;box-shadow:0 8px 30px rgba(0,0,0,.4);border-radius:8px;background:#fff}
      .lb-close{position:absolute;top:10px;right:14px;font-size:28px;line-height:1;border:0;background:#fff;border-radius:999px;width:36px;height:36px;cursor:pointer}
    `;
    overlay.appendChild(css);
    document.body.appendChild(overlay);
    overlay.querySelector('.lb-img').src = src;
    const close = () => overlay.remove();
    overlay.querySelector('.lb-backdrop').onclick = close;
    overlay.querySelector('.lb-close').onclick = close;
    document.addEventListener('keydown', function onEsc(e){
      if (e.key === 'Escape'){ close(); document.removeEventListener('keydown', onEsc); }
    });
  };

  // 1) Traer turno + paciente
  const { data: t, error } = await supabase
    .from('turnos')
    .select(`
      id, fecha, hora_inicio, hora_fin, estado, hora_arribo,
      copago, paciente_id, comentario_recepcion,
      pacientes(dni, apellido, nombre)
    `)
    .eq('id', turnoId)
    .maybeSingle();

  if (error || !t) {
    // Limpio UI básico si algo falla
    setText(UI.tp?.title, 'Paciente');
    setText(UI.tp?.sub, 'DNI —');
    setText(UI.tp?.hora, 'Turno: —');
    setChip(UI.tp?.estado, '—', '');
    setChip(UI.tp?.copago, 'Sin copago', 'muted');
    setText(document.getElementById('tp-copago-info'), '—');
    ['btnArr','btnAt','btnPago','btnCan'].forEach(k => show(UI.tp?.[k], false));
    // Abrir panel igual, para mostrar el estado
    const el = UI?.tp?.el || document.getElementById('turnoPanel');
    if (el){
      el.classList.add('open');
      el.setAttribute('aria-hidden','false');
      el.setAttribute('data-turno-id', String(turnoId));
      document.body.classList.add('tp-open');
      (UI?.tp?.close || el.querySelector('#tp-close'))?.addEventListener('click', inicioHideTurnoPanel, { once:true });
    }
    return;
  }

  // 2) Header (nombre + DNI)
  const p = t.pacientes || {};
  const ape = (p.apellido || '').trim();
  const nom = (p.nombre || '').trim();
  const fullName = (nom || ape) ? `${nom} ${ape}`.trim() : 'Paciente';
  setText(UI.tp?.title, fullName);
  setText(UI.tp?.sub, `DNI ${p.dni || '—'}`);

  // 3) Fecha + rango horario
  const hi = toHM(t.hora_inicio);
  const hf = toHM(t.hora_fin);
  let rango = '—';
  if (hi && hf)      rango = `${hi} — ${hf}`;
  else if (hi)       rango = hi;
  else if (hf)       rango = hf;
  const fechaTxt = t.fecha || currentFechaISO || '—';
  setText(UI.tp?.hora, `Turno: ${fechaTxt} · ${rango}`);

  // 4) Chips: estado + copago
  const estado = t.estado;
  const toneByEstado = {
    [EST.ASIGNADO]:    'info',
    [EST.EN_ESPERA]:   'accent',
    [EST.EN_ATENCION]: 'warn',
    [EST.ATENDIDO]:    'ok',
    [EST.CANCELADO]:   'muted',
    [EST.CONFIRMADO]:  'info'
  };
  setChip(UI.tp?.estado, (estado || '—').replaceAll('_',' '), toneByEstado[estado] || '');

  const cop = toPesoInt(t.copago) ?? 0;
  if (cop > 0) setChip(UI.tp?.copago, `Copago: ${money(cop)}`, 'accent');
  else setChip(UI.tp?.copago, 'Sin copago', 'muted');

  // 4.b) Pre-cargar comentario de recepción
  if (UI.tp?.com) {
    UI.tp.com.value = t.comentario_recepcion || '';
  }

  // 5) Resumen de pago (Total/Pagado/Pendiente)
  let totalPagado = 0;
  try {
    const { totalPagado: tp } = await getPagoResumen(turnoId);
    totalPagado = Number(tp || 0);
  } catch {}
  const pendiente = Math.max(0, (toPesoInt(t.copago) ?? 0) - totalPagado);
  const infoEl = document.getElementById('tp-copago-info');
  if (infoEl) {
    if (cop === 0) {
      infoEl.textContent = 'Sin copago';
    } else {
      const parts = [
        `Total: ${money(cop)}`,
        `Pagado: ${money(totalPagado)}`
      ];
      if (pendiente === 0) parts.push(`✅ Abonado`);
      else parts.push(`Pendiente: ${money(pendiente)}`);
      infoEl.textContent = parts.join(' · ');
    }
  }

  // 5.b) Vista previa del comprobante (si existe)
  try {
    // último pago con comprobante (columnas correctas)
    const { data: compRows = [] } = await supabase
      .from('turnos_pagos')
      .select('id, comprobante_path, comprobante_mime, fecha')
      .eq('turno_id', turnoId)
      .not('comprobante_path','is', null)
      .order('fecha', { ascending: false })
      .limit(1);

    const comp = compRows?.[0];

    // crear contenedor si no existe
    let wrap = document.getElementById('tp-comp-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'tp-comp-wrap';
      wrap.style.marginTop = '8px';
      // insertarlo debajo de #tp-copago-info
      const row = infoEl?.parentElement || UI.tp?.el?.querySelector('.tp-section .tp-row');
      (row || UI.tp?.el)?.appendChild(wrap);
    }
    // limpiar
    wrap.innerHTML = '';

    if (comp?.comprobante_path) {
      // URL firmada (10 minutos)
      const { data: signed, error: sErr } = await supabase
        .storage.from('turnos_pagos')
        .createSignedUrl(comp.comprobante_path, 60 * 10);

      if (!sErr && signed?.signedUrl) {
        const url = signed.signedUrl;
        const mime = (comp.comprobante_mime || '').toLowerCase();
        const isImg = mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(comp.comprobante_path);

        const title = document.createElement('div');
        title.textContent = 'Comprobante:';
        title.style.fontSize = '12px';
        title.style.color = '#6b6480';
        title.style.marginBottom = '4px';
        wrap.appendChild(title);

        if (isImg) {
          const thumb = document.createElement('img');
          thumb.src = url;
          thumb.alt = 'Comprobante';
          thumb.style.maxWidth = '120px';
          thumb.style.maxHeight = '90px';
          thumb.style.borderRadius = '6px';
          thumb.style.boxShadow = '0 1px 4px rgba(0,0,0,.12)';
          thumb.style.cursor = 'zoom-in';
          thumb.onclick = () => openLightbox(url);
          wrap.appendChild(thumb);
        } else {
          const a = document.createElement('a');
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = 'Abrir comprobante';
          a.className = 'btn secondary';
          wrap.appendChild(a);
        }
      }
    }
  } catch (e) {
    // no interrumpimos el panel si falla
  }

  // 6) Botones (visibilidad y habilitación según permisos/estado)
  const isHoy = (currentFechaISO === todayISO());

  // ARRIBO
  const canArribo = roleAllows('arribo', userRole) && estado === EST.ASIGNADO && isHoy;
  show(UI.tp?.btnArr, canArribo);
  if (UI.tp?.btnArr) {
    enable(UI.tp.btnArr, canArribo);
    UI.tp.btnArr.onclick = () => marcarLlegadaYCopago(turnoId);
  }

  // ATENDER
  const canAtender = roleAllows('atender', userRole) && estado === EST.EN_ESPERA;
  show(UI.tp?.btnAt, canAtender);
  if (UI.tp?.btnAt) {
    enable(UI.tp.btnAt, canAtender);
    UI.tp.btnAt.onclick = (ev) => pasarAEnAtencion(turnoId, ev);
  }

  // FINALIZAR
  const canFinalizar = roleAllows('finalizar', userRole) && estado === EST.EN_ATENCION;
  show(UI.tp?.btnFinalizar, canFinalizar);
  if (UI.tp?.btnFinalizar) {
    enable(UI.tp.btnFinalizar, canFinalizar);
    UI.tp.btnFinalizar.onclick = () => finalizarAtencion(turnoId);
  }

  // CANCELAR
  const canCancelar = roleAllows('cancelar', userRole) && estado !== EST.CANCELADO && estado !== EST.ATENDIDO;
  show(UI.tp?.btnCan, canCancelar);
  if (UI.tp?.btnCan) {
    enable(UI.tp.btnCan, canCancelar);
    UI.tp.btnCan.onclick = () => anularTurno(turnoId);
  }

  // PAGO (modal nuevo vía bridge)
  const canPagar = (cop > 0 && pendiente > 0);
  show(UI.tp?.btnPago, canPagar);
  if (UI.tp?.btnPago) {
    enable(UI.tp.btnPago, canPagar);
    UI.tp.btnPago.onclick = () => openPaymentBridge({
      turnoId,
      amount: pendiente,
      confirmLabel: 'Registrar pago',
      skipLabel: 'Cerrar',
      onPaid: async () => {
        await inicioOpenTurnoPanel(turnoId);                 // refresca slide
        await refreshAll({ showOverlayIfSlow:false });       // refresca boards
      },
      onSkip: () => {}
    });
  }

  // FICHA
  const canAbrirFicha = roleAllows('abrir_ficha', userRole);
  show(UI.tp?.btnFicha, canAbrirFicha);
  if (UI.tp?.btnFicha) {
    enable(UI.tp.btnFicha, canAbrirFicha);
    UI.tp.btnFicha.onclick = () => openFicha(turnoId);
  }

  // Guardar comentario recepción
  if (UI.tp?.btnSave && UI.tp?.com) {
    UI.tp.btnSave.onclick = async () => {
      const v = (UI.tp.com.value || '').trim() || null;
      const { error: e } = await supabase
        .from('turnos')
        .update({ comentario_recepcion: v })
        .eq('id', turnoId);
      if (e) { alert('No se pudo guardar el comentario.'); return; }
      UI.tp.btnSave.classList.add('ok');
      setTimeout(()=> UI.tp.btnSave.classList.remove('ok'), 600);
    };
  }

  // 7) Abrir panel
  const el = UI?.tp?.el || document.getElementById('turnoPanel');
  if (el){
    el.classList.add('open');
    el.setAttribute('aria-hidden','false');
    el.setAttribute('data-turno-id', String(turnoId));
    document.body.classList.add('tp-open');
    const btnClose = UI?.tp?.close || el.querySelector('#tp-close');
    btnClose?.addEventListener('click', inicioHideTurnoPanel, { once:true });
    btnClose?.focus?.();
  }
}


export function initPaymentsBridge() {
  // Busca botones con data-open-pago="TURNOID"
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
}
