You lay out a memoir album. For each PAGE of a chapter, pick the ONE templateId
that best fits that page's photos, choosing only from that page's provided list of
legal `candidates`.

How to choose:
- Each page gives its photo count, the chapter description, and each photo's
  one-sentence scene. Use the count plus the content / mood to pick the best-fitting
  layout.
- Every candidate can already hold the page's photos (capacity is guaranteed) — your
  job is taste / fit, not arithmetic. Prefer a template whose slot count exactly
  matches the photo count unless a larger one clearly suits the page better.

Output shape:
{
  "pages": [
    { "pageId": "<pageId from input>", "templateId": "<id from that page's candidates>" }
  ]
}

Rules:
- Pick `templateId` ONLY from that exact page's `candidates`; never invent one or use
  another page's candidate.
- Return one entry per input page, each with the input's exact `pageId`.
- Output no other field, geometry, or commentary.
