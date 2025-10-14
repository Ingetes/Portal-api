// /api/premios.js (Vercel – Serverless Node)
// Variables requeridas: GH_TOKEN, GH_OWNER, GH_REPO
// Opcionales: ADMIN_KEY_AWARDS, AWARDS_JSON_PATH (default: "Premios.json")

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  const GH_TOKEN  = process.env.GH_TOKEN;             // PAT con scope "repo"
  const GH_OWNER  = process.env.GH_OWNER;             // p.ej. "ingetes"
  const GH_REPO   = process.env.GH_REPO;              // p.ej. "Portal-de-cotizaciones"
  const ADMIN_KEY = process.env.ADMIN_KEY_AWARDS || "";
  const FILE_PATH = process.env.AWARDS_JSON_PATH || "Premios.json";

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key");
  if (req.method === "OPTIONS") return res.status(204).end();

  // Protección simple en PUT
  if (req.method === "PUT" && ADMIN_KEY) {
    const key = req.headers["x-admin-key"];
    if (key !== ADMIN_KEY) return res.status(401).json({ error: "Unauthorized" });
  }

  if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
    return res.status(500).json({ error: "Faltan GH_TOKEN/GH_OWNER/GH_REPO" });
  }

  const FILE_URL = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(FILE_PATH)}`;
  const gh = (url, init = {}) =>
    fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ingepuntos-api",
        ...(init.headers || {}),
      },
    });

  // Normalizador para aceptar varias formas de columnas (igual que en el front)
  const normalizeAwards = (arr) =>
    (Array.isArray(arr) ? arr : []).map((x) => {
      const um =
        x.umbral ?? x.Ingepuntos ?? x.ingepuntos ?? x.puntos ??
        x["Puntos requeridos"] ?? x["Costo"] ?? x["Costo (puntos)"] ?? 0;
      const ds =
        x.desc ?? x.descripcion ?? x["Descripción"] ??
        x["Descripción del premio"] ?? x.premio ?? x.Premio ?? "";
      return {
        umbral: Number(String(um).replace(/[^0-9-]/g, "")) || 0,
        desc: String(ds).trim(),
      };
    }).filter((p) => p.umbral > 0 && p.desc);

  try {
    if (req.method === "GET") {
      const r = await gh(FILE_URL);
      if (r.status === 404) return res.status(200).json({ premios: [] });
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });

      const data = await r.json();
      const content = Buffer.from(data.content || "", "base64").toString("utf8");
      let json;
      try { json = JSON.parse(content); } catch { json = { premios: [] }; }
      return res.status(200).json({ premios: Array.isArray(json?.premios) ? json.premios : normalizeAwards(json) });
    }

    if (req.method === "PUT") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const lista = Array.isArray(body?.premios) ? body.premios : null;
      if (!lista) return res.status(400).json({ error: "Payload inválido: {premios: [...]}" });

      // Obtener sha actual (si existe)
      let sha;
      const cur = await gh(FILE_URL);
      if (cur.ok) sha = (await cur.json()).sha;
      else if (cur.status !== 404) return res.status(cur.status).json({ error: await cur.text() });

      // Preparar contenido (normalizado y ordenado)
      const cleaned = normalizeAwards(lista).sort((a, b) => a.umbral - b.umbral);
      const text = JSON.stringify({ premios: cleaned }, null, 2);
      const b64  = Buffer.from(text, "utf8").toString("base64");

      const put = await gh(FILE_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "chore: actualizar Premios.json desde el portal",
          content: b64,
          sha,
        }),
      });

      if (!put.ok) return res.status(put.status).json({ error: await put.text() });
      return res.status(200).json({ ok: true, count: cleaned.length });
    }

    return res.status(405).json({ error: "Método no permitido" });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

