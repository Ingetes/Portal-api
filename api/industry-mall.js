// api/industry-mall.js
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

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

    const target = `https://mall.industry.siemens.com/mall/en/ww/Catalog/Product/?mlfb=${encodeURIComponent(mlfb)}`;

    const r = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; IngetesBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,es-CO;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      redirect: 'follow'
    });

    if (!r.ok) {
      return res.status(r.status).json({ ok:false, msg:`HTTP ${r.status}`, description:'', source: target });
    }

    const html = await r.text();
    const $ = cheerio.load(html);

    // 0) Título del producto (para fallback)
    const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || '';
    const h1Title  = $('h1').first().text().replace(/\s+/g,' ').trim();

    // 1) Meta description
    let description =
      $('meta[property="og:description"]').attr('content')?.trim() ||
      $('meta[name="description"]').attr('content')?.trim() || '';

    // 2) JSON-LD (si existiera)
    if (!description) {
      $('script[type="application/ld+json"]').each((_, el) => {
        if (description) return;
        try {
          const data = JSON.parse($(el).html() || '{}');
          const pick = (x) => (x?.description || x?.headline || x?.name || '').trim();
          if (Array.isArray(data)) {
            for (const item of data) {
              description = pick(item);
              if (description) break;
            }
          } else {
            description = pick(data);
          }
        } catch {}
      });
    }

    // 3) Bloques visibles (probamos varias clases/ids frecuentes)
    if (!description) {
      const candidates = [
        $('.product-description').text(),
        $('.productDetails__text').text(),
        $('.productDetails').text(),
        $('#productDescription').text(),
        $('.product-overview').text(),
        $('.product__description').text(),
        $('main').text(), // último recurso: texto largo
      ].filter(Boolean).map(t => t.replace(/\s+/g,' ').trim()).filter(t => t.length > 30);

      if (candidates.length) {
        // nos quedamos con el texto “más descriptivo”
        description = candidates.sort((a,b) => b.length - a.length)[0];
        // recortamos si es demasiado largo
        if (description.length > 900) description = description.slice(0, 900) + '…';
      }
    }

    // 4) Fallback final: usar título si no hay descripción
    if (!description) {
      const title = ogTitle || h1Title || mlfb;
      description = `${title} — ver ficha en Industry Mall.`;
    }

    // Limpieza
    description = description.replace(/\u00A0/g,' ').replace(/\s+/g,' ').trim();

    return res.status(200).json({ ok:true, source: target, description });
  } catch (e) {
    return res.status(500).json({ ok:false, msg: e?.message || 'Error interno', description:'' });
  }
}
