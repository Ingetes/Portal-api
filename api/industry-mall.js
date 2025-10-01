import * as cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    const { mlfb = "" } = req.query;
    if (!mlfb) return res.status(400).json({ error: "Falta mlfb" });

    const url = `https://mall.industry.siemens.com/mall/en/ww/Catalog/Product/?mlfb=${encodeURIComponent(mlfb)}`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
      },
    });
    if (!resp.ok) return res.status(resp.status).json({ error: "No se pudo abrir Industry Mall" });

    const html = await resp.text();
    const $ = cheerio.load(html);

    // 1) Intentar meta description
    let desc = $('meta[name="description"]').attr('content') || "";

    // 2) Fallback heurístico
    if (!desc) {
      const title = $("h1").first().text().trim();
      const body = $("#content, .product-details, .pdp-details, .mainContent").first().text().trim();
      desc = [title, body].join(" ").replace(/\s+/g, " ").trim();
    }

    if (desc.length > 1200) desc = desc.slice(0, 1200) + "…";
    res.status(200).json({ description: desc, source: url });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
