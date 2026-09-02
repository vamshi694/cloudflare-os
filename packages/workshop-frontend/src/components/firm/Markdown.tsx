import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Document-grade markdown for the firm's screens: playbooks, the plan, the brief. Headings in the
 * display stack, hairlined tables, quiet bullets. No syntax highlighting, no raw HTML.
 */
export default function Markdown({ children, className = '' }: { children: string; className?: string }) {
  return (
    <div className={`legal-prose text-[14.5px] leading-[1.7] text-kumo-default ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-6 mb-2 text-[20px] leading-6 font-semibold tracking-[-0.4px] first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-6 mb-2 text-[16px] leading-5 font-semibold tracking-[-0.3px] first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-4 mb-1.5 text-[14px] leading-5 font-semibold tracking-[-0.2px]">{children}</h3>
          ),
          p: ({ children }) => <p className="my-2.5">{children}</p>,
          ul: ({ children }) => <ul className="my-2.5 list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2.5 list-decimal pl-5">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-kumo-strong">{children}</strong>,
          a: ({ children, href }) => (
            <a href={href} className="text-kumo-brand underline underline-offset-2" target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l border-kumo-line pl-3 text-kumo-subtle">{children}</blockquote>
          ),
          code: ({ children }) => (
            <code className="rounded bg-kumo-tint px-1 py-0.5 font-mono text-[13px]">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-lg bg-kumo-tint p-3 font-mono text-[12.5px] leading-5">{children}</pre>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-[13.5px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-kumo-line px-2 py-1.5 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="border-b border-kumo-line px-2 py-1.5 align-top">{children}</td>,
          hr: () => <hr className="my-5 border-kumo-line" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
