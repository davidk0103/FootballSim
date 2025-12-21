import { useEffect, useMemo, useRef } from "react";
import type { Player } from "../types";

type Props = {
  width?: number;
  height?: number;
  offense: Player[];
};

function toPxX(x: number, w: number) {
  return x * w;
}

// y is normalized 0..1 where y increases "upfield"
// Canvas y increases downward, so invert.
function toPxY(y: number, h: number) {
  return (1 - y) * h;
}

export default function CanvasField({ width = 720, height = 420, offense }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const losY = 0.2; // line of scrimmage in normalized coords
  const firstDownY = 0.45;

  const offenseColor = useMemo(() => "#1f2937", []); // dark gray
  const losColor = useMemo(() => "#2563eb", []); // blue
  const firstDownColor = useMemo(() => "#facc15", []); // yellow

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // High-DPI crisp rendering
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Field background
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);

    // Border
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, width - 2, height - 2);

    // LOS + 1st down lines
    const losPy = toPxY(losY, height);
    const fdPy = toPxY(firstDownY, height);

    ctx.strokeStyle = losColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, losPy);
    ctx.lineTo(width, losPy);
    ctx.stroke();

    ctx.strokeStyle = firstDownColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, fdPy);
    ctx.lineTo(width, fdPy);
    ctx.stroke();

    // Label lines
    ctx.fillStyle = "#6b7280";
    ctx.font = "12px system-ui";

    // Draw offense players
    for (const p of offense) {
      const px = toPxX(p.x, width);
      const py = toPxY(p.y, height);

      // Circle
      ctx.fillStyle = offenseColor;
      ctx.beginPath();
      ctx.arc(px, py, 16, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.id, px, py);
    }

    // reset text alignment so future drawing isn't weird
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }, [width, height, offense, offenseColor, losColor, firstDownColor]);

  return <canvas ref={canvasRef} />;
}
