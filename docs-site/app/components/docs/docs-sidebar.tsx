'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { Root, Node } from 'fumadocs-core/page-tree'

// HTTP method detection from page names
const HTTP_METHOD_PATTERNS: Record<string, string[]> = {
  GET: ['List', 'Get', 'Fetch', 'Read', 'Search', 'Query'],
  POST: ['Create', 'Add', 'Submit', 'Post'],
  PATCH: ['Update', 'Modify', 'Edit'],
  PUT: ['Replace', 'Set', 'Put'],
  DELETE: ['Delete', 'Remove', 'Destroy'],
  HEAD: ['Check', 'Verify', 'Exists'],
}

function getHttpMethod(name: string): string | null {
  for (const [method, patterns] of Object.entries(HTTP_METHOD_PATTERNS)) {
    if (patterns.some(pattern => name.startsWith(pattern))) {
      return method
    }
  }
  return null
}

// HTTP method badge colors
const METHOD_COLORS: Record<string, { bg: string; text: string }> = {
  GET: { bg: 'bg-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-400' },
  POST: { bg: 'bg-blue-500/20', text: 'text-blue-600 dark:text-blue-400' },
  PATCH: { bg: 'bg-amber-500/20', text: 'text-amber-600 dark:text-amber-400' },
  PUT: { bg: 'bg-orange-500/20', text: 'text-orange-600 dark:text-orange-400' },
  DELETE: { bg: 'bg-red-500/20', text: 'text-red-600 dark:text-red-400' },
  HEAD: { bg: 'bg-purple-500/20', text: 'text-purple-600 dark:text-purple-400' },
}

function HttpMethodBadge({ method }: { method: string }) {
  const colors = METHOD_COLORS[method] || { bg: 'bg-gray-500/20', text: 'text-gray-600' }
  const displayMethod = method === 'DELETE' ? 'DEL' : method

  return (
    <span className={cn(
      'shrink-0 px-1.5 py-0.5 text-[10px] font-semibold rounded',
      colors.bg,
      colors.text
    )}>
      {displayMethod}
    </span>
  )
}

interface DocsSidebarProps {
  tree: Root
}

// Is this tree node part of the Reference tab (its own url, or any descendant's, under /docs/reference)?
function isReferenceNode(node: Node): boolean {
  const url = (node as { url?: string }).url
  if (url) return url.startsWith('/docs/reference')
  const kids = (node as { children?: Node[] }).children
  return !!kids && kids.some(isReferenceNode)
}

export function DocsSidebar({ tree }: DocsSidebarProps) {
  const pathname = usePathname()
  const inReference = pathname.startsWith('/docs/reference')

  // Filter the tree to the ACTIVE tab so each tab (Guides / Reference) has its own sidebar.
  let nodes: Node[]
  if (inReference) {
    const refFolder = tree.children.find((n) => n.type === 'folder' && isReferenceNode(n)) as { children?: Node[] } | undefined
    nodes = refFolder?.children ?? tree.children.filter(isReferenceNode)
  } else {
    nodes = tree.children.filter((n) => !isReferenceNode(n))
  }

  return (
    <aside className="hidden lg:block w-64 shrink-0">
      <nav className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-10 pr-4">
        <SidebarNodes nodes={nodes} pathname={pathname} level={0} />
      </nav>
    </aside>
  )
}

interface SidebarNodesProps {
  nodes: Node[]
  pathname: string
  level: number
}

function SidebarNodes({ nodes, pathname, level }: SidebarNodesProps) {
  return (
    <div className="space-y-1">
      {nodes.map((node, index) => (
        <SidebarNode key={index} node={node} pathname={pathname} level={level} />
      ))}
    </div>
  )
}

interface SidebarNodeProps {
  node: Node
  pathname: string
  level: number
}

function SidebarNode({ node, pathname, level }: SidebarNodeProps) {
  if (node.type === 'separator') {
    return (
      <div className="pt-4 first:pt-0">
        <h5 className="text-sm font-semibold text-foreground mb-1.5">
          {node.name}
        </h5>
      </div>
    )
  }

  if (node.type === 'folder') {
    return (
      <div>
        <span className="block py-1 text-sm font-medium text-muted-foreground">
          {node.name}
        </span>
        {node.children && (
          <ul className="ml-3 mt-1 space-y-0.5 border-l border-border pl-3">
            {node.children.map((child, index) => (
              <SidebarNode key={index} node={child} pathname={pathname} level={level + 1} />
            ))}
          </ul>
        )}
      </div>
    )
  }

  const isActive = pathname === node.url

  // Check if this is an API endpoint page and extract the HTTP method
  const isApiEndpoint = (node.url as string)?.includes('/api-reference/')
  const nodeName = typeof node.name === 'string' ? node.name : ''
  const httpMethod = isApiEndpoint ? getHttpMethod(nodeName) : null

  return (
    <li className="list-none">
      <Link
        href={node.url}
        className={cn(
          'flex items-center gap-2 py-1 px-2 text-sm transition-colors rounded-md',
          isActive
            ? 'text-[var(--accent)] font-medium bg-[var(--accent-muted)]'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {httpMethod && <HttpMethodBadge method={httpMethod} />}
        <span>{node.name}</span>
      </Link>
    </li>
  )
}
