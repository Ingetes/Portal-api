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

    // 1) Intentar directamente SiePortal (donde está el Overview real)
    const sieCandidates = [
      `https://sieportal.siemens.com/en-ww/product/${encodeURIComponent(mlfb)}`,
      `https://sieportal.siemens.com/en-ww/search?q=${encodeURIComponent(mlfb)}`,
      `https://sieportal.siemens.com/es-co/product/${encodeURIComponent(mlfb)}`,
      `https://sieportal.siemens.com/es-co/search?q=${encodeURIComponent(mlfb)}`
    ];

    let best = { description:'', source:'' };

    for (const url of sieCandidates) {
      const text = await fetchText(url);
      if (!text) continue;

      // Si fue página de búsqueda, intenta localizar el primer /product/ en el html plano
      const found = sniffSiePortalProductUrl(text) || url;
      const body = found !== url ? await fetchText(found) : text;

      const desc = extractOverview(body, mlfb);
      if (score(desc) > score(best.description)) best = { description: desc, source: found };
      if (score(best.description) >= 80) break;
    }

    // 2) Si aún no logramos una buena, intenta con el Mall (limpieza agresiva)
    if (score(best.description) < 60) {
      const langs = ['en','es','de'];
      for (const lang of langs) {
        const mallUrl = `https://mall.industry.siemens.com/mall/${lang}/ww/Catalog/Product/?mlfb=${encodeURIComponent(mlfb)}`;
        const mallTxt = await fetchText(mallUrl);
        if (!mallTxt) continue;

        // si el Mall enlaza SiePortal, usarlo
        const sieUrl = sniffSiePortalUrl(mallTxt);
        if (sieUrl) {
          const sieTxt = await fetchText(sieUrl);
          const desc = extractOverview(sieTxt, mlfb);
          if (score(desc) > score(best.description)) best = { description: desc, source: sieUrl };
          if (score(best.description) >= 80) break;
        }

        // si no, cortar el propio Mall alrededor del Overview
        const descMall = extractOverviewFromMall(mallTxt, mlfb);
        if (score(descMall) > score(best.description)) best = { description: descMall, source: mallUrl };
        if (score(best.description) >= 80) break;
      }
    }

    // 3) Fallback
    if (!best.description) best = { description: `${mlfb} — ver ficha en Industry Mall.`, source: '' };

    // 4) Recorte especial pedido: hasta "keeper kit" (incluido) para 3VA
    if (/^3VA/i.test(mlfb)) {
      const i = best.description.toLowerCase().indexOf('keeper kit');
      if (i >= 0) best.description = best.description.slice(0, i + 'keeper kit'.length).trim();
    }

    // 5) Limitar longitud final
    if (best.description.length > 900) best.description = best.description.slice(0,900) + '…';

    return res.status(200).json({ ok:true, source: best.source, description: best.description });
  } catch (e) {
    return res.status(200).json({ ok:false, msg: e?.message || 'Error', description:'' });
  }
}

/* ================= helpers ================= */

// Usa el proxy de texto (sin headless). Devuelve markdown plano del HTML.
async function fetchText(url){
  try{
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
function sniffSiePortalProductUrl(txt){
  const m = txt.match(/https?:\/\/sieportal\.siemens\.com\/[a-z-]+\/product\/[^\s)]+/i);
  return m ? m[0] : '';
}

function baseClean(s){
  return s
    .replace(/!\[[^\]]*]\([^)]+\)/g,' ')   // imágenes ![...](...)
    .replace(/\[([^\]]+)\]\([^)]+\)/g,'$1')// enlaces [txt](url) -> txt
    .replace(/^[#>*\-\s]+/gm,'')           // headings markdown y bullets
    .replace(/[ \t]+/g,' ')
    .trim();
}

// Extrae el párrafo de Overview desde SiePortal
function extractOverview(raw, mlfb){
  if (!raw) return '';
  let t = baseClean(raw);

  // ancla: MLFB o "Overview"
  let i = t.toUpperCase().indexOf(String(mlfb).toUpperCase());
  if (i < 0) {
    const w = t.search(/\b(Overview|Vista general)\b/i);
    i = w >= 0 ? w : 0;
  }
  // ventana local
  let win = t.slice(Math.max(0, i - 600), i + 5000);

  // “tijeras” por secciones típicas
  win = win.split(/\b(Specifications|Especificaciones|Documents?\s*&\s*downloads|Support|Soporte|Related products?)\b/i)[0];

  // limpieza de ruido
  win = stripMallNoise(win);

  // párrafo técnico
  const lines = win.split('\n').map(s=>s.trim()).filter(Boolean);
  let desc = pickParagraph(lines);

  desc = desc.replace(/\s+/g,' ').trim();
  return isGood(desc) ? desc : '';
}

// Extrae desde el propio Mall si no hay SiePortal
function extractOverviewFromMall(raw, mlfb){
  if (!raw) return '';
  let t = baseClean(raw);

  // ancla en MLFB/Overview
  let i = t.toUpperCase().indexOf(String(mlfb).toUpperCase());
  if (i < 0) {
    const w = t.search(/\b(Overview|Vista general)\b/i);
    i = w >= 0 ? w : 0;
  }
  let win = t.slice(Math.max(0, i - 600), i + 6000);
  win = win.split(/\b(Specifications|Especificaciones|Documents?\s*&\s*downloads|Support|Soporte|Related products?)\b/i)[0];
  win = stripMallNoise(win);

  const lines = win.split('\n').map(s=>s.trim()).filter(Boolean);
  let desc = pickParagraph(lines);

  desc = desc.replace(/\s+/g,' ').trim();
  return isGood(desc) ? desc : '';
}

// Remueve bloques que te estaban saliendo (“Updates…”, “See all…”, etc.)
function stripMallNoise(s){
  return s
    .replace(/Based on trending topics[\s\S]*?(Stories Carousel|Slide \d+ of \d+)/i,' ')
    .replace(/\b(Updates? for|See all (product notes|characteristics|FAQs|catalogs|brochures|certificates|downloads|application examples|product (data|images)))\b[\s\S]*?(\d{2}\/\d{2}\/\d{4}|$)/gi,' ')
    .replace(/\b(FAQ|GSD:|EU Declaration of Conformity|Chiller Plant|Buy now|Add to cart|Print|Download|Application example|Catalog(\/| )brochure)\b[\s\S]*?$/gi,' ');
}

function pickParagraph(lines){
  const stop = /(Specifications|Especificaciones|Documents?\s*&\s*downloads|Support|Soporte|Related products?)/i;
  const looksTitle = s => /^[A-Z0-9._-]{6,}$/.test(s) || /^(Overview|Vista general)$/i.test(s);

  let cur = [];
  for (let i=0;i<lines.length;i++){
    const s = lines[i];
    if (!s || looksTitle(s) || stop.test(s)) {
      if (isGood(cur.join(' '))) break;
      cur = [];
      continue;
    }
    // filtros línea a línea (ruido)
    if (/^(Updates?|See all|Catalog(\/| )brochure|Application example|FAQ|Certificates?|GSD:|Download|Product note)/i.test(s)) continue;

    cur.push(s);
    const joined = cur.join(' ');
    if (isGood(joined) && /[.;:]$/.test(s)) return joined;
    if (joined.length > 700) return joined; // no comerse todo
  }
  const joined = cur.join(' ');
  return isGood(joined) ? joined : '';
}

function isGood(s){
  if (!s || s.length < 60) return false;
  const tech = /\b(AC|DC|V|A|kA|kW|mm|IP\d{2}|UL|IEC|breaker|contactor|module|módulo|input|output|I\/O|short-?circuit|overload|frame|3[- ]?pole|3P|ET\s?200|LOGO!|PLC|bus\s*bar|protection|diagnostics|In=|Icu=|Ir=|Ii=|24V|24 V|type\s*\d|\bPNP\b|\bIEC\s*61131\b)\b/i;
  return tech.test(s) || s.length > 140;
}
function score(s){ if (!s) return 0; const base = Math.min(s.length,600)/10; const bonus = /\b(AC|DC|V|A|kA|kW|mm|IP\d{2}|UL|IEC|breaker|module|I\/O)\b/i.test(s)?40:0; return base+bonus; }
