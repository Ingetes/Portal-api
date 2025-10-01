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

        const raw = (await r.text() || '').replace(/\u00A0/g,' ').replace(/\r/g,'');
        const linesAll = raw.split('\n').map(s => s.trim());

        // 1) filtra líneas obvias de navegación/ruido
        const lines = linesAll.filter(s =>
          s &&
          s.length > 2 &&
          !/^\*\s*\[/.test(s) &&                // enlaces tipo markdown "* [..](..)"
          !/^(siemens|industry|mall)$/i.test(s) &&
          !/(cookies|consent|privacy|login|cart|search)/i.test(s)
        );

        // 2) intenta anclar alrededor del título o del tab "Overview"
        const idxTitle = indexOfFirst(lines, [
          (s)=> s.toUpperCase() === mlfb.toUpperCase(),
          (s)=> /^(overview|vista general)$/i.test(s)
        ]);

        // 3) a partir de ese índice, busca el primer párrafo "descriptivo"
        const start = Math.max(0, idxTitle >= 0 ? idxTitle : 0);
        const paragraph = pickParagraph(lines, start);

        let description = paragraph || '';

        // Si todavía salió algo flojo, intenta en todo el documento
        if (!isGood(description)) {
          const paragraph2 = pickParagraph(lines, 0);
          if (isGood(paragraph2)) description = paragraph2;
        }

        // recorta y limpia
        description = (description || '').replace(/\s+/g,' ').trim();
        if (description.length > 900) description = description.slice(0, 900) + '…';

        if (isGood(description) && score(description) > score(best.description)) {
          best = { description, source };
        }

        if (score(best.description) >= 70) break; // ya es bastante buena
      } catch { /* intenta otro idioma */ }
    }

    if (!best.description) {
      best.description = `${mlfb} — ver ficha en Industry Mall.`;
    }

    return res.status(200).json({ ok:true, source: best.source, description: best.description });

  } catch (e) {
    return res.status(500).json({ ok:false, msg: e?.message || 'Error interno', description:'' });
  }
}

/* ===== helpers ===== */

function indexOfFirst(arr, testers) {
  for (let i = 0; i < arr.length; i++) {
    for (const t of testers) if (t(arr[i])) return i;
  }
  return -1;
}

function pickParagraph(lines, fromIdx) {
  // junta líneas consecutivas hasta un "corte" (línea vacía o título/tab),
  // y devuelve el primer bloque que parezca descripción técnica
  const blocks = [];
  let cur = [];

  const isCut = (s) =>
    !s ||
    s.length < 3 ||
    /^[A-Z0-9._-]{6,}$/.test(s) ||                // códigos puros
    /^(overview|vista general|specifications|especificaciones|documents.*downloads|support|soporte)$/i.test(s);

  for (let i = fromIdx; i < lines.length; i++) {
    const s = lines[i];
    if (isCut(s)) {
      if (cur.length) { blocks.push(cur.join(' ')); cur = []; }
      continue;
    }
    cur.push(s);
    // si la línea termina en punto, posible fin de oración
    if (/[.;:]$/.test(s) && cur.join(' ').length > 120) {
      blocks.push(cur.join(' ')); cur = [];
    }
  }
  if (cur.length) blocks.push(cur.join(' '));

  // prioriza bloques con vocabulario técnico y longitud suficiente
  const candidates = blocks
    .map(clean)
    .filter(isGood)
    .sort((a,b)=> score(b)-score(a));

  return candidates[0] || '';
}

function clean(s){ return (s||'').replace(/\s+/g,' ').trim(); }

function isGood(s){
  if (!s) return false;
  if (s.length < 60) return false;
  // evita quedarnos con la pura MLFB o con encabezados
  if (/^\*\s*\[/.test(s)) return false;
  // heurística: contiene términos técnicos o números/características
  const tech = /\b(AC|DC|V|A|kA|kW|mm|IP\d{2}|UL|IEC|breaker|contactor|module|módulo|input|output|I\/O|short-?circuit|overload|frame|3[- ]?pole|3P|ET\s?200|LOGO!|PLC)\b/i;
  return tech.test(s) || s.length > 140;
}

function score(s){
  if (!s) return 0;
  const base = Math.min(s.length, 600)/10;
  const bonus = /\b(AC|DC|V|A|kA|kW|mm|IP\d{2}|UL|IEC|breaker|contactor|module|módulo|I\/O)\b/i.test(s) ? 40 : 0;
  return base + bonus;
}
