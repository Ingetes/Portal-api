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
      const proxy = `https://r.jina.ai/http://mall.industry.siemens.com/mall/${lang}/ww/Catalog/Product/?mlfb=${encodeURIComponent(mlfb)}`;
      try {
        const r = await fetch(proxy, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (IngetesBot/1.0)',
            'Accept': 'text/plain'
          },
          // evita 403 por caches intermedios
          cache: 'no-store'
        });
        if (!r.ok) continue;

        const txt = (await r.text() || '').replace(/\u00A0/g,' ').replace(/\r/g,'').trim();
        if (!txt) continue;

        // Parse: nos quedamos con una línea “descriptiva”
        const lines = txt
          .split('\n')
          .map(s => s.trim())
          .filter(Boolean)
          // quitamos líneas muy cortas o típicas de navegación
          .filter(s => s.length >= 20 && !/^(siemens|industry|mall|login|cart|menu)/i.test(s))
          // fuera ruido de cookies, GDPR, etc.
          .filter(s => !/(cookies|consent|privacy|policy|terms|search)/i.test(s));

        // Intentar una que contenga términos técnicos (suele ser la descripción)
        const pick = (arr) => {
          const good = arr.find(s =>
            /\b(AC|DC|V|A|kW|kA|mm|IP\d{2}|UL|CE|IEC|module|módulo|breaker|contactor|input|output|I\/O|ET\s?200|LOGO!|PLC)\b/i.test(s)
          );
          return good || arr[0] || '';
        };

        let description = pick(lines);
        // Evitar quedarnos con el puro MLFB como “descripción”
        if (new RegExp(`\\b${escapeRegExp(mlfb)}\\b`).test(description) && description.length < 40) {
          // Busca la siguiente línea útil
          const idx = lines.indexOf(description);
          description = pick(lines.slice(idx + 1)) || description;
        }

        description = description.replace(/\s+/g,' ').trim();
        if (description.length > 900) description = description.slice(0, 900) + '…';

        // guardamos la mejor (por longitud y presencia de términos técnicos)
        const score = (s) => !s ? 0 :
          Math.min(s.length, 600)/10 + (/\b(AC|DC|V|A|kW|mm|IP|UL|IEC|module|módulo|breaker|contactor|I\/O)\b/i.test(s) ? 40 : 0);
        if (score(description) > score(best.description)) {
          best = { description, source };
        }
        if (score(best.description) >= 60) break; // suficiente
      } catch { /* intenta siguiente idioma */ }
    }

    if (!best.description) {
      best.description = `${mlfb} — ver ficha en Industry Mall.`;
    }
    return res.status(200).json({ ok:true, source: best.source, description: best.description });
  } catch (e) {
    return res.status(500).json({ ok:false, msg: e?.message || 'Error interno', description:'' });
  }
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
