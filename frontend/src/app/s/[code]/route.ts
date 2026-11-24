/**
 * Short links for files shared with clients: https://<crm>/s/<code>
 * The client only ever sees this address. It asks the CRM backend for the file and passes it straight through,
 * so the storage provider and its folder layout never appear in the link or the address bar.
 */
const API = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export const dynamic = "force-dynamic";

function page(title: string, message: string, status: number) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;font-family:system-ui,sans-serif;color:#0f172a}
.card{max-width:22rem;margin:1rem;padding:2rem;border-radius:1.5rem;background:#fff;box-shadow:0 10px 30px rgba(15,23,42,.08);text-align:center}
h1{font-size:1.1rem;margin:0 0 .5rem}p{margin:0;color:#64748b;font-size:.95rem;line-height:1.5}</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[A-Za-z0-9]{4,32}$/.test(code)) return page("Link not valid", "Please check the link, or ask us to send it again.", 404);
  let res: Response;
  try {
    res = await fetch(`${API}/api/v1/s/${code}`, { cache: "no-store" });
  } catch {
    return page("Please try again", "We could not open this file right now.", 502);
  }
  if (res.status === 410) return page("This link has expired", "Ask us for a new one and we will send it right away.", 410);
  if (!res.ok) return page("Link not valid", "This file is not available. Ask us to send it again.", res.status === 404 ? 404 : 502);
  const headers = new Headers();
  for (const h of ["content-type", "content-disposition", "content-length", "cache-control"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("x-robots-tag", "noindex");
  return new Response(res.body, { status: 200, headers });
}
