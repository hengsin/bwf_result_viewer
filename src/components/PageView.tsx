interface PageViewProps {
  html: string
}

export function PageView({ html }: PageViewProps) {
  return <div className="page-content" dangerouslySetInnerHTML={{ __html: html }} />
}
