// /api/redenciones.js — guarda/lee Redenciones.json en GitHub (soporta ?repo=ingepuntos)
export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  // Repo 1 (por defecto, tu portal previo)
  const CFG1 = {
    owner:  process.env.GH_OWNER,
    repo:   process.env.GH_REPO,
    branch: process.env.GH_BRANCH || "main",
    path:   process.env.REDEMPTIONS_JSON_PATH || "Redenciones.json",
    token:  process.env.GH_TOKEN
  };
  // Repo 2 (INGEPUNTOS)
  const CFG2 = {
    owner:  process.env.GH_OWNER2,
    repo:   process.env.GH_REPO2,
    branch: process.env.GH_BRANCH2 || "main",
    path:   process.env.REDEMPTIONS_JSON_PATH2 || "Redenciones.json",
    token:  process.env.GH_TOKEN2 || process.env.GH_TOKEN
  };

  const repoKey = (req.query?.repo || req.headers["x-repo"] || "").toString().toLowerCase();
  const CFG = (repoKey === "ingepuntos") ? CFG2 : CFG1;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key, X-Repo");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!CFG.owner || !CFG.repo || !CFG.token) {
    return res.status(500).json({ ok:false, error:"Faltan variables GH_*" });
  }

  const fileUrl = `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${encodeURIComponent(CFG.path)}`;
  const gh = (url, init={}) => fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${CFG.token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "ingepuntos-api",
      ...(init.headers||{})
    }
  });

  async function readFile() {
    const r = await gh(`${fileUrl}?ref=${encodeURIComponent(CFG.branch)}`);
    if (r.status === 404) return { list: [], sha: undefined };
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    const txt = Buffer.from(j.content||"", "base64").toString("utf8");
    let data; try { data = JSON.parse(txt); } catch { data = { redenciones: [] }; }
    const list = Array.isArray(data?.redenciones) ? data.redenciones : [];
    return { list, sha: j.sha };
  }

  async function writeFile(list, sha, message) {
    const body = JSON.stringify({ redenciones: list }, null, 2);
    const b64  = Buffer.from(body, "utf8").toString("base64");
    const r = await gh(fileUrl, {
      method: "PUT",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ message: message || "update Redenciones.json", content: b64, sha, branch: CFG.branch })
    });
    if (!r.ok) throw new Error(await r.text());
  }

  try {
    if (req.method === "GET") {
      const { list } = await readFile();
      return res.status(200).json({ redenciones: list, repo: CFG.repo });
    }

    if (req.method === "POST") {
      // POST = agregar UNA redención (append)
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const item = body && typeof body === "object" ? {
        cliente: String(body.cliente||"").trim(),
        puntos:  Number(body.puntos||0),
        premio:  String(body.premio||"").trim(),
        fecha:   body.fecha || new Date().toISOString()
      } : null;
      if (!item || !item.cliente || !item.puntos) {
        return res.status(400).json({ ok:false, error:"Se espera {cliente,puntos,premio?,fecha?}" });
      }
      const { list, sha } = await readFile();
      list.push(item);
      await writeFile(list, sha, `append redención ${item.cliente} (${item.puntos})`);
      return res.status(200).json({ ok:true, count:list.length, repo: CFG.repo });
    }

    if (req.method === "PUT") {
      // PUT = reemplaza todo el arreglo (bulk save opcional)
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const arr = Array.isArray(body?.redenciones) ? body.redenciones : null;
      if (!arr) return res.status(400).json({ ok:false, error:"Payload inválido: {redenciones:[...]}" });
      const { sha } = await readFile();
      await writeFile(arr, sha, "replace Redenciones.json");
      return res.status(200).json({ ok:true, count: arr.length, repo: CFG.repo });
    }

    return res.status(405).json({ ok:false, error:"Método no permitido" });
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
}
