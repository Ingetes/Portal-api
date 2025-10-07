// /api/ingenieros.js  (Vercel)
// Usa tus variables: GH_TOKEN, GH_OWNER, GH_REPO, ADMIN_KEY, ING_JSON_PATH (opcional)
export default async function handler(req, res) {
  const GH_TOKEN = process.env.GH_TOKEN;        // PAT con scope "repo"
  const GH_OWNER = process.env.GH_OWNER;        // "Ingetes" (según tu captura)
  const GH_REPO  = process.env.GH_REPO;         // "Portal-de-cotizaciones"
  const ADMIN_KEY= process.env.ADMIN_KEY || ""; // "admin" en tu captura
  const FILE_PATH= process.env.ING_JSON_PATH || "Ingenieros.json";

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key");
  if (req.method === "OPTIONS") return res.status(204).end();

  // Protección opcional por admin key en PUT
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
        "User-Agent": "ingetes-portal",
        ...(init.headers || {}),
      },
    });

  try {
    if (req.method === "GET") {
      const r = await gh(FILE_URL);
      if (r.status === 404) return res.status(200).json({ ingenieros: [] });
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      const data = await r.json();
      const content = Buffer.from(data.content || "", "base64").toString("utf8");
      let json;
      try { json = JSON.parse(content); } catch { json = { ingenieros: [] }; }
      return res.status(200).json({ ingenieros: json.ingenieros || [] });
    }

    if (req.method === "PUT") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const lista = Array.isArray(body?.ingenieros) ? body.ingenieros : null;
      if (!lista) return res.status(400).json({ error: "Payload inválido: {ingenieros: string[]}" });

      // Obtener sha actual (si existe)
      let sha;
      const cur = await gh(FILE_URL);
      if (cur.ok) sha = (await cur.json()).sha;
      else if (cur.status !== 404) return res.status(cur.status).json({ error: await cur.text() });

      // Preparar contenido
      const text = JSON.stringify({ ingenieros: lista }, null, 2);
      const b64  = Buffer.from(text, "utf8").toString("base64");

      const put = await gh(FILE_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "chore: actualizar lista de ingenieros desde el portal",
          content: b64,
          sha,
        }),
      });

      if (!put.ok) return res.status(put.status).json({ error: await put.text() });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Método no permitido" });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
