// JSON-LD emitter — server component, one <script type="application/ld+json">
// per payload. Structured data guidance:
//  - game pages: ["VideoGame", "WebApplication"] co-typed (VideoGame alone is
//    ignored for software rich results), applicationCategory GameApplication,
//    operatingSystem Any, free offer
//  - aggregateRating ONLY from real on-site ratings — we have none, so we
//    never emit it (faking it risks manual action)
//  - FAQ markup intentionally omitted (Google retired FAQ rich results)

export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

export function breadcrumb(items: { name: string; url: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  }
}

export function itemList(items: { name: string; url: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      url: it.url,
    })),
  }
}
