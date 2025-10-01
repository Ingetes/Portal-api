import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

// Recomendado por @sparticuz para entornos serverless
chromium.setHeadlessMode = true;
chromium.setGraphicsMode = false;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

export default async function handler(req, res) {
  try {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();

    const { mlfb } = req.query;
    if (!mlfb) return res.status(400).json({ ok: false, msg: "Falta mlfb", description: "" });

    // Muy importante: usar el binario de @sparticuz/chromium
    const executablePath = await chromium.executablePath();

    const browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        // flags extra que evitan dependencias gráficas
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process"
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath,          // <- aquí va el binario empaquetado
      headless: chromium.headless,
      ignoreHTTPSErrors: true
    });

    const page = await browser.newPage();
    await page.setUserAgent(UA);

    // Probaremos en 3 idiomas porque a veces el contenido varía
    const langs = ["en", "es", "de"];
    let description = "";
    let source = "";

    for (const lang of langs) {
      const url = `https://mall.industry.siemens.com/mall/${lang}/ww/Catalog/Product/?mlfb=${encodeURIComponent(
        mlfb
      )}`;
      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 35000 });

        // aceptar cookies si aparece
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll("button, a")).find((el) =>
            /accept all|accept|agree|aceptar|zustimmen/i.test(el.textContent || "")
          );
          if (btn) btn.click();
        });
        await page.waitForTimeout(800);

        // leer meta / bloques visibles
        const cand = await page.evaluate(() => {
          const clean = (s) => (s || "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
          const meta =
            document.querySelector("meta[property='og:description']")?.content ||
            document.querySelector("meta[name='description']")?.content ||
            "";

          // JSON Next.js si existe
          let jsonDesc = "";
          try {
            const nd = document.getElementById("__NEXT_DATA__")?.textContent;
            if (nd) {
              const data = JSON.parse(nd);
              const keys = [
                "shortText",
                "shorttext",
                "short_description",
                "shortDescription",
                "longText",
                "longDescription",
                "marketingText",
                "description"
              ];
              const stack = [data];
              while (stack.length) {
                const cur = stack.pop();
                if (cur && typeof cur === "object") {
                  for (const k of keys) {
                    if (typeof cur[k] === "string" && cur[k].trim()) {
                      jsonDesc = cur[k];
                      break;
                    }
                  }
                  if (jsonDesc) break;
                  for (const v of Object.values(cur)) if (v && typeof v === "object") stack.push(v);
                }
              }
            }
          } catch {}

          const blocks = [
            ".product-description",
            ".productDetails__text",
            "#productDescription",
            ".product-overview",
            ".product__description",
            "article",
            "main"
          ]
            .flatMap((sel) => Array.from(document.querySelectorAll(sel)).map((n) => clean(n.textContent)))
            .filter((t) => t && t.length > 30)
            .sort((a, b) => b.length - a.length);

          const h1 = clean(document.querySelector("h1")?.textContent);

          let text = clean(jsonDesc) || clean(meta) || (blocks[0] || "");
          if (!text || text.length < 25) text = [h1, text].filter(Boolean).join(". ");

          return text;
        });

        if (cand && cand.length > 25) {
          description = cand.length > 900 ? cand.slice(0, 900) + "…" : cand;
          source = url;
          break;
        }
      } catch (e) {
        // intenta con el siguiente idioma
      }
    }

    await browser.close();

    if (!description) description = `${mlfb} — ver ficha en Industry Mall.`;
    res.status(200).json({ ok: true, source, description });
  } catch (e) {
    // Si vuelve a fallar, veremos el mensaje completo
    res.status(500).json({ ok: false, msg: e?.message || "Error interno", description: "" });
  }
}
