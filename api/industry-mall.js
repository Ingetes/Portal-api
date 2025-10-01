// api/industry-mall.js
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

export default async function handler(req, res) {
  try {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { mlfb } = req.query;
    if (!mlfb || typeof mlfb !== 'string') {
      return res.status(400).json({ ok: false, msg: 'Falta parámetro mlfb', description: '' });
    }

    // Intentaremos en varios idiomas/región
    const langs = ['en', 'es', 'de'];
    let best = { description: '', source: '' };

    for (const lang of langs) {
      const url = `https://mall.industry.siemens.com/mall/${lang}/ww/Catalog/Product/?mlfb=${encodeURIComponent(
        mlfb
      )}`;
      const out = await scrapeOnce(url);
      if (score(out.description) > score(best.description)) best = out;
      if (score(best.description) >= 60) break; // ya es suficientemente buena
    }

    // Fallback final: usa título si nada salió
    if (!best.description) {
      best.description = `${mlfb} — ver ficha en Industry Mall.`;
    }

    return res.status(200).json({ ok: true, source: best.source, description: best.description });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, msg: e?.message || 'Error interno', description: '' });
  }
}

function score(s) {
  if (!s) return 0;
  // Heurística simple: largo + presencia de números/letras/guiones propios de MLFB
  const len = Math.min(s.length, 600);
  const bonus = /\b(AC|DC|V|A|kW|mm|IP|UL|CE|IEC|terminal|breaker|contactor|module|I\/O)\b/i.test(s)
    ? 40
    : 0;
  return len / 10 + bonus;
}

async function scrapeOnce(target) {
  const r = await fetch(target, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
    redirect: 'follow',
  });

  const finalUrl = r.url || target;
  if (!r.ok) return { description: '', source: finalUrl };

  const html = await r.text();
  const $ = cheerio.load(html);

  // 1) Meta
  let description =
    $('meta[property="og:description"]').attr('content')?.trim() ||
    $('meta[name="description"]').attr('content')?.trim() ||
    '';

  // 2) __NEXT_DATA__ (Next.js)
  if (!description) {
    const nextData = $('#__NEXT_DATA__').html();
    if (nextData) {
      try {
        const data = JSON.parse(nextData);
        // Busca campos típicos de producto
        description =
          findAny(data, [
            'shortText',
            'shorttext',
            'short_description',
            'shortDescription',
            'longText',
            'longDescription',
            'marketingText',
            'description',
          ]) || '';
      } catch {}
    }
  }

  // 3) __INITIAL_STATE__ u otros globales
  if (!description) {
    const scripts = [];
    $('script:not([type]) , script[type="text/javascript"]').each((_, el) => {
      const txt = $(el).html() || '';
      if (txt && txt.length > 200) scripts.push(txt);
    });

    for (const sc of scripts) {
      // window.__INITIAL_STATE__ = {...}
      let m = sc.match(/__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?/);
      if (!m) m = sc.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?/);
      if (!m) m = sc.match(/window\.__DATA__\s*=\s*(\{[\s\S]*?\});?/);
      if (m) {
        try {
          const json = JSON.parse(sanitizeJson(m[1]));
          description =
            findAny(json, [
              'shortText',
              'shorttext',
              'short_description',
              'shortDescription',
              'longText',
              'longDescription',
              'marketingText',
              'description',
            ]) || '';
          if (description) break;
        } catch {}
      }
    }
  }

  // 4) Bloques visibles
  if (!description) {
    const candidates = [
      $('.product-description').text(),
      $('.productDetails__text').text(),
      $('.productDetails').text(),
      $('#productDescription').text(),
      $('.product-overview').text(),
      $('.product__description').text(),
      $('article').text(),
      $('main').text(),
    ]
      .filter(Boolean)
      .map((t) => t.replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 30);

    if (candidates.length) {
      description = candidates.sort((a, b) => b.length - a.length)[0];
      if (description.length > 900) description = description.slice(0, 900) + '…';
    }
  }

  // 5) Título como refuerzo (a veces el “título” trae el tipo de aparato)
  if (description.length < 30) {
    const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || '';
    const h1Title = $('h1').first().text().replace(/\s+/g, ' ').trim();
    const title = ogTitle || h1Title;
    if (title && !description.includes(title)) {
      description = `${title}. ${description}`.trim();
    }
  }

  description = description.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  return { description, source: finalUrl };
}

function sanitizeJson(s) {
  // Algunos sitios ponen comas finales o comentarios; limpiamos lo más común
  return s
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']')
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function findAny(obj, keys) {
  try {
    const stack = [obj];
    while (stack.length) {
      const cur = stack.pop();
      if (cur && typeof cur === 'object') {
        for (const k of keys) {
          if (k in cur && typeof cur[k] === 'string' && cur[k].trim()) {
            return cur[k].trim();
          }
        }
        for (const v of Object.values(cur)) {
          if (v && typeof v === 'object') stack.push(v);
        }
      }
    }
  } catch {}
  return '';
}
