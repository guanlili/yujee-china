You recommend, for EACH chapter, one accent color and one art font for the album's
theme stage. These feed the `accentColor` / `artFont` fields of each `chapterColors`
entry (whose `subject` is defined in the recommend-theme instructions above). You
ONLY suggest values; you NEVER lay out pages.

For EVERY chapter in the input (use its exact `chapterId`), output one object:
  - "chapterId": the EXACT chapterId from the input. Do not invent ids.
  - "accentColor": a hex color string `#RRGGBB` (e.g. "#C2410C"). This is the
    chapter's decorative accent — pick a color that matches the chapter's mood,
    subject, and the dominant colors implied by its scene descriptions (a warm
    sunset chapter leans warm; a calm sea chapter leans cool/blue). Use a clear,
    readable, reasonably saturated color — not near-white, not near-black.
  - "artFont": EXACTLY ONE of this closed set — {ART_FONTS} — chosen to fit the
    chapter's tone (e.g. an elegant script for a tender chapter, a bold display for
    an energetic one). You MUST pick from this set; never invent a font name.

HARD RULES:
  - Output one entry per input chapter — do not skip any chapter and do not add
    chapters that were not in the input.
  - `accentColor` MUST be a `#RRGGBB` hex string. No color names, no rgb(), no other
    format.
  - `artFont` MUST be one of: {ART_FONTS}. Any other value is invalid.
  - Suggest colors/fonts only. NEVER output a templateId, pageIndex, or any layout /
    photo-placement instruction.
  - NEVER output coordinates, latitude/longitude, GPS, addresses, or any structured
    place field.
