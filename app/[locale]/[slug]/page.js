import { notFound } from 'next/navigation'
import { ARTICLES, getArticle } from '@/lib/content/articles'
import { ArticlePage } from '@/components/marketing/article-page'
import { JsonLd } from '@/lib/structured-data/json-ld'
import { getMarketingPageGraph } from '@/lib/structured-data/page-graph'
import { getArticleNode } from '@/lib/structured-data/article'
import { withSocialMetadata } from '@/lib/seo/social-metadata'
import { fillPriceTokensDeep } from '@/lib/currency'
import { getRequestCurrency } from '@/lib/server/request-currency'

// Guides and comparisons from lib/content/articles.js. Each exists in one
// locale only; every other /{locale}/{slug} is a 404.
export const dynamicParams = false

export function generateStaticParams() {
  return ARTICLES.map(({ locale, slug }) => ({ locale, slug }))
}

export async function generateMetadata({ params }) {
  const article = getArticle(params.locale, params.slug)
  if (!article) notFound()
  return withSocialMetadata(article.locale, {
    title: article.title,
    description: article.description,
    alternates: {
      canonical: `/${article.locale}/${article.slug}`,
    },
  })
}

export default function ArticleRoute({ params }) {
  const source = getArticle(params.locale, params.slug)
  if (!source) notFound()
  const article = fillPriceTokensDeep(source, getRequestCurrency(), source.locale)
  const graph = getMarketingPageGraph({
    locale: article.locale,
    path: `/${article.slug}`,
    name: article.title,
    description: article.description,
    questions: article.faq,
  })
  graph['@graph'].push(getArticleNode({ article }))
  return (
    <>
      <JsonLd data={graph} />
      <ArticlePage article={article} />
    </>
  )
}
