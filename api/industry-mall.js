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

    const langs = ['en', 'es', 'de'];
    let best = { description: '', source: '' };

    for (const lang of langs) {
      const source = `https://mall.industry.siemens.com/mall/${lang}/ww/Catalog/Product/?mlfb=${encodeURIComponent(mlfb)}`;
      const proxy  = `https://r.jina.ai/http://mall.industry.siemens.com/mall/${lang}/ww/Catalog/Product/?mlfb=${encodeURIComponent(mlfb)}`;

      try {
        const r = await fetch(proxy, { headers: { 'Accept': 'text/plain' }, cache: 'no-store' });
        if (!r.ok) continue;

        let txt = await r.text();
        if (!txt) continue;

        // --- Limpieza fuerte de markdown y ruido global ---
        txt = sanitizeRaw(txt);

        const linesAll = txt.split('\n').map(s => s.trim());

        // Filtra ruido típico línea a línea
        const lines = linesAll.filter(s =>
          s &&
          s.length > 1 &&
          !/^(siemens|industry|mall|home)$/i.test(s) &&
          !/(cookies|consent|privacy|login|cart|search|terms)/i.test(s) &&
          !/^image\s*\d*:/i.test(s) &&
          !/^slide\s*\d+\s*of\s*\d+$/i.test(s) &&
          !/^stories? carousel/i.test(s) &&
          !/^(updates?|see all|catalog(\/| )brochure|application example|faq|certificates?|gsd:|download|product note)/i.test(s)
        );

        // Encuentra ancla: MLFB o tab Overview
        const idxOverview = indexOfFirst(lines, [
          s => s.toUpperCase() === String(mlfb).toUpperCase(),
          s => /^(overview|vista general)$/i.test(s)
        ]);

        // Construye párrafo técnico a partir del ancla
        let paragraph = pickParagraph(lines, Math.max(0, idxOverview));

        // Si quedó flojo, busca en todo el doc
        if (!isGood(paragraph)) paragraph = pickParagraph(lines, 0);

        // Post-procesado: cortar secciones y quedarnos con la frase útil
        let description = finalize(paragraph, mlfb);

        if (isGood(description) && score(description) > score(best.description)) {
          best = { description, source };
        }
        if (score(best.description) >= 70) break;
      } catch { /* siguiente idioma */ }
    }

    if (!best.description) best.description = `${mlfb} — ver ficha en Industry Mall.`;
    return res.status(200).json({ ok:true, source: best.source, description: best.description });

  } catch (e) {
    return res.status(500).json({ ok:false, msg: e?.message || 'Error interno', description:'' });
  }
}

/* ===== helpers ===== */

// Limpia markdown y bloques de ruido grandes
function sanitizeRaw(txt){
  return txt
    .replace(/\u00A0/g,' ')
    .replace(/\r/g,'')
    // imágenes: ![alt](url)
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    // enlaces: [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // headings/bullets
    .replace(/^[#>*\-\s]+/gm, '')
    // “based on trending… stories carousel…”
    .replace(/Based on trending topics[\s\S]*?(Stories Carousel|Slide \d+ of \d+)/i, ' ')
    // “See all … / Updates for … / Download product …”
    .replace(/\b(Updates? for|See all (product notes|characteristics|FAQs|catalogs|brochures|certificates|downloads|application examples|product (data|images)))\b[\s\S]*?($|\n)/gi,' ')
    // bloque “Title/Source/Published Time”
    .replace(/^Title:.*$|^Source:.*$|^Published Time:.*$/gmi, '')
    // compactar espacios
    .replace(/[ \t]+/g,' ');
}

function indexOfFirst(arr, testers) {
  for (let i = 0; i < arr.length; i++) {
    for (const t of testers) if (t(arr[i])) return i;
  }
  return -1;
}

function pickParagraph(lines, fromIdx) {
  const stopper = /(Specifications|Especificaciones|Documents?\s*&\s*downloads|Support|Soporte|Related products?)/i;
  const isTitle = (s) =>
    /^[A-Z0-9._-]{6,}$/.test(s) ||
    /^(overview|vista general)$/i.test(s);

  let cur = [];
  for (let i = fromIdx; i < lines.length; i++) {
    const s = lines[i];

    if (!s || isTitle(s) || stopper.test(s)) {
      if (isGood(cur.join(' '))) break;
      cur = [];
      continue;
    }

    // filtros línea-a-línea de ruido residual
    if (/^(updates?|see all|catalog(\/| )brochure|application example|faq|certificates?|gsd:|download|product note)/i.test(s)) {
      continue;
    }

    cur.push(s);
    const joined = cur.join(' ');
    if (isGood(joined) && /[.;:]$/.test(s)) return joined;  // ya hay una oración técnica
    if (joined.length > 700) return joined;                  // no comerse todo
  }
  const joined = cur.join(' ');
  return isGood(joined) ? joined : '';
}

function finalize(text, mlfb){
  if (!text) return '';
  let desc = text;

  // Corte duro cuando aparecen otras secciones en el mismo bloque
  desc = desc.split(/\b(Specifications|Especificaciones|Documents?\s*&\s*downloads|Support|Soporte|Related products?)\b/i)[0];

  // Para 3VA: cortar exactamente en “keeper kit” (incluido)
  const kk = desc.toLowerCase().indexOf('keeper kit');
  if (kk >= 0) desc = desc.slice(0, kk + 'keeper kit'.length);

  // Si aún es largo, quedarnos con la primera oración técnica “grande”
  if (desc.length > 250) {
    const m = desc.match(/^(.{80,300}?)(?:\.|;|:)(\s|$)/); // 1ª oración larga
    if (m) desc = m[1];
  }

  // Limpieza final
  desc = desc.replace(/\s+/g,' ').trim();

  // Evitar que se quede con el código solo
  if (new RegExp(`^${escapeRegExp(String(mlfb))}\\b`, 'i').test(desc) && desc.length < 40) {
    return '';
  }
  return desc;
}

function isGood(s){
  if (!s) return false;
  const t = s.trim();
  if (t.length < 60) return false;
  const tech = /\b(AC|DC|V|A|kA|kW|mm|IP\d{2}|UL|IEC|breaker|contactor|module|módulo|input|output|I\/O|short-?circuit|overload|frame|3[- ]?pole|3P|ET\s?200|LOGO!|PLC|bus\s*bar|protection|diagnostics|In=|Icu=|Ir=|Ii=|24V|24 V|type\s*\d|\bPNP\b|\bIEC\s*61131\b)\b/i;
  return tech.test(t) || t.length > 140;
}

function score(s){
  if (!s) return 0;
  const base = Math.min(s.length, 600)/10;
  const bonus = /\b(AC|DC|V|A|kW|kA|mm|IP\d{2}|UL|IEC|breaker|module|I\/O)\b/i.test(s) ? 40 : 0;
  return base + bonus;
}

function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
