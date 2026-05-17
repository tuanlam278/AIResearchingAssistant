function formatScore(score) {
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  const normalized = score <= 1 ? score * 100 : score;
  return `${Math.round(normalized)}%`;
}

export default function SourceCard({ source }) {
  if (!source) return null;

  const title =
    source.title ||
    source.source_name ||
    `Nguồn #${source.chunk_id || "không rõ"}`;
  const url = source.url || source.link;
  const snippet = source.snippet || source.summary || source.content;
  const publishedAt = source.published_at || source.date;
  const page = source.page;
  const scoreText = formatScore(source.score || source.relevance);

  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 8,
        padding: 10,
        marginBottom: 8,
      }}
    >
      <div style={{ marginBottom: 6 }}>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{ fontWeight: 600 }}
          >
            {title}
          </a>
        ) : (
          <span style={{ fontWeight: 600 }}>{title}</span>
        )}
      </div>

      <small>
        {typeof page === "number" ? `Trang ${page}` : "Không rõ trang"}
        {scoreText ? ` · Độ liên quan: ${scoreText}` : ""}
        {publishedAt ? ` · ${publishedAt}` : ""}
      </small>

      {snippet && (
        <p style={{ fontSize: 13, marginTop: 6, whiteSpace: "pre-wrap" }}>
          {snippet}
        </p>
      )}
    </div>
  );
}
