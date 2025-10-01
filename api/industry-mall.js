// api/industry-mall.js
export default async function handler(req, res) {
  try {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { mlfb } = req.query;
    if (!mlfb || typeof mlfb !== 'string') {
      return res.status(400).json({ ok:false, msg:'Falta parámetro mlfb', description:'' });
    }

    const langs = ['en','es','de'];
    let best = { description:'', source:'' };

    for (const lang of langs) {
      const mallUrl = `https://mall.industry.siemens.com/mall/${lang}/ww/Catalog/Product/?mlfb=${encodeURIComponent(mlfb)}`;
      const mallTxt = await fetchText(mallUrl);
      if (!mallTxt) continue;

      // ¿hay salto a SiePortal?
      const sie = sniffSiePortalUrl(mallTxt);
      if (sie) {
        const sieTxt = await fetchText(sie);
        const desc = extractFromOverview(sieTxt, mlfb);
        if (score(desc) > score(best.description)) best = { description: desc, source: mallUrl };
        if (score(best.description) >= 70) break;
      }

      // Si no hay SiePortal o queremos intentar con el propio Mall
      const descMall = extractFromOverview(mallTxt, mlfb);
      if (score(descMall) > score(best.description)) best = { description: descMall, source: mallUrl };
      if (score(best.description) >= 70) break;
    }

    if (!best.description) best.description = `${mlfb} — ver ficha en Industry Mall.`;
    res.status(200).json({ ok:true, source: best.source, description: best.description });
  } catch (e) {
    res.status(200).json({ ok:false, msg:e?.message || 'Error interno', description:'' });
  }
}

/* ========== helpers ========== */

async function fetchText(url){
  try{
    // r.jina.ai devuelve el “texto visible” de la página como markdown plano
    const proxy = `https://r.jina.ai/http://${url.replace(/^https?:\/\//,'')}`;
    const r = await fetch(proxy, { headers:{ Accept:'text/plain' }, cache:'no-store' });
    if (!r.ok) return '';
    return (await r.text() || '').replace(/\u00A0/g,' ').replace(/\r/g,'');
  }catch{ return ''; }
}

function sniffSiePortalUrl(txt){
  const m = txt.match(/https?:\/\/sieportal\.siemens\.com\/[^\s)]+/i);
  return m ? m[0] : '';
}

function extractFromOverview(raw, mlfb){
  if (!raw) return '';

  // 0) limpieza fuerte de markdown y ruido
  let t = raw
    // quita imágenes: ![alt](url)
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    // reemplaza enlaces [txt](url) -> txt
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // quita headings markdown ###, **, etc.
    .replace(/^[#>*\-\s]+/gm, '')
    // compacta espacios
    .replace(/[ \t]+/g, ' ');

  // 1) ancla: posición de MLFB o de "Overview/Vista general"
  const up = mlfb.toUpperCase();
  let i = t.toUpperCase().indexOf(up);
  if (i < 0) {
    const idxOv = t.search(/\b(Overview|Vista general)\b/i);
    i = idxOv >= 0 ? idxOv : 0;
  }

  // 2) recorta una ventana alrededor del ancla (evita encabezados globales)
  const start = Math.max(0, i - 400);
  let win = t.slice(start, start + 5000);

  // 3) corta donde cambian de pestaña/sección
  win = win.split(/\b(Specifications|Especificaciones|Documents?\s*&\s*downloads|Support|Soporte)\b/i)[0];

  // 4) quitamos bloques conocidos de marketing/header/carrusel
  win = win
    .replace(/Based on trending topics[\s\S]*?(Stories Carousel|Slide \d+ of \d+|Product\s+###)/i, ' ')
    .replace(/\b(Buy now|Add to cart|Show (More|Less)|Print|Download product (images|data) .*?)\b/gi, ' ')
    .replace(/\b(Services|Trainings|News|Events|Application examples)\b:?.*$/i, ' ');

  // 5) líneas limpias
  const lines = win.split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    // fuera restos de navegación/marketing
    .filter(s => !/^(siemens|industry|mall|home)$/i.test(s))
    .filter(s => !/(cookies|consent|privacy|login|cart|search|terms)/i.test(s))
    .filter(s => !/^image\s*\d*:/i.test(s))
    .filter(s => !/^Slide \d+ of \d+$/i.test(s))
    .filter(s => s.length > 2);

  // 6) arma el primer párrafo técnico bueno
  let desc = pickParagraph(lines);

  // 7) recorte especial pedido: hasta "keeper kit"
  const kk = desc.toLowerCase().indexOf('keeper kit');
  if (kk >= 0) desc = desc.slice(0, kk + 'keeper kit'.length);

  // 8) limpieza final
  desc = desc.replace(/\s+/g,' ').trim();
  if (desc.length > 900) desc = desc.slice(0,900) + '…';

  return isGood(desc) ? desc : '';
}

function pickParagraph(lines){
  const stop = /(Specifications|Especificaciones|Documents?\s*&\s*downloads|Support|Soporte)/i;
  const looksTitle = s => /^[A-Z0-9._-]{6,}$/.test(s) || /^(Overview|Vista general)$/i.test(s);

  let cur = [];
  for (let i=0;i<lines.length;i++){
    const s = lines[i];
    if (!s || looksTitle(s) || stop.test(s)) {
      if (isGood(cur.join(' '))) break;
      cur = [];
      continue;
    }
    cur.push(s);

    // si ya tenemos buen bloque y la oración cerró, devuélvelo
    const joined = cur.join(' ');
    if (isGood(joined) && /[.;:]$/.test(s)) return joined;
    if (joined.length > 700) return joined; // evita “comerse” todo
  }
  const joined = cur.join(' ');
  return isGood(joined) ? joined : '';
}

function isGood(s){
  if (!s || s.length < 60) return false;
  const tech = /\b(AC|DC|V|A|kA|kW|mm|IP\d{2}|UL|IEC|breaker|contactor|module|módulo|input|output|I\/O|short-?circuit|overload|frame|3[- ]?pole|3P|ET\s?200|LOGO!|PLC|bus\s*bar|protection|diagnostics|In=|Icu=|Ir=|Ii=|24V|24 V)\b/i;
  return tech.test(s) || s.length > 140;
}
function score(s){ if (!s) return 0; const base = Math.min(s.length,600)/10; const bonus = /\b(AC|DC|V|A|kA|kW|mm|IP\d{2}|UL|IEC|breaker|module|I\/O)\b/i.test(s)?40:0; return base+bonus; }
