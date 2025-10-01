// api/industry-mall.js
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(200).end(); return;
    }

    const { mlfb } = req.query;
    if (!mlfb || typeof mlfb !== 'string') {
      res.status(400).json({ ok:false, msg: 'Falta parámetro mlfb' });
      return;
    }

    const target = `https://mall.industry.siemens.com/mall/en/ww/Catalog/Product/?mlfb=${encodeURIComponent(mlfb)}`;

    const r = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; IngetesBot/1.0)',
        'Accept-Language': 'en-US,en;q=0.8,es-CO;q=0.7'
      },
      redirect: 'follow',
      timeout: 20000
    });

    if (!r.ok) {
      res.status(r.status).json({ ok:false, msg:`HTTP ${r.status}`, description:'' });
      return;
    }

    const html = await r.text();
    const $ = cheerio.load(html);

    // 1) Intento por meta tags
    let description =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      '';

    // 2) Intento por JSON embebido (siemens a veces mete datos estructurados)
    if (!description) {
      const scripts = Array.from($('script[type="application/ld+json"]')).map(s => $(s).html());
      for (const sc of scripts) {
        try {
          const data = JSON.parse(sc);
          // puede ser objeto o array; buscamos description en cualquiera
          const pick = (obj) => (obj && (obj.description || obj.headline || obj.name)) || '';
          if (Array.isArray(data)) {
            for (const item of data) {
              description = pick(item);
              if (description) break;
            }
          } else {
            description = pick(data);
          }
          if (description) break;
        } catch {}
      }
    }

    // 3) Intento por selectores visibles comunes (ajústalos si ves otra estructura)
    if (!description) {
      // títulos / bloques de características
      const txts = [
        $('.product-description').text(),
        $('.productDetails__text').text(),
        $('.productDetails').text(),
        $('#productDescription').text(),
        $('main').text()
      ].filter(Boolean);
      // escoger la línea más "útil" (más larga y limpia)
      description = txts
        .map(t => (t || '').replace(/\s+/g,' ').trim())
        .sort((a,b)=> b.length - a.length)[0] || '';
      // corta si es demasiado larga
      if (description.length > 1000) {
        description = description.slice(0, 1000) + '…';
      }
    }

    // Limpieza final
    description = (description || '')
      .replace(/\s+/g, ' ')
      .replace(/\u00A0/g,' ')
      .trim();

    res.status(200).json({ ok:true, source: target, description });
  } catch (e) {
    res.status(500).json({ ok:false, msg: (e && e.message) || 'Error interno', description:'' });
  }
}
