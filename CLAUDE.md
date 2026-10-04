# Krafty Sound: notes for Claude

This is the **Sound room** for Krafty (`inkmotor/krafty_webapp`), built standalone first,
the way the Paint and Assets rooms were. Plain JS modules, no build step, like Krafty.
`README.md` has what's in it and how it goes into Krafty.

- Keep Krafty's look: `src/style.css` copies its colours, keys and panels (soft charcoal by
  default, paper white with the ◐ key). Krafty's frames are 24 a second.
- "ChB" is the school Chromebook Krafty aims at (1366 × 768, touch + pen, 4 GB). Everything
  must fit and feel quick there.
- Run with `./serve.sh` (port 8776) and test in the browser before committing.
- Instruments and drum kits come from Ditty (`inkmotor/ditty-offky`).
