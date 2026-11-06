import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, forbidden, fail } from './util.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

/** 아주 작은 라우터: '/api/move-requests/:id/hold' 형태 */
export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handler });
  }
  get(p, h) { this.add('GET', p, h); }
  post(p, h) { this.add('POST', p, h); }
  patch(p, h) { this.add('PATCH', p, h); }
  match(method, path) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = path.match(r.re);
      if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw fail('TOO_LARGE', '요청이 너무 커요');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw fail('BAD_JSON', 'JSON 형식이 아니에요');
  }
}

function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

/**
 * SSE 스트림. filter(ev) 가 true 인 이벤트만 보낸다.
 */
export function openStream(req, res, bus, filter, onClose = () => {}) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  const write = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  write('hello', { at: Date.now() });
  const off = bus.subscribe((ev) => { if (filter(ev)) write(ev.type, ev.payload); });
  const ka = setInterval(() => res.write(': ka\n\n'), 15_000);
  req.on('close', () => { off(); clearInterval(ka); onClose(); });
}

export function startHttp(router, port, log = console.log) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
        'access-control-allow-headers': 'content-type,x-user-id,x-vehicle-key',
      });
      return res.end();
    }
    if (url.pathname.startsWith('/api/')) {
      const m = router.match(req.method, url.pathname);
      if (!m) return send(res, 404, { error: 'NOT_FOUND', message: '없는 API예요' });
      try {
        const body = ['POST', 'PATCH'].includes(req.method) ? await readBody(req) : {};
        const out = await m.handler({ req, res, params: m.params, query: Object.fromEntries(url.searchParams), body, headers: req.headers });
        if (out === undefined) return; // 스트림 등 직접 응답
        return send(res, 200, out);
      } catch (e) {
        if (e instanceof AppError) return send(res, e.status, { error: e.code, message: e.message, ...e.extra });
        log('[error]', e);
        return send(res, 500, { error: 'INTERNAL', message: '서버 오류가 났어요' });
      }
    }
    return serveStatic(url.pathname, res);
  });
  server.listen(port, '0.0.0.0');
  return server;
}

async function serveStatic(pathname, res) {
  let p = pathname === '/' ? '/index.html' : pathname;
  p = normalize(p).replace(/^([/\\])+/, '');
  if (p.includes('..')) { res.writeHead(400); return res.end(); }
  try {
    const data = await readFile(join(PUBLIC_DIR, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}

export const requireUser = (ctx, headers, query = {}) => {
  const uid = headers['x-user-id'] || query.userId;
  if (!uid) throw forbidden('LOGIN', '로그인이 필요해요');
  return ctx.user(uid);
};

export const requireVehicle = (ctx, params, headers, query = {}) => {
  const v = ctx.vehicle(params.id);
  const key = headers['x-vehicle-key'] || query.key;
  if (!v.appKey || key !== v.appKey) throw forbidden('VEHICLE_KEY', '차량 인증 키가 맞지 않아요');
  return v;
};
