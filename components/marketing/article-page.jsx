import { MarketingNav } from '@/components/marketing-nav'
import { MarketingFooter } from '@/components/marketing-footer'
import { Button } from '@/components/ui/button'
import { localizedPath } from '@/lib/i18n/config'
import { getArticle } from '@/lib/content/articles'

/**
 * Long-form guide / comparison page (lib/content/articles.js). Server
 * component on purpose: the whole text is in the initial HTML, which is what
 * search engines and AI crawlers read.
 */

const DATE_LABEL = { es: 'Actualizado el' }
const FAQ_LABEL = { es: 'Preguntas frecuentes' }
const SOURCES_LABEL = { es: 'Fuentes' }
const RELATED_LABEL = { es: 'Sigue leyendo' }
const START_LABEL = { es: 'Crear evento gratis' }
const PRICING_LABEL = { es: 'Ver precios' }

function formatDate(locale, iso) {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`)
  )
}

function ArticleTable({ head, rows }) {
  return (
    <div className="mt-5 overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <thead>
          <tr>
            {head.map((cell, i) => (
              <th key={i} scope="col" className="border-b border-border px-4 py-3 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-border last:border-0">
              {row.map((cell, c) =>
                c === 0 ? (
                  <th key={c} scope="row" className="px-4 py-3 align-top font-semibold text-foreground">{cell}</th>
                ) : (
                  <td key={c} className="px-4 py-3 align-top text-muted-foreground">{cell}</td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ArticlePage({ article }) {
  const { locale } = article
  const related = (article.related || []).map((slug) => getArticle(locale, slug)).filter(Boolean)

  return (
    <div className="relative min-h-screen bg-background font-body text-foreground">
      <MarketingNav />

      <main id="main-content" className="container px-4 pt-28 pb-20 sm:pt-36">
        <article className="mx-auto max-w-3xl">
          <header>
            <p className="font-mono text-xs uppercase tracking-wider text-accent-dark">{article.eyebrow}</p>
            <h1 className="mt-3 font-display text-3xl font-bold leading-tight tracking-tight text-balance sm:text-5xl">
              {article.h1}
            </h1>
            <p className="mt-4 text-sm text-muted-foreground">
              {DATE_LABEL[locale]} <time dateTime={article.updated}>{formatDate(locale, article.updated)}</time>
            </p>
            <div className="mt-8 space-y-4 text-lg leading-relaxed text-muted-foreground">
              {article.intro.map((p, i) => <p key={i}>{p}</p>)}
            </div>
          </header>

          {article.sections.map((section, i) => (
            <section key={i} className="mt-14">
              <h2 className="font-display text-2xl font-bold tracking-tight text-balance sm:text-3xl">{section.heading}</h2>
              {section.paragraphs?.map((p, j) => (
                <p key={j} className="mt-4 leading-relaxed text-muted-foreground">{p}</p>
              ))}
              {section.table && <ArticleTable {...section.table} />}
              {section.list && (() => {
                const List = section.list.ordered ? 'ol' : 'ul'
                return (
                  <List className={`mt-5 space-y-3 pl-5 leading-relaxed text-muted-foreground ${section.list.ordered ? 'list-decimal' : 'list-disc'}`}>
                    {section.list.items.map((item, j) => <li key={j} className="pl-1">{item}</li>)}
                  </List>
                )
              })()}
              {section.link && (
                <p className="mt-5">
                  <a href={localizedPath(locale, section.link.path)} className="font-semibold text-accent-dark underline-offset-4 hover:underline">
                    {section.link.label} →
                  </a>
                </p>
              )}
            </section>
          ))}

          {article.faq?.length > 0 && (
            <section className="mt-16">
              <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{FAQ_LABEL[locale]}</h2>
              <dl className="mt-6 divide-y divide-border rounded-2xl border border-border bg-surface">
                {article.faq.map((item, i) => (
                  <div key={i} className="px-5 py-4">
                    <dt className="font-semibold text-foreground">{item.q}</dt>
                    <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.a}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section className="mt-16 rounded-3xl border border-border bg-surface px-6 py-10 text-center">
            <h2 className="font-display text-2xl font-bold tracking-tight">{article.cta.title}</h2>
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">{article.cta.desc}</p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="cta-primary" asChild>
                <a href={localizedPath(locale, '/wedding-photo-sharing')}>{START_LABEL[locale]}</a>
              </Button>
              <Button size="lg" variant="outline" className="border-border bg-transparent" asChild>
                <a href={localizedPath(locale, '/pricing')}>{PRICING_LABEL[locale]}</a>
              </Button>
            </div>
          </section>

          {related.length > 0 && (
            <nav className="mt-12" aria-label={RELATED_LABEL[locale]}>
              <p className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">{RELATED_LABEL[locale]}</p>
              <ul className="mt-3 space-y-2">
                {related.map((r) => (
                  <li key={r.slug}>
                    <a href={localizedPath(locale, `/${r.slug}`)} className="font-semibold text-foreground underline-offset-4 hover:underline">
                      {r.h1}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          {(article.sources || article.disclaimer) && (
            <footer className="mt-12 border-t border-border pt-6 text-xs leading-relaxed text-muted-foreground">
              {article.sources && (
                <p>
                  {SOURCES_LABEL[locale]}:{' '}
                  {article.sources.map((s, i) => (
                    <span key={s.href}>
                      {i > 0 && ' · '}
                      <a href={s.href} rel="nofollow noopener" target="_blank" className="underline underline-offset-2">{s.label}</a>
                    </span>
                  ))}
                </p>
              )}
              {article.disclaimer && <p className="mt-2">{article.disclaimer}</p>}
            </footer>
          )}
        </article>
      </main>

      <MarketingFooter />
    </div>
  )
}
