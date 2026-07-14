/**
 * Server-rendered JSON-LD.
 *
 * Rendered on the server on purpose: Googlebot executes JS, but the AI crawlers
 * we care about (GPTBot, PerplexityBot, ClaudeBot) largely do not. Structured
 * data injected client-side is invisible to them.
 */
type Schema = { '@type': string };

export function JsonLd({ data }: { data: Schema | Schema[] }) {
  const payload = Array.isArray(data) ? data : [data];

  return (
    <>
      {payload.map((item) => (
        <script
          key={item['@type']}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            // `<` is escaped so a stray "</script>" in copy can't break out of
            // the script tag. The payload itself comes from our own typed schema
            // builders, never from user input.
            __html: JSON.stringify(item).replace(/</g, '\\u003c'),
          }}
        />
      ))}
    </>
  );
}
