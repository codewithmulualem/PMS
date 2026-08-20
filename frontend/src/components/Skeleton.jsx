export default function Skeleton({ lines = 1, height = 14, className = "" }) {
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height, width: i % 3 === 1 ? "80%" : "100%" }} />
      ))}
    </div>
  );
}
