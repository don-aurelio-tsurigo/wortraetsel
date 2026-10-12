import { Hono } from "hono";
import { admin } from "./admin/routes";
import { api } from "./game/api";
import { GamePage, NotFoundPage } from "./game/page";
import type { Env, PuzzleRow } from "./lib/types";

const app = new Hono<{ Bindings: Env }>();

app.route("/admin", admin);
app.route("/api", api);

app.get("/", (c) => c.html(<NotFoundPage />, 404));
app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));

// Logo aus R2. Öffentlich, auch für inaktive Rätsel (Vorschau im Backend).
app.get("/:slug/logo", async (c) => {
  const puzzle = await c.env.DB.prepare("SELECT logo_key FROM puzzles WHERE slug = ?")
    .bind(c.req.param("slug"))
    .first<Pick<PuzzleRow, "logo_key">>();
  if (!puzzle?.logo_key) return c.notFound();
  const obj = await c.env.FILES.get(puzzle.logo_key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
      ETag: obj.httpEtag,
      // SVGs dürfen kein Script ausführen
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
});

app.get("/:slug", async (c) => {
  const puzzle = await c.env.DB.prepare("SELECT * FROM puzzles WHERE slug = ? AND active = 1")
    .bind(c.req.param("slug"))
    .first<PuzzleRow>();
  if (!puzzle) return c.html(<NotFoundPage />, 404);
  c.header("Cache-Control", "no-store");
  return c.html(<GamePage puzzle={puzzle} />);
});

app.notFound((c) => c.html(<NotFoundPage />, 404));

export default app;
