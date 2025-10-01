import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

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
      return res.status(400).json({ ok:false, msg:'Falta parámetro mlfb', description:'' });
    }

    const execPath = await chromium.executablePath();
    const browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: chromium.defaultViewport,
      executablePath: execPath,
      headless: chromium.headless
    });
    const page = await browser.newPage();
    await page.setUserAgent(UA);

    const langs = ['en', 'es', 'de'];
    let description = '';
    let source = '';

    for (const lang of langs) {
      const url = `https://mall.industry.siemens.com/mall/${lang}/ww/Catalog/Product/?mlfb=${encodeURIComponent(mlfb)}`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Intento de aceptar cookies si aparece
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button, a')).find(
            el => /accept all|accept|agree|aceptar|zustimmen/i.test(el.textContent || '')
          );
          btn && btn.click();
        });
        await page.waitForTimeout(1200);

        // Espera que cargue algo de contenido principal
        try { await page.waitForSelector('h1, main, #__NEXT_DATA__', { timeout: 5000 }); } catch {}

        const grabbed = await page.evaluate(() => {
          const pickText = sel =>
            Array.from(document.querySelectorAll(sel))
              .map(n => (n.textContent || '').replace(/\s+/g, ' ').trim())
              .filter(Boolean);

          // 1) meta
          const meta =
            document.querySelector('meta[property="og:description"]')?.content ||
            document.querySelector('meta[name="description"]')?.content ||
            '';

          // 2) Next.js data
          let jsonDesc = '';
          try {
            const next = document.getElementById('__NEXT_DATA__')?.textContent;
            if (next) {
              const data = JSON.parse(next);
              const keys = ['shortText','shorttext','short_description','shortDescription','longText','longDescription','marketingText','description'];
              const stack = [data];
              while (stack.length) {
                const cur = stack.pop();
                if (cur && typeof cur === 'object') {
                  for (const k of keys) {
                    if (typeof cur[k] === 'string' && cur[k].trim()) return { jsonDesc: cur[k] };
                  }
                  for (const v of Object.values(cur)) if (v && typeof v === 'object') stack.push(v);
                }
              }
            }
          } catch {}

          // 3) Bloques visibles
          const cands = [
            ...pickText('.product-description'),
            ...pickText('.productDetails__text'),
            ...pickText('#productDescription'),
            ...pickText('.product-overview'),
            ...pickText('.product__description'),
            ...pickText('article'),
            ...pickText('main')
          ].filter(t => t.length > 30);

          const h1 = (document.querySelector('h1')?.textContent || '').replace(/\s+/g, ' ').trim();

          return { meta, cands, h1, jsonDesc };
        });

        let cand =
          grabbed.jsonDesc?.jsonDesc ||
          grabbed.meta ||
          grabbed.cands.sort((a,b) => b.length - a.length)[0] ||
          '';

        cand = (cand || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
        if (!cand || cand.length < 25) {
          const title = grabbed.h1 || '';
          if (title) cand = `${title}. ${cand}`.trim();
        }

        if (cand && cand.length > 25) {
          description = cand.length > 900 ? cand.slice(0, 900) + '…' : cand;
          source = url;
          break;
        }
      } catch (e) {
        // probar siguiente idioma
      }
    }

    await browser.close();

    if (!description) description = `${mlfb} — ver ficha en Industry Mall.`;
    return res.status(200).json({ ok:true, source, description });
  } catch (e) {
    return res.status(500).json({ ok:false, msg:e?.message || 'Error interno', description:'' });
  }
}
