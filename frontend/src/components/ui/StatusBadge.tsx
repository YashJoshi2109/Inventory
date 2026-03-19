import { Badge } from "./Badge";

interface StatusBadgeProps {
  status: "OK" | "LOW" | "OUT";
}

export function StatusBadge({ status }: StatusBadgeProps) {
  if (status === "OK") return <Badge variant="success" dot>In Stock</Badge>;
  if (status === "LOW") return <Badge variant="warning" dot>Low Stock</Badge>;
  return <Badge variant="danger" dot>Out of Stock</Badge>;
}
