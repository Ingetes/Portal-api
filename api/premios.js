export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  // ----- CONFIG por defecto (repo1) -----
  const CFG1 = {
    owner:  process.env.GH_OWNER,
    repo:   process.env.GH_REPO,
    branch: process.env.GH_BRANCH || "main",
    path:   process.env.AWARDS_JSON_PATH || "Premios.json",
  };
  // ----- CONFIG repo2 (INGEPUNTOS) -----
  const CFG2 = {
    owner:  process.env.GH_OWNER2,
    repo:   process.env.GH_REPO2,
    branch: process.env.GH_BRANCH2 || "main",
    path:   process.env.AWARDS_JSON_PATH2 || "Premios.json",
  };

  // Elegir config por query/header: ?repo=ingepuntos | ?repo=portal
  const repoKey = (req.query?.repo || req.headers["x-repo"] || "").toString().toLowerCase();
  const CFG = repoKey === "ingepuntos" ? CFG2 : CFG1; // default: repo1 (portal)

const GH_TOKEN = (repoKey === 'ingepuntos')
  ? (process.env.GH_TOKEN2 || process.env.GH_TOKEN)
  : process.env.GH_TOKEN;

  const ADMIN_KEY = process.env.ADMIN_KEY_AWARDS || process.env.ADMIN_KEY || "";

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key, X-Repo");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "PUT" && ADMIN_KEY) {
    const key = req.headers["x-admin-key"];
    if (key !== ADMIN_KEY) return res.status(401).json({ error: "Unauthorized" });
  }

  if (!GH_TOKEN || !CFG.owner || !CFG.repo) {
    return res.status(500).json({ error: "Faltan credenciales o config de repo" });
  }

  const fileUrl = `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${encodeURIComponent(CFG.path)}`;
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

  if (req.method === "GET") {
    const r = await gh(`${fileUrl}?ref=${encodeURIComponent(CFG.branch)}`);
    if (r.status === 404) return res.status(200).json({ premios: [], repo: CFG.repo });
    if (!r.ok) return res.status(r.status).json({ error: await r.text(), repo: CFG.repo });

    const data = await r.json();
    const content = Buffer.from(data.content || "", "base64").toString("utf8");
    let json; try { json = JSON.parse(content); } catch { json = { premios: [] }; }
    return res.status(200).json({ premios: Array.isArray(json?.premios) ? json.premios : [], repo: CFG.repo });
  }

  if (req.method === "PUT") {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const premios = Array.isArray(body?.premios) ? body.premios : null;
    if (!premios) return res.status(400).json({ error: "Payload inválido: {premios:[...]}" });

    // Leer sha actual
    let sha;
    const cur = await gh(`${fileUrl}?ref=${encodeURIComponent(CFG.branch)}`);
    if (cur.ok) sha = (await cur.json()).sha;
    else if (cur.status !== 404) return res.status(cur.status).json({ error: await cur.text() });

    // Orden simple por umbral si existe
    const text = JSON.stringify(
      { premios: premios.sort((a,b)=> (a.umbral||0)-(b.umbral||0)) },
      null, 2
    );
    const b64 = Buffer.from(text, "utf8").toString("base64");

    const put = await gh(fileUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `chore: actualizar ${CFG.path} (${repoKey||'repo1'})`,
        content: b64,
        sha,
        branch: CFG.branch,
      }),
    });
    if (!put.ok) return res.status(put.status).json({ error: await put.text(), repo: CFG.repo });

    return res.status(200).json({ ok: true, count: premios.length, repo: CFG.repo });
  }

  return res.status(405).json({ error: "Método no permitido" });
}

