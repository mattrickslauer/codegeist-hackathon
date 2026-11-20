# walkdown.mattrickslauer.com

The app's public pages, linked from the Forge developer console (*Distribution → App details*):

| Field | URL |
|---|---|
| Customer support contact | https://walkdown.mattrickslauer.com/support/ |
| Privacy policy | https://walkdown.mattrickslauer.com/privacy/ |
| Terms of service | https://walkdown.mattrickslauer.com/terms/ |

`public/` is plain HTML and CSS: no build, no cookies. Every page loads the tally tag (`t.mattrickslauer.com/t.js`, site `walkdown`); links marked `data-tally="<event>"` are captured on click (`install_click`, `how_click`, `source_click`, `support_issue_click`). If you change what is counted, update the "This website" section of `public/privacy/index.html`. Support goes to GitHub issues on this repo because mattrickslauer.com has no inbound mail.

**Keep the privacy policy true.** It lists exactly what the app stores (account IDs only as personal data, Forge KVS and Object Store, no egress). If a change adds storage, egress, a scope or a log line with user content, update `public/privacy/index.html` in the same commit as `docs/ARCHITECTURE.md`.

Deploy (stack `walkdown-site`, us-east-1; uses the shared `*.mattrickslauer.com` certificate and the Route 53 zone in the same account):

```bash
./site/infra/deploy.sh
```
