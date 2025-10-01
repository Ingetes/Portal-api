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

        // --- Limpieza fuerte de markdown y ruido ---
        txt = txt
          .replace(/\u00A0/g,' ')
          .replace(/\r/g,'')
          // quita imágenes: ![alt](url)
          .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
          // quita enlaces dejando el texto: [text](url)
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          // compacta espacios
          .replace(/[ \t]+/g,' ');

        const linesAll = txt.split('\n').map(s => s.trim());

        // Filtra ruido típico
        const lines = linesAll.filter(s =>
          s &&
          s.length > 1 &&
          !/^(siemens|industry|mall|home)$/i.test(s) &&
          !/(cookies|consent|privacy|login|cart|search)/i.test(s) &&
          !/^image\s*\d*:/i.test(s) &&            // "Image 1: ..."
          !/^\*+$/.test(s)                        // listas/guiones
        );

        // Encuentra ancla: MLFB o título/tab Overview
        const idxOverview = indexOfFirst(lines, [
          s => s.toUpperCase() === String(mlfb).toUpperCase(),
          s => /^(overview|vista general)$/i.test(s)
        ]);

        // Construye párrafo técnico a partir del ancla
        let paragraph = pickParagraph(lines, Math.max(0, idxOverview));

        // Si quedó flojo, busca en todo el doc
        if (!isGood(paragraph)) paragraph = pickParagraph(lines, 0);

        let description = (paragraph || '').replace(/\s+/g,' ').trim();
        // corta cuando aparecen encabezados de otras tabs
        description = description.split(/\b(Specifications|Especificaciones|Documents? & downloads|Support|Soporte)\b/i)[0].trim();

        if (description.length > 900) description = description.slice(0,900) + '…';

        if (isGood(description) && score(description) > score(best.description)) {
          best = { description, source };
        }
        if (score(best.description) >= 70) break;
      } catch { /* prueba siguiente idioma */ }
    }

    if (!best.description) best.description = `${mlfb} — ver ficha en Industry Mall.`;
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
  // Toma el primer bloque de frases técnicas consecutivas
  const stopper = /(Specifications|Especificaciones|Documents? & downloads|Support|Soporte)/i;
  const isTitle = (s) =>
    /^[A-Z0-9._-]{6,}$/.test(s) ||
    /^(overview|vista general)$/i.test(s);

  let cur = [];
  for (let i = fromIdx; i < lines.length; i++) {
    const s = lines[i];
    if (!s || isTitle(s) || stopper.test(s)) {
      if (isGood(cur.join(' '))) break;    // ya tenemos algo
      cur = [];
      continue;
    }
    cur.push(s);
    const joined = cur.join(' ');
    // si ya parece un buen párrafo, devuélvelo
    if (isGood(joined) && /[.;:]$/.test(s)) return joined;
    // corta si creció demasiado
    if (joined.length > 600) return joined;
  }
  const joined = cur.join(' ');
  return isGood(joined) ? joined : '';
}

function isGood(s){
  if (!s) return false;
  const t = s.trim();
  if (t.length < 60) return false;
  // heurística técnica
  const tech = /\b(AC|DC|V|A|kA|kW|mm|IP\d{2}|UL|IEC|breaker|contactor|module|módulo|input|output|I\/O|short-?circuit|overload|frame|3[- ]?pole|3P|ET\s?200|LOGO!|PLC|bus\sbar|protection)\b/i;
  return tech.test(t) || t.length > 140;
}

function score(s){
  if (!s) return 0;
  const base = Math.min(s.length, 600)/10;
  const bonus = /\b(AC|DC|V|A|kA|kW|mm|IP\d{2}|UL|IEC|breaker|contactor|module|módulo|I\/O)\b/i.test(s) ? 40 : 0;
  return base + bonus;
}
