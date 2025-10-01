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

    const langs = ['en','es','de'];
    let best = { description:'', source:'' };

    for (const lang of langs) {
      const mallUrl = `https://mall.industry.siemens.com/mall/${lang}/ww/Catalog/Product/?mlfb=${encodeURIComponent(mlfb)}`;
      const mallText = await fetchTextViaJina(mallUrl);

      if (!mallText) continue;

      // ¿El Mall nos está diciendo que la info real está en SiePortal?
      const sieUrl = sniffSiePortalUrl(mallText);
      if (sieUrl) {
        const sieText = await fetchTextViaJina(sieUrl);
        const desc = extractOverviewParagraph(sieText, mlfb, true);
        if (score(desc) > score(best.description)) best = { description: desc, source: mallUrl };
        if (score(best.description) >= 70) break;
      } else {
        const desc = extractOverviewParagraph(mallText, mlfb, false);
        if (score(desc) > score(best.description)) best = { description: desc, source: mallUrl };
        if (score(best.description) >= 70) break;
      }
    }

    if (!best.description) best.description = `${mlfb} — ver ficha en Industry Mall.`;
    res.status(200).json({ ok:true, source: best.source, description: best.description });
  } catch (e) {
    res.status(500).json({ ok:false, msg:e?.message || 'Error interno', description:'' });
  }
}

/* ================= helpers ================= */

async function fetchTextViaJina(url){
  try{
    const proxy = `https://r.jina.ai/http://${url.replace(/^https?:\/\//,'')}`;
    const r = await fetch(proxy, { headers:{ Accept:'text/plain' }, cache:'no-store' });
    if(!r.ok) return '';
    return (await r.text() || '').replace(/\u00A0/g,' ').replace(/\r/g,'');
  }catch{ return ''; }
}

function sniffSiePortalUrl(txt){
  const m = txt.match(/https?:\/\/sieportal\.siemens\.com\/[^\s)]+/i);
  return m ? m[0] : '';
}

function extractOverviewParagraph(raw, mlfb, isSiePortal){
  if (!raw) return '';

  // 1) limpiar markdown y ruido
  let txt = raw
    // quita imágenes ![alt](url)
    .replace(/!\[[^\]]*\]\([^)]+\)/g,' ')
    // convierte links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g,'$1')
    // colapsa espacios
    .replace(/[ \t]+/g,' ');

  const lines = txt.split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    // fuera navegación / legal / buscador
    .filter(s => !/^(siemens|industry|mall|home)$/i.test(s))
    .filter(s => !/(cookies|consent|privacy|login|cart|search|terms)/i.test(s))
    // fuera “Title: … URL Source: … Published Time …”
    .filter(s => !/^Title:\s*/i.test(s) && !/^Source:\s*/i.test(s) && !/^Published Time:/i.test(s))
    // fuera "Image x: ..."
    .filter(s => !/^image\s*\d*:/i.test(s));

  // 2) buscar ancla: MLFB o "Overview/Vista general"
  const idx = indexOfFirst(lines, [
    s => s.toUpperCase() === String(mlfb).toUpperCase(),
    s => /^(overview|vista general)$/i.test(s)
  ]);

  // 3) formar párrafo técnico
  let para = pickParagraph(lines, Math.max(0, idx));

  // si salió flojo, intenta en todo el doc
  if (!isGood(para)) para = pickParagraph(lines, 0);

  // 4) cortes duros cuando cambian de pestaña/sección
  const hardStops = [
    /\b(Specifications|Especificaciones)\b/i,
    /\b(Documents?\s*&\s*downloads|Documentos?\s*&\s*descargas)\b/i,
    /\b(Support|Soporte)\b/i,
    /\b(Product lifecycle)\b/i,
    /\b(Download product data sheet|Print)\b/i,
  ];
  let desc = (para || '').replace(/\s+/g,' ').trim();
  for (const re of hardStops) {
    const m = desc.match(re);
    if (m) desc = desc.slice(0, m.index).trim();
  }

  // 5) petición del usuario: cortar exactamente en "keeper kit"
  const kk = desc.toLowerCase().indexOf('keeper kit');
  if (kk >= 0) desc = desc.slice(0, kk + 'keeper kit'.length).trim();

  // 6) límites
  if (desc.length > 900) desc = desc.slice(0,900) + '…';
  return desc;
}

function indexOfFirst(arr, testers){
  for (let i=0;i<arr.length;i++){
    for (const t of testers) if (t(arr[i])) return i;
  }
  return -1;
}

function pickParagraph(lines, fromIdx){
  const stopper = /(Specifications|Especificaciones|Documents?\s*&\s*downloads|Support|Soporte)/i;
  const looksTitle = s =>
    /^[A-Z0-9._-]{6,}$/.test(s) || /^(overview|vista general)$/i.test(s);

  let cur=[]; const blocks=[];
  for (let i=fromIdx;i<lines.length;i++){
    const s = lines[i];
    if (!s || looksTitle(s) || stopper.test(s)) {
      if (cur.length){ blocks.push(cur.join(' ')); cur=[]; }
      continue;
    }
    cur.push(s);
    const joined = cur.join(' ');
    if (isGood(joined) && /[.;:]$/.test(s)) { blocks.push(joined); cur=[]; }
    if (joined.length > 700) { blocks.push(joined); cur=[]; }
  }
  if (cur.length) blocks.push(cur.join(' '));

  const candidates = blocks.filter(isGood).sort((a,b)=>score(b)-score(a));
  return candidates[0] || '';
}

function isGood(s){
  if (!s) return false;
  if (s.length < 60) return false;
  const tech = /\b(AC|DC|V|A|kA|kW|mm|IP\d{2}|UL|IEC|breaker|contactor|module|módulo|input|output|I\/O|short-?circuit|overload|frame|3[- ]?pole|3P|ET\s?200|LOGO!|PLC|bus\s*bar|protection|diagnostics)\b/i;
  return tech.test(s) || s.length > 140;
}

function score(s){
  if (!s) return 0;
  const base = Math.min(s.length, 600)/10;
  const bonus = /\b(AC|DC|V|A|kA|kW|mm|IP\d{2}|UL|IEC|breaker|contactor|module|módulo|I\/O|diagnostics)\b/i.test(s) ? 40 : 0;
  return base + bonus;
}
