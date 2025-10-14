// /api/upload.js  (Vercel Serverless Function) — multi-repo
export default async function handler(req, res) {
  const ORIGIN = process.env.ALLOW_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Repo"); // <-- permite X-Repo
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok:false, msg:"Method not allowed" });
    }

    const { adminKey, fileBase64, path, message, repo: repoFromBody } = req.body || {};
    if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ ok:false, msg:"Unauthorized" });
    }
    if (!fileBase64 || !path) {
      return res.status(400).json({ ok:false, msg:"Faltan datos (fileBase64, path)" });
    }

    // ---- Selección de repo ----
    // Prioridad: query ?repo=... -> header X-Repo -> body.repo -> default (repo1)
    const repoKey =
      (req.query && String(req.query.repo || "").toLowerCase()) ||
      String(req.headers["x-repo"] || "").toLowerCase() ||
      String(repoFromBody || "").toLowerCase();

    const isRepo2 = repoKey === "ingepuntos"; // alias para tu segundo repo

    // Repo 1 (actual - Portal-de-cotizaciones)
    const owner1  = process.env.GH_OWNER;
    const repo1   = process.env.GH_REPO;
    const branch1 = process.env.GH_BRANCH || "main";
    const token1  = process.env.GH_TOKEN;

    // Repo 2 (nuevo - IN GEPUNTOS)
    const owner2  = process.env.GH_OWNER2;
    const repo2   = process.env.GH_REPO2;
    const branch2 = process.env.GH_BRANCH2 || "main";
    const token2  = process.env.GH_TOKEN2 || token1; // fallback si no pones GH_TOKEN2

    const owner  = isRepo2 ? owner2  : owner1;
    const repo   = isRepo2 ? repo2   : repo1;
    const branch = isRepo2 ? branch2 : branch1;
    const token  = isRepo2 ? token2  : token1;

    if (!owner || !repo || !token) {
      return res.status(500).json({ ok:false, msg:"Faltan variables GH_* para el repo seleccionado" });
    }

    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;

    // Obtener SHA si el archivo ya existe (en branch)
    let sha;
    const head = await fetch(`${apiBase}?ref=${branch}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ingetes-portal"
      }
    });
    if (head.ok) { const j = await head.json(); sha = j.sha; }
    else if (head.status !== 404) {
      const err = await head.text();
      return res.status(400).json({ ok:false, msg: err });
    }

    // PUT: crear/actualizar
    const put = await fetch(apiBase, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "ingetes-portal"
      },
      body: JSON.stringify({
        message: message || `update ${path}`,
        content: fileBase64, // base64 sin encabezado
        sha,                 // solo si existe
        branch
      })
    });

    if (!put.ok) {
      const err = await put.text();
      return res.status(400).json({ ok:false, msg: err });
    }

    const out = await put.json();
    return res.status(200).json({
      ok:true,
      url: out.content?.html_url || null,
      repo: `${owner}/${repo}#${branch}`
    });
  } catch (e) {
    return res.status(500).json({ ok:false, msg: e.message || "Server error" });
  }
}
