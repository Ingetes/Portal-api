// /api/upload.js  (Vercel Serverless Function)
// Recibe: { adminKey, fileBase64, path, message }
// Sube/actualiza un archivo en un repo de GitHub (API Contents).

export default async function handler(req, res) {
  // --- CORS (permite llamadas desde tu GitHub Pages) ---
  const ORIGIN = process.env.ALLOW_ORIGIN || "*"; // mejor: https://ingetes.github.io
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok:false, msg:"Method not allowed" });
    }

    const { adminKey, fileBase64, path, message } = req.body || {};
    if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ ok:false, msg:"Unauthorized" });
    }
    if (!fileBase64 || !path) {
      return res.status(400).json({ ok:false, msg:"Faltan datos (fileBase64, path)" });
    }

    const owner  = process.env.GH_OWNER;     // ej: "Ingetes"
    const repo   = process.env.GH_REPO;      // ej: "Prueba-portal-cotizaciones"
    const branch = process.env.GH_BRANCH || "main";
    const token  = process.env.GH_TOKEN;     // PAT con contents:write

    if (!owner || !repo || !token) {
      return res.status(500).json({ ok:false, msg:"Faltan variables GH_*" });
    }

    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;

    // 1) Obtener SHA si existe
    let sha;
    const head = await fetch(`${apiBase}?ref=${branch}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ingetes-portal"
      }
    });
    if (head.ok) {
      const j = await head.json();
      sha = j.sha;
    }

    // 2) PUT = crear/actualizar archivo
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
        content: fileBase64, // base64 sin "data:application/pdf;base64,"
        sha,                 // incluir solo si existe
        branch
      })
    });

    if (!put.ok) {
      const err = await put.text();
      return res.status(400).json({ ok:false, msg: err });
    }

    const out = await put.json();
    return res.status(200).json({ ok:true, url: out.content?.html_url || null });
  } catch (e) {
    return res.status(500).json({ ok:false, msg: e.message || "Server error" });
  }
}
