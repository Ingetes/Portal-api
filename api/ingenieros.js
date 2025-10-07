// /api/ingenieros.js
export default async function handler(req, res) {
  // === CONFIG ===
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;         // PAT con permiso "repo"
  const OWNER        = process.env.GITHUB_OWNER;         // ej: "ingetes"
  const REPO         = process.env.GITHUB_REPO;          // ej: "portal-cotizaciones"
  const FILE_PATH    = process.env.ING_JSON_PATH || "Ingenieros.json"; // ruta en el repo (raíz o carpeta)

  if (!GITHUB_TOKEN || !OWNER || !REPO || !FILE_PATH) {
    return res.status(500).json({ error: "Faltan variables de entorno." });
  }

  // GitHub Contents API endpoints
  const FILE_URL = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(FILE_PATH)}`;

  // Util: fetch a GitHub with auth
  const gh = (url, init={}) => fetch(url, {
    ...init,
    headers: {
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "ingetes-portal",
      ...(init.headers || {})
    }
  });

  // CORS básico
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      // Lee archivo desde GitHub
      const r = await gh(FILE_URL);
      if (r.status === 404) {
        // si no existe, devolver lista base
        return res.status(200).json({ ingenieros: [] });
      }
      if (!r.ok) {
        const t = await r.text();
        return res.status(r.status).json({ error: t });
      }
      const json = await r.json();
      const content = Buffer.from(json.content || "", "base64").toString("utf8");
      let data;
      try { data = JSON.parse(content); } catch { data = { ingenieros: [] }; }
      return res.status(200).json({ ingenieros: data.ingenieros || [] });
    }

    if (req.method === "PUT") {
      // Recibe { ingenieros: [...] }
      const body = req.body && (typeof req.body === "string" ? JSON.parse(req.body) : req.body);
      const arr = Array.isArray(body?.ingenieros) ? body.ingenieros : null;
      if (!arr) return res.status(400).json({ error: "Payload inválido: {ingenieros: string[]}" });

      // 1) Obtener sha actual (si existe)
      let sha = undefined;
      const cur = await gh(FILE_URL);
      if (cur.ok) {
        const cjson = await cur.json();
        sha = cjson.sha;
      } else if (cur.status !== 404) {
        const t = await cur.text();
        return res.status(cur.status).json({ error: t });
      }

      // 2) Preparar contenido nuevo
      const contentStr = JSON.stringify({ ingenieros: arr }, null, 2);
      const b64 = Buffer.from(contentStr, "utf8").toString("base64");

      // 3) PUT (create/update) a GitHub
      const put = await gh(FILE_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "chore: actualizar lista de ingenieros desde el portal",
          content: b64,
          sha
        })
      });

      if (!put.ok) {
        const t = await put.text();
        return res.status(put.status).json({ error: t });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Método no permitido" });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
