import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();

    const { mlfb } = req.query;
    if (!mlfb) return res.status(400).json({ ok: false, msg: "Falta mlfb", description: "" });

    // Obtener path de chromium en Vercel (¡clave!)
    const execPath = await chromium.executablePath();

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: execPath,
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.goto(
      `https://mall.industry.siemens.com/mall/en/ww/Catalog/Product/?mlfb=${encodeURIComponent(
        mlfb
      )}`,
      { waitUntil: "networkidle2", timeout: 30000 }
    );

    // Extraer algo de descripción
    const description = await page.evaluate(() => {
      const meta =
        document.querySelector("meta[property='og:description']")?.content ||
        document.querySelector("meta[name='description']")?.content ||
        "";
      const h1 = document.querySelector("h1")?.innerText || "";
      const cand =
        document.querySelector(".product-description")?.innerText ||
        document.querySelector(".productDetails__text")?.innerText ||
        "";
      return (meta || cand || h1).replace(/\s+/g, " ").trim();
    });

    await browser.close();

    res.status(200).json({
      ok: true,
      description: description || `${mlfb} — ver ficha en Industry Mall.`,
      source: `https://mall.industry.siemens.com/mall/en/ww/Catalog/Product/?mlfb=${mlfb}`
    });
  } catch (e) {
    res.status(500).json({ ok: false, msg: e.message, description: "" });
  }
}

