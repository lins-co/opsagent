import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

interface MarkdownMessageProps {
  content: string
  className?: string
}

// Detect if a table is a WhatsApp message table (has Sender/Message columns)
function isWhatsAppTable(children: React.ReactNode): boolean {
  const childArr = Array.isArray(children) ? children : [children]
  const thead = childArr.find((c: any) => c?.type?.name === 'thead' || c?.props?.node?.tagName === 'thead' || c?.type === 'thead')
  if (!thead) return false
  const text = extractText(thead)
  return /sender/i.test(text) && /message/i.test(text)
}

function extractText(node: any): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(extractText).join(' ')
  if (node?.props?.children) return extractText(node.props.children)
  return ''
}

export default function MarkdownMessage({ content, className }: MarkdownMessageProps) {
  return (
    <div className={cn('prose-custom', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-[15px] font-semibold mt-4 mb-2 first:mt-0 text-foreground">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-[14px] font-semibold mt-3.5 mb-1.5 first:mt-0 text-foreground">{children}</h2>
          ),
          h3: ({ children }) => {
            const text = extractText(children)
            // Detect WhatsApp group headers (📱 or group-like headers)
            const isGroupHeader = /📱|group|whatsapp/i.test(text)
            if (isGroupHeader) {
              return (
                <div className="flex items-center gap-2.5 mt-5 mb-2 first:mt-0 px-3 py-2 rounded-lg bg-emerald-500/8 border border-emerald-500/15">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm">💬</span>
                  </div>
                  <div>
                    <h3 className="text-[13px] font-semibold text-foreground leading-tight">{children}</h3>
                  </div>
                </div>
              )
            }
            return <h3 className="text-[13px] font-semibold mt-3 mb-1 first:mt-0 text-foreground">{children}</h3>
          },
          p: ({ children }) => (
            <p className="text-[13px] leading-relaxed mb-2 last:mb-0">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-5 mb-2.5 space-y-1 text-[13px]">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 mb-2.5 space-y-1 text-[13px]">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed">{children}</li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-muted-foreground">{children}</em>
          ),
          code: ({ className: codeClassName, children, ...props }) => {
            const isInline = !codeClassName
            if (isInline) {
              return (
                <code className="px-1.5 py-0.5 rounded bg-secondary text-primary text-[12px] font-mono">
                  {children}
                </code>
              )
            }
            return (
              <code className={cn('block text-[12px] font-mono', codeClassName)} {...props}>
                {children}
              </code>
            )
          },
          pre: ({ children }) => (
            <pre className="rounded-lg bg-secondary/80 border border-border p-3 overflow-x-auto mb-3 text-[12px]">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/40 pl-3 my-2 text-muted-foreground italic text-[13px]">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-border my-4" />,
          a: ({ children, href }) => {
            const isDownload = href?.includes('/api/exports/') || href?.endsWith('.csv')
            if (isDownload) {
              return (
                <a
                  href={href}
                  download
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 my-1 rounded-lg bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors text-[12px] font-medium no-underline"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  {children}
                </a>
              )
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {children}
              </a>
            )
          },

          // ─── Tables ───
          table: ({ children }) => {
            const waStyle = isWhatsAppTable(children)
            return (
              <div className={cn(
                'my-3 rounded-xl border overflow-hidden',
                waStyle ? 'border-emerald-500/20 bg-emerald-500/3' : 'border-border'
              )}>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px] border-collapse">{children}</table>
                </div>
              </div>
            )
          },
          thead: ({ children }) => (
            <thead className="bg-secondary/80">{children}</thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-border/40">{children}</tbody>
          ),
          th: ({ children, style }) => {
            const align = style?.textAlign || 'left'
            return (
              <th
                className={cn(
                  'px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap',
                  align === 'right' && 'text-right',
                  align === 'center' && 'text-center',
                )}
              >
                {children}
              </th>
            )
          },
          td: ({ children, style }) => {
            const align = style?.textAlign || 'left'
            const text = typeof children === 'string' ? children : extractText(children)

            // Status coloring
            const isCritical = /CRITICAL|HIGH|⚠️|🔴|not working|down|issue|problem|malfunction|error/i.test(text)
            const isGood = /✅|OK|LOW|resolved|fixed|working/i.test(text)
            const isTotal = /^TOTAL$|^Total$/i.test(text.trim())

            // Time column detection (HH:MM or YYYY-MM-DD pattern)
            const isTime = /^\d{1,2}:\d{2}$|^\d{4}-\d{2}-\d{2}/.test(text.trim())

            // Sender column — bold names in WhatsApp tables
            const hasBold = Array.isArray(children)
              ? children.some((c: any) => c?.type?.name === 'strong' || c?.props?.node?.tagName === 'strong')
              : false

            return (
              <td
                className={cn(
                  'px-3.5 py-2 text-[12px]',
                  align === 'right' && 'text-right tabular-nums',
                  align === 'center' && 'text-center',
                  isTime && 'text-muted-foreground font-mono text-[11px] whitespace-nowrap',
                  isCritical && !hasBold && 'text-amber-400',
                  isGood && 'text-emerald-400',
                  isTotal && 'font-semibold text-foreground bg-secondary/40',
                  hasBold && 'text-primary font-medium whitespace-nowrap',
                )}
              >
                {children}
              </td>
            )
          },
          tr: ({ children }) => {
            const childArr = Array.isArray(children) ? children : [children]
            const firstCellText = extractText(childArr[0])
            const isTotal = /^TOTAL$|^Total$/i.test(firstCellText.trim())

            return (
              <tr
                className={cn(
                  'transition-colors',
                  isTotal
                    ? 'bg-secondary/50 font-medium'
                    : 'hover:bg-secondary/20'
                )}
              >
                {children}
              </tr>
            )
          },

          input: ({ checked, ...props }) => (
            <input
              type="checkbox"
              checked={checked}
              readOnly
              className="mr-1.5 accent-primary"
              {...props}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
