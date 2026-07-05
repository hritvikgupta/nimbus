import { source } from '@/lib/docs-source'
import { notFound } from 'next/navigation'
import { DocsTOC } from '../../components/docs/docs-toc'
import { DocsPager } from '../../components/docs/docs-pager'
import { getMDXComponents } from '../../components/docs/mdx'
import { findNeighbour } from 'fumadocs-core/page-tree'
import type { Metadata } from 'next'
import type { Root, Node } from 'fumadocs-core/page-tree'
import { getSiteUrl } from '@/lib/theme-config'

interface PageProps {
  params: Promise<{ slug?: string[] }>
}

// Find the section separator that precedes this page in the tree
function findSectionName(tree: Root, pageUrl: string): string {
  let lastSeparator = 'Documentation'

  function traverse(nodes: Node[]): string | null {
    for (const node of nodes) {
      if (node.type === 'separator') {
        // node.name can be ReactNode, convert to string safely
        lastSeparator = typeof node.name === 'string' ? node.name : 'Documentation'
      } else if (node.type === 'page' && node.url === pageUrl) {
        return lastSeparator
      } else if (node.type === 'folder' && node.children) {
        const result = traverse(node.children)
        if (result) return result
      }
    }
    return null
  }

  return traverse(tree.children) || lastSeparator
}

export default async function DocsPage({ params }: PageProps) {
  const { slug } = await params
  const page = source.getPage(slug)

  if (!page) notFound()

  const MDXContent = page.data.body
  const toc = page.data.toc

  // Get prev/next navigation — scoped to the active tab (Guides / Reference) so it never jumps tabs.
  const tree = source.pageTree
  const inReference = page.url.startsWith('/docs/reference')
  const isRef = (node: Node): boolean => {
    const url = (node as { url?: string }).url
    if (url) return url.startsWith('/docs/reference')
    const kids = (node as { children?: Node[] }).children
    return !!kids && kids.some(isRef)
  }
  const scopedChildren = inReference
    ? ((tree.children.find((n) => n.type === 'folder' && isRef(n)) as { children?: Node[] } | undefined)?.children ?? tree.children.filter(isRef))
    : tree.children.filter((n) => !isRef(n))
  const neighbours = findNeighbour({ ...tree, children: scopedChildren }, page.url)

  // Find section name for the header banner
  const sectionName = findSectionName(tree, page.url)

  return (
    <div className="flex gap-8">
      {/* Main content */}
      <article className="flex-1 min-w-0 max-w-3xl">
        {/* Header banner */}
        <header className="mb-8 pb-6 border-b border-border">
          <p className="text-sm text-[var(--accent)] font-medium mb-2">
            {sectionName}
          </p>
          <h1 className="text-3xl font-bold text-foreground">
            {page.data.title}
          </h1>
          {page.data.description && (
            <p className="mt-3 text-base text-muted-foreground">
              {page.data.description}
            </p>
          )}
        </header>

        {/* MDX content */}
        <div className="prose prose-slate dark:prose-invert max-w-none">
          <MDXContent components={getMDXComponents()} />
        </div>

        <DocsPager
          previous={neighbours.previous ? {
            name: typeof neighbours.previous.name === 'string' ? neighbours.previous.name : 'Previous',
            url: neighbours.previous.url
          } : undefined}
          next={neighbours.next ? {
            name: typeof neighbours.next.name === 'string' ? neighbours.next.name : 'Next',
            url: neighbours.next.url
          } : undefined}
        />
      </article>

      {/* Table of contents */}
      <DocsTOC toc={toc} />
    </div>
  )
}

export async function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const page = source.getPage(slug)

  if (!page) return {}

  const tree = source.pageTree
  const section = findSectionName(tree, page.url)
  const title = page.data.title
  const description = page.data.description

  // Static export: no dynamic OG image route — use plain metadata (a static preview image can be
  // dropped in later at /public and referenced here if desired).
  const baseUrl = getSiteUrl()
  void section

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
      url: `${baseUrl}${page.url}`,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}
