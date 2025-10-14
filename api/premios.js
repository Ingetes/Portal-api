export const config = { runtime: 'nodejs20.x' };

import { put, list } from '@vercel/blob';

const PATH = 'ingepuntos/Premios.json';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
};
const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS };

function bad(msg, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }), { status, headers: JSON_HEADERS });
}

async function loadUrlForPath() {
  const { blobs } = await list({ prefix: PATH, limit: 1 });
  return blobs.length ? blobs[0].url : null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  if (req.method === 'GET') {
    const url = await loadUrlForPath();
    if (!url) return new Response(JSON.stringify({ premios: [] }), { headers: JSON_HEADERS });

    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return bad(`No pude leer Premios.json (${r.status})`, 502);
    const data = await r.json().catch(() => null);
    if (!data) return bad('Premios.json corrupto', 500);
    return new Response(JSON.stringify(data), { headers: JSON_HEADERS });
  }

  if (req.method === 'PUT') {
    const adminKey = req.headers.get('x-admin-key') || '';
    if (adminKey !== (process.env.ADMIN_KEY_AWARDS || '')) return bad('No autorizado', 401);

    let body = null;
    try { body = await req.json(); } catch { return bad('Body JSON inválido'); }

    const premios = Array.isArray(body) ? body
      : Array.isArray(body?.premios) ? body.premios
      : null;
    if (!premios) return bad('Se espera { premios: [...] }');

    const cleaned = premios.map(x => ({
      umbral: Number(String(
        x.umbral ?? x.Ingepuntos ?? x.ingepuntos ?? x.puntos ?? x['Puntos requeridos'] ?? x['Costo'] ?? x['Costo (puntos)']
      ).replace(/[^0-9-]/g,'')) || 0,
      desc: String(
        x.desc ?? x.descripcion ?? x['Descripción'] ?? x['Descripción del premio'] ?? x.premio ?? x.Premio ?? ''
      ).trim()
    })).filter(p => p.umbral > 0 && p.desc);

    const json = JSON.stringify({ premios: cleaned }, null, 2);
    await put(PATH, json, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json; charset=utf-8',
    });

    return new Response(JSON.stringify({ ok: true, count: cleaned.length }), { headers: JSON_HEADERS });
  }

  return bad('Método no permitido', 405);
}
