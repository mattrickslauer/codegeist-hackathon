# Capturing the landing page media

Every image and clip in `site/public/media/` was recorded from the real app on the dev site (one-atlas-uyqa), by scripting a logged-in Chromium over the DevTools protocol.

1. Start a visible Chromium at native 2× (a CSS override does not reach Forge's cross-origin iframe), then log in once; the profile keeps the session:
   ```bash
   chromium-browser --user-data-dir=$HOME/.cache/walkdown-capture/profile --remote-debugging-port=9333 \
     --window-size=1600,1000 --force-device-scale-factor=2 https://one-atlas-uyqa.atlassian.net/jira
   ```
2. In a scratch folder: `npm i playwright-core@1.49.1`, copy these scripts in, and run them with `node`:
   | Script | Captures |
   |---|---|
   | `shoot1.mjs` | hero still, orbit clip, cascade (site page) |
   | `shoot6.mjs` | failure-cascade clip from the MSB card |
   | `shoot5.mjs` | RTU-1 card, Decisions tab |
   | `create-wo.mjs` | creates the conflicting work order (FAC-279 was made this way) |
   | `shoot2.mjs` / `shoot3.mjs` | Walkdown panel and comment; blocked *In Progress* clip |
   | `shoot4.mjs` | Rovo chat with the Walkdown agent |
   | `encode.sh <media dir>` | web MP4s, posters, WebP stills |
   | `preview.mjs <url>` | full-page desktop and phone screenshots of the built page |
3. Crops are page coordinates; clips from `rec.mjs` are scaled to 1920 px wide, so crop them at 1.2× CSS px.

Rules (from `branding/README.md`): no other vendors' app names in frame (crop to the app or the issue column), no `DEV` badge, and every illustrative value shown with its label or captioned as illustrative.
