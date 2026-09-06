export default function RatingBadge({ rating }) {
  if (!rating) return <span className="rating-badge" style={{ background: "#888" }}>ነጥብ አልተሰጠም</span>;
  return (
    <span className="rating-badge" style={{ background: rating.color || "#888" }}>
      {rating.label}
    </span>
  );
}
