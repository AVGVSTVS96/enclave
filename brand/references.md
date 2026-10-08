# references

The look itself comes from the board Bassim approved on Oct 8 2026 (`.scratch/brand/directions4.html`: "Perfect… build the whole thing"). These two saves are what I studied to turn that board into a system. Both are from his X bookmarks folder "inspiration" (the Mac's `raw/xbook/2026-10-08` sync, read Oct 8 2026).

## 1. IBM Graphic Design Guide, 1969 to 1987

@Ekaeoq · https://x.com/Ekaeoq/status/1994752718460604552

One page of IBM's house-style binder: the eight-stripe logo on grid paper, with rules typed beside it.

- **Taken: positive and negative art are drawn separately.** The page says "Positive and Negative reproduction proofs require different artwork and are not interchangeable" and "Black stripes are drawn thicker than white stripes. White stripes look thicker… when lit." So the dark mark is not the light one recolored: on dark, the part of the `#` above the bar turns light, and the part on the bar stays ink, the way text on a highlighter does.
- **Taken: the guide is rules, not mood.** BRAND.md is written as rules with numbers next to them (sizes, ratios, contrast), like that page.
- **Taken: one blue, flat, carrying the whole surface.** That is field's cobalt: a single color, no tint ramp.
- **Not taken:** stripes, the grid-paper backdrop, IBM's blue, the binder skeuomorphism.

## 2. Text highlighter

@raul_dronca · https://x.com/raul_dronca/status/1991214286832550372 · demo https://text-highlighter-x.vercel.app/

A reading page where you drag over text and it gets a flat marker block. I stepped through the video frame by frame.

- **Taken: the highlight is a flat block, not a glow or underline.** It sits behind the text with a tiny radius (3px at body size), padded a few px past the letters, and that is the ledger's `--hl`.
- **Taken: in dark mode the highlight keeps its full color and the text on it turns dark.** That is why `--on-hl` is `#161616` in both themes and the highlight color itself never swaps.
- **Taken: one highlight means one thing.** He offers six colors because you are annotating; enclave offers one, because it only ever says "readable here".
- **Not taken:** the six-color palette, the serif heading, the gradient frame around the demo.

## Also read

- `~/Developer/commonplace-site/brand`: the shape of this folder (BRAND.md headings, `logo/gen.mjs`, specimen, render flow). Nothing of its look.
- The product itself: `README.md` and `page/index.html`. The ledger rows, the 304 bytes, the 30 minutes and the `#from=…&key=…` fragment are all real.

## Deliberately not taken

- Lock and shield icons, padlocks, keyholes, vault doors. Trust comes from showing what the relay sees, not from a symbol.
- Matrix green, dark hacker terminals, "military grade" anything.
- Gradients, glows, glass, 3D. A highlighter is the opposite of a glow: flat and on paper.
