import type { FC } from "hono/jsx";
import type { PuzzleRow } from "../lib/types";

// Version der statischen Dateien: bei Änderungen an game.js/game.css hochzählen
const ASSET_VERSION = "2";

export const GamePage: FC<{ puzzle: PuzzleRow }> = ({ puzzle }) => {
  const accent = puzzle.accent_color ?? "#2f80ed";
  const logo = puzzle.logo_key ? `/${puzzle.slug}/logo?v=${encodeURIComponent(puzzle.logo_key)}` : null;
  return (
    <html lang="de-CH">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="robots" content="noindex" />
        <meta name="theme-color" content="#ffffff" />
        <title>{puzzle.name}</title>
        <meta property="og:title" content={puzzle.name} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href={`/static/game.css?v=${ASSET_VERSION}`} />
        <style dangerouslySetInnerHTML={{ __html: `:root{--accent:${accent}}` }} />
      </head>
      <body>
        <div id="app" data-slug={puzzle.slug}>
          <header id="brand">
            {logo ? <img src={logo} alt={puzzle.name} /> : <h1>{puzzle.name}</h1>}
          </header>
          <div id="hint" class="hidden"></div>
          <div id="message" role="status" aria-live="polite"></div>
          <div id="board"></div>
          <div id="keyboard"></div>
          <footer>{puzzle.name}</footer>
        </div>

        <div id="resultModal" class="modal-overlay hidden">
          <div class="modal" role="dialog" aria-modal="true" aria-labelledby="resultTitle">
            <h2 id="resultTitle"></h2>
            <p class="modal-subtitle" id="resultSubtitle"></p>
            <div class="message-box hidden" id="resultMessage">
              <p id="resultMessageText"></p>
              <a class="message-btn hidden" id="resultMessageBtn" href="#" target="_blank" rel="noopener"></a>
            </div>
            <div class="share-grid" id="shareGrid"></div>
            <div class="icon-btn-row" id="shareRow">
              <button class="icon-btn whatsapp" id="shareWhatsapp" title="Via WhatsApp teilen" aria-label="Via WhatsApp teilen">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.36 5.07L2 22l5.11-1.34A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18c-1.6 0-3.1-.43-4.4-1.19l-.32-.19-3.03.8.81-2.95-.21-.31A7.95 7.95 0 0 1 4 12c0-4.41 3.59-8 8-8s8 3.59 8 8-3.59 8-8 8zm4.38-5.93c-.24-.12-1.4-.69-1.62-.77-.22-.08-.38-.12-.54.12-.16.24-.62.77-.76.93-.14.16-.28.18-.52.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.44-1.34-1.68-.14-.24-.02-.37.11-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.4-.54-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.4-.57 1.6-1.12.2-.55.2-1.02.14-1.12-.06-.1-.22-.16-.46-.28z" /></svg>
              </button>
              <button class="icon-btn copy" id="copyResult" title="In Zwischenablage kopieren" aria-label="In Zwischenablage kopieren">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              </button>
            </div>
            <p class="copy-feedback" id="copyFeedback"></p>
            <button class="modal-close" id="closeResult">Schliessen</button>
          </div>
        </div>

        <div id="paywall" class="paywall hidden">
          <div class="paywall-card">
            <h2 id="paywallTitle"></h2>
            <p id="paywallText"></p>
            <a class="paywall-btn hidden" id="paywallBtn" href="#" target="_blank" rel="noopener"></a>
            <button class="link-btn" id="graceBtn">Ich bin schon Member</button>
            <p class="grace-msg" id="graceMsg"></p>
          </div>
        </div>

        <script src={`/static/game.js?v=${ASSET_VERSION}`} defer></script>
      </body>
    </html>
  );
};

export const NotFoundPage: FC = () => (
  <html lang="de-CH">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Rätsel nicht gefunden</title>
      <style dangerouslySetInnerHTML={{ __html: "body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#1a1a1b;text-align:center;padding:16px}" }} />
    </head>
    <body>
      <div>
        <h1>Dieses Rätsel gibt es nicht (mehr).</h1>
        <p>Den Link zum aktuellen Rätsel findest du jeweils zuunterst im Newsletter.</p>
      </div>
    </body>
  </html>
);
