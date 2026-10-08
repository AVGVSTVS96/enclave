# enclave · brand

**The idea in a sentence:** the part of a link after `#` never leaves your device, so the brand is that part, highlighted.

Two themes ship in the page, and anyone can write a third. **ledger** is the house brand (site, README, icons). **field** is the loud one. Both were approved on the Oct 8 board ("Perfect… build the whole thing").

## Personality

- **For everyone.** "Grandma-level" simple. One question, one button, words like *locked* and *link*.
- **Exact.** Real numbers in their real shape: 304 bytes, 30 minutes, the real link. Trust comes from showing what the relay sees, never from a padlock.
- **Developer polish, not developer costume.** "A high security like developer but also like really polished vibe." Mono only where there is real data.
- **Calm.** Each screen says one thing. The rest stays out of the way.

## What it is and isn't

| it is | it isn't |
| --- | --- |
| a link you open once | an app, an account, a password manager |
| a highlighter on what's readable | a padlock, a shield, a vault door |
| one color you choose | a palette |
| the real link, the real bytes | "military-grade", "zero-knowledge" |

## The visual system

### ledger

Paper, ink, one highlighter. The highlight means **readable**: it marks the private `#` part of a link, and in the page's ledger it sits on whoever can read your secret right now (you while you type, hex once it's sent). Text on the highlight is always ink, in both themes, like a real marker.

### field

A full-bleed field of color means **inside the enclave**. The ask screen is just the form on the color. The route only shows up after you send, as one track. A dead link drops out of the color to gray.

### Custom color

Each theme takes one color, `ENCLAVE_COLOR`, as `--accent`: ledger's highlight, field's background. Text on it is white or ink, whichever passes 4.5:1 (cobalt gets white, `#ff4a2e` gets ink). field's dark background is `--accent` mixed 75% with black in sRGB, which lands cobalt on `#202fb4`. A color light enough to carry ink text stays as it is in dark mode, the way ledger keeps its yellow, since darkening it only muddies it.

### Tokens

`tokens.css` is the source. Dark is the same tokens swapped with `light-dark()`, and follows the system. The names match `page/themes/`.

| ledger | light | dark | use |
| --- | --- | --- | --- |
| `--accent` | `#ffe04a` | `#ffe04a` | the highlight: readable here |
| `--on-accent` | `#161616` | `#161616` | text on the highlight |
| `--page` | `#f6f6f3` | `#0d0d0c` | the page |
| `--card` | `#ffffff` | `#171716` | the card the form sits on |
| `--text` | `#161616` | `#f1f1ec` | text, the Send button |
| `--muted` | `#6c6c66` | `#9d9d95` | secondary text, data |
| `--line` | `#e4e4dd` | `#2c2c29` | hairlines, input borders |
| `--error` | `#b42318` | `#fda29b` | what went wrong |

| field | light | dark | use |
| --- | --- | --- | --- |
| `--accent` | `#2b3ff0` | `#2b3ff0` | `ENCLAVE_COLOR` |
| `--bg` | `--accent` | `--accent` 75% + black | the field |
| `--fg` | `#ffffff` | `#ffffff` | text on the field |
| `--muted` | `--fg` 85% on `--bg` | same | secondary text on the field |
| `--input` | `#ffffff` | `#0d0e12` | inputs |
| `--input-text` | `#10131a` | `#f1f2f6` | what you type |
| `--input-muted` | `#5d6170` | `#9a9eab` | hints, Show |
| `--ink` | `#0b0d14` | `#0b0d14` | Send, text on a dead link |
| `--outside` | `#eceef2` | `#15161a` | a dead link's background |

A dead link (`.gone`) swaps `--bg` to `--outside` and `--fg` to ink, so everything on it follows.

### Contrast

Every text token passes 4.5:1, checked by `bun contrast.mjs` in Chrome against the real `tokens.css` (so `light-dark()` and `color-mix()` resolve the way the page sees them).

| theme | text on surface | light | dark |
| --- | --- | --- | --- |
| ledger | `--text` on `--page` | 16.71 | 17.16 |
| ledger | `--text` on `--card` | 18.10 | 15.83 |
| ledger | `--muted` on `--page` | 4.88 | 7.12 |
| ledger | `--muted` on `--card` | 5.28 | 6.57 |
| ledger | `--error` on `--card` | 6.57 | 9.24 |
| ledger | `--on-accent` on `--accent` | 13.80 | 13.80 |
| ledger | `--card` on `--text` (button) | 18.10 | 15.83 |
| ledger, `#7ef0b4` | `--on-accent` on `--accent` | 12.93 | 12.93 |
| field | `--fg` on `--bg` | 6.84 | 11.19 |
| field | `--muted` on `--bg` | 5.35 | 8.47 |
| field | `--input-text` on `--input` | 18.58 | 17.24 |
| field | `--input-muted` on `--input` | 6.16 | 7.21 |
| field | `--on-ink` on `--ink` (button) | 19.41 | 19.41 |
| field, `#ff4a2e` | `--fg` on `--bg` | 5.55 (ink) | 6.52 (white) |
| field, `#ff4a2e` | `--muted` on `--bg` | 4.75 | 5.12 |
| field, dead link | `--fg` on `--bg` | 16.71 | 16.16 |
| field, dead link | `--muted` on `--bg` | 5.75 | 7.35 |

White on `#ff4a2e` is 3.35, which fails. That's why the text flips to ink on bright custom colors.

### Type

One sans per theme for everything a person reads; a mono only for real data (the link, byte counts, the cipher line). The fonts are the page's own files in `fonts/` (OFL), so the brand and the product render identically.

- **ledger: Instrument Sans + JetBrains Mono.** Display 600 at `-0.025em`, line-height 1.05 (44px hero word, 30px titles on the page). Body 400 at 17/1.55. Data in JetBrains Mono 500, 10.5–15px.
- **field: Geist + Geist Mono.** Display 700 at `-0.045em`, line-height 0.95 (40–52px on the page). Body 400 at 16/1.5. Data in Geist Mono 500.
- The monos are ASCII subsets plus `·`, `•` and `…`. Instrument Sans has no arrows, so none are used.

### Shapes and spacing

- Cards 20px radius, inputs 9px (ledger) and 10px (field), buttons 9px and 12px. The highlight is 3px: a marker, not a pill.
- 1px hairlines in `--line`; no shadows. field has no card at all; the color is the card.

### Motifs

1. **The link anatomy.** The real link (`moonlit-lynx-37.convex.site/eF1WskT4lLi5yz9YbLGSAg#from=hex&name=Netflix&field=email&field=password&key=…`), relay part in `--muted`, the fragment on the highlight. It's the hero on the site and the reason the mark is a `#`. On narrow screens each part gets its own line and the fragment ends in an ellipsis rather than wrapping.
2. **The ledger.** Three rows (you, relay, hex), the value in mono, one highlight on whoever can read it. Its words are fixed by the board: *what you type / nothing yet / the only key*, then *cleared / 304 locked bytes / the only key*, then *deleted*.
3. **The track.** Three stops on one line. Filled means the secret got there. hex's stop stays an open circle, because the page never hears back from hex; it only knows its upload went through.

## Motion

- **Follows real state, never a timer.** Something moves because something happened.
- **ledger:** when the state changes, the highlight wipes off the old row and onto the new one, left to right like a marker stroke: 240ms on `background-size`.
- **field:** when the POST returns OK, the line from you to relay draws (320ms `scaleX`), then the relay dot fills (120ms, after the line). Nothing animates while the request is in flight; a failed send moves nothing.
- One curve, `cubic-bezier(.2, .7, .2, 1)`. `prefers-reduced-motion` turns it all off.
- The specimen's Send button runs both, so they can be checked side by side.

## Logo

`logo/gen.mjs` draws everything from the real font outlines (`fonts/ttf/`), then renders the PNGs in headless Chrome: `bun logo/gen.mjs`.

**ledger mark: a `#` on a highlighter bar.** The `#` is Instrument Sans **Bold**'s own glyph, set on the baseline at the wordmark size, with a bar from half its height to just under the baseline. Why that glyph:

- It's the house face, so mark and wordmark come from one drawing.
- It leans, like the hand-drawn `#` on the approved board.
- At 700 its strokes are heavy enough that all four holes stay open at 16px (checked pixel by pixel). 600 goes soft at 16. Geist Bold's `#` is tighter and its middle hole fills in. The monos are 500 weight in a 0.6em cell, so their `#` turns thin and gray.

On dark, the part of the `#` above the bar turns light and the part on the bar stays ink, like any text under a highlighter. The mark box is nudged so the bar's top edge lands on a whole pixel at 16, 32 and 48px.

**field mark: the track.** you, relay, hex, in the state right after you send: two filled, the last open. In the wordmark it centers on Geist's x-height.

Directions considered (in `specimen.html`): **A**, the board's hand-drawn `#` (close, but strokes that don't match the type next to them); **B**, the glyph `#` (ledger); **C**, the track (field); **D**, `#enclave` in mono on one bar (reads as a hashtag).

| file | what |
| --- | --- |
| `ledger-mark`, `ledger-mark-dark` | the `#` on its bar, light and dark (SVG, PNG 512, transparent) |
| `ledger-wordmark`, `ledger-wordmark-dark` | mark + "enclave" in Instrument Sans 600 at `-0.035em` |
| `field-mark`, `field-wordmark` | white on a cobalt field |
| `field-mark-paper`, `field-wordmark-paper` | cobalt on transparent, for paper |
| `field-mark-white`, `field-wordmark-white` | white on transparent, for any custom color |
| `favicon.svg` | the ledger mark with its own `prefers-color-scheme` style |
| `apple-touch-icon.png`, `icon-512.png` | the ledger mark on white, full bleed |
| `explore-*` | directions A and D, light and dark |

Clear space: the bar's height on every side. Minimum size: 16px for the mark, 14px tall for the wordmark. The bar is always `--accent` and the `#` on it always ink.

## Do and don't

| do | don't |
| --- | --- |
| show the real link and the real 304 bytes | draw padlocks, shields, keys or vaults |
| one highlight, on what's readable now | highlight for emphasis or decoration |
| let the color fill the whole screen in field | put field's color on a card or a pill |
| move things when the state changes | animate on timers, scroll or hover |
| mono for data only | mono labels as costume |
| say *locked*, *link*, *relay* | say encrypted, zero-knowledge, military-grade |

## Files

```
brand/
├ BRAND.md         this
├ references.md    what this is built on, and what it isn't
├ tokens.css       both themes, light and dark, one file
├ specimen.html    the system in use
├ contrast.mjs     bun contrast.mjs: every text token against its surface
├ shots/           specimen at 390, 1035 and 1440, light and dark
├ fonts/           the page's woff2 files, plus the TTF instances gen.mjs reads
└ logo/            marks, wordmarks, icons, explorations, gen.mjs
```

Render the specimen with `bun ~/.agents/skills/brand-it/scripts/shoot.mjs brand/specimen.html brand/shots` from the repo root.
