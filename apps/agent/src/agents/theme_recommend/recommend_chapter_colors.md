The per-chapter `accentColor` and `artFont` for each `chapterColors` entry (whose
`subject` is defined above). For EVERY chapter (use its exact `chapterId`):
  - `accentColor`: a `#RRGGBB` hex string (e.g. "#C2410C") — the chapter's decorative
    accent. Match the chapter's mood / subject / dominant scene colors (a warm sunset
    leans warm, a calm sea leans cool). Clear and readable, reasonably saturated — not
    near-white, not near-black. No color names, no rgb().
  - `artFont`: EXACTLY ONE of {ART_FONTS}, chosen to fit the chapter's tone (an elegant
    script for a tender chapter, a bold display for an energetic one). Never invent a
    font name.
