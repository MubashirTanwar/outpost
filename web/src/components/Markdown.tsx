import ReactMarkdown from "react-markdown";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-coach">
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
