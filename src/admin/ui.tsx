import type { Child, FC } from "hono/jsx";
import type { PuzzleRow } from "../lib/types";

const CSS = `
:root {
  --bg: #f6f5f1; --surface: #ffffff; --ink: #1a1a1b; --muted: #6b6656; --line: #e2dfd4;
  --accent: #1d4ed8; --accent-ink: #ffffff; --ok-bg: #e7f6ec; --ok: #1f7a43;
  --err-bg: #fdecea; --err: #b3261e; --warn-bg: #fff6e0; --warn: #8a5a00;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--accent); }
header.top { background: var(--surface); border-bottom: 1px solid var(--line); }
header.top .inner { max-width: 1040px; margin: 0 auto; padding: 12px 16px; display: flex; gap: 16px; align-items: center; }
header.top .brand { font-weight: 700; text-decoration: none; color: var(--ink); }
header.top .user { margin-left: auto; color: var(--muted); font-size: 13px; }
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 18px; margin: 28px 0 8px; }
h3 { font-size: 15px; margin: 20px 0 6px; }
p.lead { color: var(--muted); margin: 0 0 20px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 18px; margin-bottom: 16px; }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin: 16px 0 20px; flex-wrap: wrap; }
.tabs a { padding: 8px 14px; text-decoration: none; color: var(--muted); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tabs a.active { color: var(--ink); border-color: var(--ink); font-weight: 600; }
.subtabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
.subtabs a { padding: 5px 12px; border-radius: 999px; border: 1px solid var(--line); text-decoration: none; color: var(--ink); background: var(--surface); font-size: 14px; }
.subtabs a.active { background: var(--ink); color: #fff; border-color: var(--ink); }
label { display: block; font-weight: 600; font-size: 14px; margin: 14px 0 4px; }
label .hint, .hint { font-weight: 400; color: var(--muted); font-size: 13px; }
input[type=text], input[type=url], input[type=number], input[type=date], select, textarea {
  width: 100%; padding: 8px 10px; border: 1px solid #cfcbbf; border-radius: 6px; font: inherit; background: #fff; }
textarea { min-height: 80px; resize: vertical; }
input[type=number] { max-width: 140px; }
.row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0 16px; }
.inline { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.check { display: inline-flex; gap: 6px; align-items: center; font-weight: 400; margin: 4px 14px 4px 0; }
button, .btn { display: inline-block; padding: 8px 14px; border-radius: 6px; border: 1px solid var(--ink);
  background: var(--ink); color: #fff; font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; }
button.secondary, .btn.secondary { background: #fff; color: var(--ink); border-color: #cfcbbf; }
button.small { padding: 3px 9px; font-size: 13px; font-weight: 500; }
button.danger { background: #fff; color: var(--err); border-color: #e7b4ae; }
.actions { margin-top: 18px; display: flex; gap: 8px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: middle; }
th { font-size: 13px; color: var(--muted); font-weight: 600; }
td.num { color: var(--muted); width: 40px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .06em; }
.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #eceae3; color: var(--muted); }
.badge.on { background: var(--ok-bg); color: var(--ok); }
.badge.warn { background: var(--warn-bg); color: var(--warn); }
.flash { padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; }
.flash.ok { background: var(--ok-bg); color: var(--ok); }
.flash.err { background: var(--err-bg); color: var(--err); }
.flash.warn { background: var(--warn-bg); color: var(--warn); }
.msg { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; background: #fff; display: flex; gap: 12px; }
.msg.inactive { opacity: .5; }
.msg .body { flex: 1; min-width: 0; }
.msg .meta { font-size: 13px; color: var(--muted); margin-top: 4px; word-break: break-all; }
.msg form { display: inline; }
details > summary { cursor: pointer; color: var(--accent); font-weight: 600; margin: 6px 0; }
.snippet { display: flex; gap: 8px; }
.snippet input { font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
.logo-preview { max-height: 64px; max-width: 220px; display: block; margin: 6px 0; background: #fff; border: 1px solid var(--line); border-radius: 6px; padding: 6px; }
.stats { display: flex; gap: 24px; flex-wrap: wrap; }
.stats div strong { display: block; font-size: 22px; }
.stats div span { color: var(--muted); font-size: 13px; }
.danger-zone { border-color: #e7b4ae; }
@media (max-width: 600px) { .msg { flex-direction: column; } }
`;

export const Layout: FC<{ title: string; adminEmail?: string; children?: Child }> = ({ title, adminEmail, children }) => (
  <html lang="de-CH">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex" />
      <title>{title} · Rätsel-Backend</title>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
    </head>
    <body>
      <header class="top">
        <div class="inner">
          <a class="brand" href="/admin">🧩 Rätsel-Backend</a>
          {adminEmail ? <span class="user">{adminEmail}</span> : null}
          {adminEmail === "Admin" ? (
            <form method="post" action="/admin/logout" style="margin: 0">
              <button class="small secondary" type="submit">Abmelden</button>
            </form>
          ) : null}
        </div>
      </header>
      <main>{children}</main>
    </body>
  </html>
);

export const Flash: FC<{ ok?: string; err?: string }> = ({ ok, err }) => (
  <>
    {ok ? <div class="flash ok">{ok}</div> : null}
    {err ? <div class="flash err">{err}</div> : null}
  </>
);

export type PuzzleTab = "general" | "access" | "texts" | "words" | "stats";

export const PuzzleHeader: FC<{ puzzle: PuzzleRow; tab: PuzzleTab }> = ({ puzzle, tab }) => {
  const tabs: [PuzzleTab, string][] = [
    ["general", "Allgemein"],
    ["access", "Zugang"],
    ["texts", "Texte & CTAs"],
    ["words", "Wörter"],
    ["stats", "Statistik"],
  ];
  return (
    <>
      <div class="inline">
        <h1>{puzzle.name}</h1>
        <span class={puzzle.active ? "badge on" : "badge"}>{puzzle.active ? "aktiv" : "inaktiv"}</span>
      </div>
      <p class="lead">
        <a href={`/${puzzle.slug}`} target="_blank" rel="noopener">/{puzzle.slug}</a>
      </p>
      <nav class="tabs">
        {tabs.map(([id, label]) => (
          <a href={`/admin/p/${puzzle.id}/${id}`} class={id === tab ? "active" : ""}>{label}</a>
        ))}
      </nav>
    </>
  );
};

/** Formular-Button mit Bestätigungsdialog. */
export const ConfirmButton: FC<{ action: string; label: string; confirm: string; class?: string; fields?: Record<string, string> }> = (p) => (
  <form method="post" action={p.action} onsubmit={`return confirm(${JSON.stringify(p.confirm)})`}>
    {Object.entries(p.fields ?? {}).map(([k, v]) => <input type="hidden" name={k} value={v} />)}
    <button class={p.class ?? "small danger"} type="submit">{p.label}</button>
  </form>
);
