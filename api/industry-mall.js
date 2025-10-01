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
          !/^\*+$/.test(s)*

