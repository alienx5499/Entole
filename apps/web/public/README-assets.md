# Image slots

The web app loads these files if they exist. Each one has a fallback, so the page works without them.

| Path                     | Used by                         | Fallback when missing                      |
| ------------------------ | ------------------------------- | ------------------------------------------ |
| `/paypal-logo.svg`       | Log in with PayPal button       | The button shows its text only             |
| `/img/hero.webp`         | Homepage hero, right side       | Inline drawing of a price line and a limit |
| `/img/how-it-works.webp` | Homepage "How it works" section | The numbered step list only (always shown) |

## PayPal logo

`paypal-logo.svg` is PayPal's official monotone (white) mark, taken unchanged from PayPal's asset server: https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-mark-monotone.svg. PayPal's Log in with PayPal design guide asks for the white icon on the blue button. Do not redraw or recolor it. It is shown 24px tall.

## Hero and how-it-works images

Use WebP (PNG also works). The files here are about 2x their display size so they stay sharp on high-density screens; Next resizes them per visitor. The hero is laid out for about 1200 by 800 and the how-it-works image for about 1600 by 900. Both scale to the column width.

## Logo sources

`logos/` holds the official brand files used in the homepage "Built with" section and on the architecture image in `README.md` and `docs/ARCHITECTURE.md`: PayPal's colour mark from paypalobjects.com, Channel3's wordmark from trychannel3.com, Groq's wordmark from groq.com, AG Grid, Bryntum and APIMatic wordmarks from their own sites, and Neon, Render, Vercel, Next.js and Bun from Simple Icons (CC0). Files are unchanged.

- PayPal: official colour mark from PayPal's asset server, https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-mark-color.svg
- Neon, Vercel, Next.js, Render, Bun: Simple Icons (CC0), version 16.30.0, https://cdn.jsdelivr.net/npm/simple-icons@16.30.0/icons/. Neon is in its brand green #34D59A; the small badges are navy #1b1f3a.
- Groq: the Groq wordmark from the header of https://groq.com (Simple Icons has no Groq icon), coloured #F43E01 from Groq's own favicon.
- Channel3: the official wide logo from its site, https://trychannel3.com/logos/channel3/channel3-logo-wide-light.svg
- AG Grid: the official light-theme wordmark from its site, https://www.ag-grid.com/images/ag-logos/svg-logos/AG-Grid-Logo_Light-Theme.svg (saved as `ag-grid.svg`, unchanged).
- Bryntum: the official wordmark from its site, https://bryntum.com/resources/Bryntum.png, resized to 72px tall and saved as `bryntum.webp`.
- APIMatic: the official blue wordmark from its site, https://www.apimatic.io/hubfs/apimatic/APIMatic-logo-blue.svg (saved as `apimatic.svg`, unchanged).
- Architecture image only: Bun's colour logo from its press kit, https://bun.com/logo.svg, and the Model Context Protocol mark from https://github.com/modelcontextprotocol/modelcontextprotocol/tree/main/docs/logo (`light.svg`, mark only). The other plates use the files above.
