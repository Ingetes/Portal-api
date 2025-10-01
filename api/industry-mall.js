// api/industry-mall.js
export default async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { mlfb } = req.query;
    if (!mlfb) return res.status(400).json({ ok:false, msg:'Falta mlfb', description:'' });

    const langs = ['en','es','de'];
    let best = { description:'', source:'' };

    for (const lang of langs) {
      const mallUrl = `https://mall.industry.siemens.com/mall/${lang}/ww/Catalog/Product/?mlfb=${encodeURIComponent(mlfb)}`;
      const mallTxt = await fetchText(mallUrl);
      if (!mallTxt) continue;

      // 1) ¿El Mall remite a SiePortal?
      let sieUrl = sniffSiePortalUrl(mallTxt);
      // 1.1 Si no lo trae, intentamos buscarlo en SiePortal
      if (!sieUrl) sieUrl = await findSiePortalBySearch(mlfb);

      // 2) Intento con SiePortal primero (cuando existe)
      if (sieUrl) {
        const sieTxt = await fetchText(sieUrl);
        const d = extractOverview(sieTxt, mlfb, /*isSie=*/true);
        if (score(d) > score(best.description)) best = { description: d, source: mallUrl };
      }

      // 3) Intento con el propio Mall (limpiando ruido agresivo)
      const dMall = extractOverview(mallTxt, mlfb, /*isSie=*/false);
      if (score(dMall) > score(best.description)) best = { description: dMall, source: mallUrl };

      if (score(best.description) >= 75) break;
    }

    if (!best.description) best.description = `${mlfb} — ver ficha en Industry Mall.`;
    return res.status(200).json({ ok:true, source: best.source, description: best.description });

  } catch (e) {
    return res.status(200).json({ ok:false, msg: e?.message || 'Error', description:'' });
  }
}

/* ========== helpers ========== */

async function fetchText(url){
  try {
    const proxy = `https://r.jina.ai/http://${url.replace(/^https?:\/\//,'')}`;
    const r = await fetch(proxy, { headers:{ Accept:'text/plain' }, cache:'no-store' });
    if (!r.ok) return '';
    return (await r.text() || '').replace(/\u00A0/g,' ').replace(/\r/g,'');
  } catch { return ''; }
}

function sniffSiePortalUrl(txt){
  const m = txt.match(/https?:\/\/sieportal\.siemens\.com\/[^\s)]+/i);
  return m ? m[0] : '';
}

// Búsqueda básica en SiePortal por MLFB y toma el primer /product/
async function findSiePortalBySearch(mlfb){
  try {
    const q = `https://sieportal.siemens.com/en-ww/search?q=${encodeURIComponent(mlfb)}`;
    const t = await fetchText(q);
    const m = t.match(/https?:\/\/sieportal\.siemens\.com\/[a-z-]+\/product\/[^\s)]+/i);
    return m ? m[0] : '';
  } catch { return ''; }
}

function extractOverview(raw, mlfb, isSie){
  if (!raw) return '';

  // Limpieza fuerte
  let t = raw
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')     // imágenes ![...](...)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // enlaces [txt](url) -> txt
    .replace(/^[#>*\-\s]+/gm, '')             // headings markdown
    .replace(/[ \t]+/g, ' ');

  // Ventana local alrededor de MLFB o "Overview"
  const up = String(mlfb).toUpperCase();
  let idx = t.toUpperCase().indexOf(up);
  if (idx < 0) {
    const i2 = t.search(/\b(Overview|Vista general)\b/i);
    idx = i2 >= 0 ? i2 : 0;
  }
  let win = t.slice(Math.max(0, idx - 600), idx + 6000);

  // Cortes por secciones
  win = win.split(/\b(Specifications|Especificaciones|Documents?\s*&\s*downloads|Support|Soporte|Related products?)\b/i)[0];

  // Quitar ruido típico del Mall (lo que te estaba saliendo)
  const noise = [
    /Based on trending topics[\s\S]*?(Stories Carousel|Slide \d+ of \d+)/i,
    /\b(Updates? for|See all (product notes|characteristics|FAQs|catalogs|brochures|certificates|downloads|application examples|product (data|images)))\b[\s\S]*?(\d{2}\/\d{2}\/\d{4}|\)|$)/gi,
    /\b(FAQ|GSD:|EU Declaration of Conformity|Chiller Plant|Buy now|Add to cart|Print)\b[\s\S]*?$/gi
  ];
  for (const re of noise) win = win.replace(re, ' ');

  // Línea por línea
  const lines = win.split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !/^Image\s*\d*:/.test(s))
    .filter(s => !/^Slide \d+ of \d+$/i.test(s))
    .filter(s => !/(cookies|privacy|login|cart|search|terms)/i.test(s))
    .filter(s => s.length > 2);

  // Primer párrafo claramente técnico
  let desc = pickParagraph(lines);

  // Recorte especial pedido para 3VA: “keeper kit”
  const kk = desc.toLowerCase().indexOf('keeper kit');
  if (kk >= 0) desc = desc.slice(0, kk + 'keeper kit'.length);

  desc = desc.replace(/\s+/g, ' ').trim();
  if (desc.length > 900) desc = desc.slice(0, 900) + '…';

  // Si SiePortal y quedó flojo, reintenta con todo el doc (a veces el Overview está lejos)
  if (isSie && !isGood(desc)) {
    desc = pickParagraph(
      t.split('\n').map(s => s.trim()).filter(Boolean)
    ).replace(/\s+/g,' ').trim();
  }

  return isGood(desc) ? desc : '';
}

function pickParagraph(lines){
  const stop = /(Specifications|Especificaciones|Documents?\s*&\s*downloads|Support|Soporte|Related products?)/i;
  const looksTitle = s => /^[A-Z0-9._-]{6,}$/.test(s) || /^(Overview|Vista general)$/i.test(s);

  let cur = [];
  for (let i=0; i<lines.length; i++){
    const s = lines[i];
    if (!s || looksTitle(s) || stop.test(s)) {
      if (isGood(cur.join(' '))) break;
      cur = [];
      continue;
    }

    // Filtros de “ruido” línea-a-línea
    if (/^(Updates?|See all|Catalog(\/| )brochure|Application example|FAQ|Certificates?|GSD:|Download|Product note)/i.test(s)) continue;

    cur.push(s);
    const joined = cur.join(' ');
    if (isGood(joined) && /[.;:]$/.test(s)) return joined;
    if (joined.length > 700) return joined;
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
