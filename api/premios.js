export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  const GH_TOKEN  = process.env.GH_TOKEN;
  const GH_OWNER  = process.env.GH_OWNER;
  const GH_REPO   = process.env.GH_REPO;
  const GH_BRANCH = process.env.GH_BRANCH || "main";                // <-- NUEVO
  const ADMIN_KEY = process.env.ADMIN_KEY_AWARDS || process.env.ADMIN_KEY || ""; // <-- acepta ambas
  const FILE_PATH = process.env.AWARDS_JSON_PATH || "Premios.json";

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "PUT" && ADMIN_KEY) {
    const key = req.headers["x-admin-key"];
    if (key !== ADMIN_KEY) return res.status(401).json({ error: "Unauthorized" });
  }

  if (!GH_TOKEN || !GH_OWNER || !GH_REPO)
    return res.status(500).json({ error: "Faltan GH_TOKEN/GH_OWNER/GH_REPO" });

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

  // --- GET: lee del branch indicado ---
  if (req.method === "GET") {
    const r = await gh(`${FILE_URL}?ref=${encodeURIComponent(GH_BRANCH)}`);
    if (r.status === 404) return res.status(200).json({ premios: [] });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });

    const data = await r.json();
    const content = Buffer.from(data.content || "", "base64").toString("utf8");
    let json; try { json = JSON.parse(content); } catch { json = { premios: [] }; }
    const premios = Array.isArray(json?.premios) ? json.premios : [];
    return res.status(200).json({ premios });
  }

  // --- PUT: escribe al branch indicado ---
  if (req.method === "PUT") {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const premios = Array.isArray(body?.premios) ? body.premios : null;
    if (!premios) return res.status(400).json({ error: "Payload inválido: {premios:[...]}" });

    // obtener sha actual
    let sha;
    const cur = await gh(`${FILE_URL}?ref=${encodeURIComponent(GH_BRANCH)}`);
    if (cur.ok) sha = (await cur.json()).sha;
    else if (cur.status !== 404) return res.status(cur.status).json({ error: await cur.text() });

    const text = JSON.stringify({ premios: premios.sort((a,b)=> (a.umbral||0)-(b.umbral||0)) }, null, 2);
    const b64  = Buffer.from(text, "utf8").toString("base64");

    const put = await gh(FILE_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "chore: actualizar Premios.json desde el portal",
        content: b64,
        sha,
        branch: GH_BRANCH,                                  // <-- escribe en branch correcto
      }),
    });
    if (!put.ok) return res.status(put.status).json({ error: await put.text() });
    return res.status(200).json({ ok: true, count: premios.length });
  }

  return res.status(405).json({ error: "Método no permitido" });
}
