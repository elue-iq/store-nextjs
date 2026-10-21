import { LOGO_PATH, LOGO_VIEWBOX } from "@/lib/brand-mark";

// ÉLUE wordmark. Colour follows the text colour (currentColor).
export function Logo({ className, title = "ÉLUE" }: { className?: string; title?: string }) {
  const { x, y, width, height } = LOGO_VIEWBOX;
  return (
    <svg className={className} viewBox={`${x} ${y} ${width} ${height}`} role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
      <path fill="currentColor" fillRule="evenodd" d={LOGO_PATH} />
    </svg>
  );
}
