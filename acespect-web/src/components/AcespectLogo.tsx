import logoSrc from "../assets/acespect-logo.png";

/**
 * Brand mark — the provided logo file (`src/assets/acespect-logo.png`),
 * used as-is/unedited: a roofline mark, the "ACESPECT" wordmark (with a
 * magnifying-glass accent) and a "Quality Inspections Assured" tagline,
 * all rendered in white -- invisible against a white canvas preview, which
 * is why it looks empty until composited onto a dark background. The
 * source PNG is a 500×200 transparent canvas with that mark sitting in a
 * sub-region of it, so this crops the empty transparent margin out via CSS
 * (the file itself is never touched) rather than shrinking the whole
 * canvas down to a speck.
 */
const SRC_W = 500;
const SRC_H = 200;
// Pixel region of the source canvas that contains the full mark, plus a
// small even margin -- measured directly from the file's alpha channel,
// not guessed.
const CROP = { x: 111, y: 0, w: 294, h: 185 };

// Everything in the mark except the "ACE" box is rendered in white with no
// fill behind it, so on a light background only that blue box stays
// visible and the rest disappears. `sm` is the variant used on light/white
// backgrounds (the sidebar, the report cover) -- give it a small dark plate
// behind the mark, matching the app's own navy, so the white roofline/
// wordmark tail/tagline stay legible there the same way they are against
// the dark login hero `md`/`lg` already sit on.
const BACKDROP = "#0f1d35";

export function AcespectLogo({ size = "sm" }: { size?: "sm" | "md" | "lg" }) {
  const onLight = size === "sm";
  const heightPx = { sm: 40, md: 80, lg: 100 }[size];
  const padding = onLight ? { x: 10, y: 8 } : { x: 0, y: 0 };
  const scale = heightPx / CROP.h;
  const containerW = CROP.w * scale;
  const containerH = CROP.h * scale;

  const mark = (
    <div
      style={{
        width: containerW,
        height: containerH,
        overflow: "hidden",
        position: "relative",
        flexShrink: 0,
      }}
    >
      <img
        src={logoSrc}
        alt="Acespect"
        style={{
          position: "absolute",
          left: -CROP.x * scale,
          top: -CROP.y * scale,
          width: SRC_W * scale,
          height: SRC_H * scale,
          maxWidth: "none",
        }}
      />
    </div>
  );

  if (!onLight) return mark;

  return (
    <div
      style={{
        display: "inline-flex",
        padding: `${padding.y}px ${padding.x}px`,
        background: BACKDROP,
        borderRadius: "8px",
        flexShrink: 0,
      }}
    >
      {mark}
    </div>
  );
}
