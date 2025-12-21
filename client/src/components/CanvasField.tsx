import { useEffect, useMemo, useRef } from "react";
import type {
  Coverage,
  OffensePosition,
  PlayResult,
  Player,
  RouteAssignment,
  RouteType,
} from "../types";

type Props = {
  width?: number;
  height?: number;
  offense: Player[];
  routes: RouteAssignment[];
  defense: Player[];
  coverage: Coverage;
  isPlaying: boolean;
  speed: number; // 0.5,1,2
  target: Exclude<OffensePosition, "QB">; // QB should not be a target
  tThrow?: number; // seconds (optional override)
  onResult?: (r: PlayResult) => void;
  onDone?: () => void;
};

type Pt = { x: number; y: number };

function routeTemplate(route: RouteType, receiverX: number): Pt[] {
  // receiverX determines inside/outside direction
  const insideDir = receiverX < 0.5 ? +1 : -1; // move toward center
  const outsideDir = -insideDir;

  switch (route) {
    case "HITCH":
      return [{ x: 0, y: 0 }, { x: 0, y: 0.12 }];
    case "SLANT":
      return [{ x: 0, y: 0 }, { x: 0.10 * insideDir, y: 0.16 }];
    case "OUT":
      return [{ x: 0, y: 0 }, { x: 0, y: 0.12 }, { x: 0.14 * outsideDir, y: 0.14 }];
    case "CORNER":
      return [{ x: 0, y: 0 }, { x: 0, y: 0.16 }, { x: 0.16 * outsideDir, y: 0.28 }];
    case "POST":
      return [{ x: 0, y: 0 }, { x: 0, y: 0.16 }, { x: 0.14 * insideDir, y: 0.30 }];
    case "GO":
      return [{ x: 0, y: 0 }, { x: 0, y: 0.46 }];
    case "DIG":
      return [{ x: 0, y: 0 }, { x: 0, y: 0.20 }, { x: 0.18 * insideDir, y: 0.21 }];
    case "CURL":
      return [{ x: 0, y: 0 }, { x: 0, y: 0.22 }];
    case "FLAT":
      return [{ x: 0, y: 0 }, { x: 0.18 * outsideDir, y: 0.02 }];
    case "STICK":
      return [{ x: 0, y: 0 }, { x: 0, y: 0.10 }];
    default:
      return [{ x: 0, y: 0 }, { x: 0, y: 0.12 }];
  }
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function buildAbsoluteRoutePoints(receiver: Player, route: RouteType): Pt[] {
  const tpl = routeTemplate(route, receiver.x);
  return tpl.map((pt) => ({
    x: clamp01(receiver.x + pt.x),
    y: clamp01(receiver.y + pt.y),
  }));
}

function dist(a: Pt, b: Pt) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function alignDefense(defense: Player[], offense: Player[]): Player[] {
  // Keep base alignment but shade slightly toward WR splits (no hard snap)
  const next = defense.map((d) => ({ ...d }));
  const wr1 = offense.find((p) => p.id === "WR1");
  const wr2 = offense.find((p) => p.id === "WR2");
  const wr3 = offense.find((p) => p.id === "WR3");
  const cb1 = next.find((d) => d.id === "CB1");
  const cb2 = next.find((d) => d.id === "CB2");
  const nickel = next.find((d) => d.id === "N");

  const blend = (base: number, target: number) => base * 0.7 + target * 0.3;

  if (wr1 && cb1) cb1.x = blend(cb1.x, wr1.x);
  if (wr2 && nickel) nickel.x = blend(nickel.x, wr2.x);
  if (wr3 && cb2) cb2.x = blend(cb2.x, wr3.x);

  return next;
}

function zoneHomeFor(id: string, coverage: Coverage, losY: number, initial?: Player): Pt {
  if (coverage === "COVER_2") {
    const map: Record<string, Pt> = {
      CB1: { x: 0.14, y: losY + 0.26 }, // wider squat/flat
      CB2: { x: 0.86, y: losY + 0.26 },
      N: { x: 0.60, y: losY + 0.22 }, // hook/curl
      LB1: { x: 0.45, y: losY + 0.24 },
      LB2: { x: 0.55, y: losY + 0.24 },
      S1: { x: 0.35, y: losY + 0.46 }, // deep half
      S2: { x: 0.65, y: losY + 0.46 },
    };
    const baseY = map[id]?.y ?? losY + 0.28;
    const y = initial ? initial.y * 0.6 + baseY * 0.4 : baseY;
    return map[id] ? { x: map[id].x, y } : { x: 0.5, y };
  }
  if (coverage === "COVER_3") {
    const map: Record<string, Pt> = {
      CB1: { x: 0.16, y: losY + 0.42 }, // deep third, keep outside leverage
      CB2: { x: 0.84, y: losY + 0.42 },
      N: { x: 0.60, y: losY + 0.26 }, // curl/flat
      LB1: { x: 0.46, y: losY + 0.24 }, // hook
      LB2: { x: 0.54, y: losY + 0.24 },
      S1: { x: 0.50, y: losY + 0.46 }, // deep middle
      S2: { x: 0.62, y: losY + 0.26 }, // curl/flat / robber-ish
    };
    const baseY = map[id]?.y ?? losY + 0.3;
    const y = initial ? initial.y * 0.6 + baseY * 0.4 : baseY;
    return map[id] ? { x: map[id].x, y } : { x: 0.5, y };
  }
  if (coverage === "QUARTERS") {
    const map: Record<string, Pt> = {
      CB1: { x: 0.20, y: losY + 0.40 },
      CB2: { x: 0.80, y: losY + 0.40 },
      N: { x: 0.60, y: losY + 0.28 },
      LB1: { x: 0.46, y: losY + 0.26 },
      LB2: { x: 0.54, y: losY + 0.26 },
      S1: { x: 0.36, y: losY + 0.44 },
      S2: { x: 0.64, y: losY + 0.44 },
    };
    const baseY = map[id]?.y ?? losY + 0.32;
    const y = initial ? initial.y * 0.6 + baseY * 0.4 : baseY;
    return map[id] ? { x: map[id].x, y } : { x: 0.5, y };
  }
  // default / Cover 1 man: shallow homes
  const map: Record<string, Pt> = {
    CB1: { x: 0.2, y: losY + 0.20 },
    CB2: { x: 0.8, y: losY + 0.20 },
    N: { x: 0.6, y: losY + 0.20 },
    LB1: { x: 0.46, y: losY + 0.22 },
    LB2: { x: 0.54, y: losY + 0.22 },
    S1: { x: 0.50, y: losY + 0.46 },
    S2: { x: 0.58, y: losY + 0.20 },
  };
  const baseY = map[id]?.y ?? losY + 0.28;
  const y = initial ? initial.y * 0.6 + baseY * 0.4 : baseY;
  return map[id] ? { x: map[id].x, y } : { x: 0.5, y };
}

function moveToward(a: Pt, b: Pt, maxStep: number): Pt {
  const d = dist(a, b);
  if (d <= 1e-6) return a;
  const u = Math.min(1, maxStep / d);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

function positionAlongPolyline(pts: Pt[], distanceTravelled: number): Pt {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return pts[0];

  let remaining = distanceTravelled;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const segLen = dist(a, b);

    if (segLen <= 1e-6) continue;

    if (remaining <= segLen) {
      const t = remaining / segLen;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= segLen;
  }
  return pts[pts.length - 1];
}


function toPxX(x: number, w: number) {
  return x * w;
}

// y is normalized 0..1 where y increases "upfield"
// Canvas y increases downward, so invert.
function toPxY(y: number, h: number) {
  return (1 - y) * h;
}

export default function CanvasField({
  width = 720,
  height = 420,
  offense,
  routes,
  defense,
  coverage,
  isPlaying,
  speed,
  target,
  tThrow,
  onResult,
  onDone,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simTimeRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const defenseStateRef = useRef<Player[]>([]);
  const defenseInitialRef = useRef<Player[]>([]);

  const offenseColor = useMemo(() => "#1f2937", []); // dark gray
  const alignedDefense = useMemo(() => alignDefense(defense, offense), [defense, offense]);

  useEffect(() => {
    // reset defense state when inputs change
    defenseStateRef.current = alignedDefense.map((d) => ({ ...d }));
    defenseInitialRef.current = defense.map((d) => ({ ...d }));
  }, [alignedDefense, defense]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // HiDPI
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const losY = 0.2;
    const firstDownY = 0.45;

    const tSnap = 0.25;
    const wrSpeed = 0.22; // tweak later (normalized units/sec)

    const targetReceiver = offense.find((p) => p.id === target);
    const targetRoute = routes.find((r) => r.receiverId === target);
    let throwAt = tThrow ?? 1.0;
    if (tThrow == null && targetReceiver && targetRoute) {
      const pts = buildAbsoluteRoutePoints(targetReceiver, targetRoute.route);
      const totalLen = pts.reduce((acc, _, idx) => {
        if (idx === 0) return acc;
        return acc + dist(pts[idx - 1], pts[idx]);
      }, 0);
      const routeTravelTime = totalLen / wrSpeed;
      const anticipationFactor = 0.7; // throw a bit before completion
      throwAt = Math.max(tSnap, routeTravelTime * anticipationFactor);
    }
    const tEnd = throwAt + 0.8; // throw + landing buffer

    const drawFrame = (simT: number, dt: number) => {
      // ---------- Background ----------
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, width - 2, height - 2);

      // lines
      const losPy = toPxY(losY, height);
      const fdPy = toPxY(firstDownY, height);

      ctx.strokeStyle = "#2563eb"; // LOS blue
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, losPy);
      ctx.lineTo(width, losPy);
      ctx.stroke();

      ctx.strokeStyle = "#facc15"; // First down yellow
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, fdPy);
      ctx.lineTo(width, fdPy);
      ctx.stroke();

      // ---------- Precompute moving positions ----------
      const offenseNow: Player[] = offense.map((p) => ({ ...p }));
      const defenseNow: Player[] = defenseStateRef.current;

      // Pre-snap mirror CB/Star to WR splits
      if (simT <= tSnap) {
        const wr1 = offenseNow.find((p) => p.id === "WR1");
        const wr2 = offenseNow.find((p) => p.id === "WR2");
        const wr3 = offenseNow.find((p) => p.id === "WR3");
        const cb1 = defenseNow.find((d) => d.id === "CB1");
        const cb2 = defenseNow.find((d) => d.id === "CB2");
        const nickel = defenseNow.find((d) => d.id === "N");

        if (wr1 && cb1) cb1.x = wr1.x;
        if (wr2 && nickel) nickel.x = wr2.x;
        if (wr3 && cb2) cb2.x = wr3.x;
      }

      // Move receivers along their routes
      for (const ra of routes) {
        const receiver = offense.find((p) => p.id === ra.receiverId);
        if (!receiver) continue;

        const absPts = buildAbsoluteRoutePoints(receiver, ra.route);
        const pos = positionAlongPolyline(absPts, wrSpeed * simT);

        const idx = offenseNow.findIndex((p) => p.id === ra.receiverId);
        if (idx >= 0) {
          offenseNow[idx].x = pos.x;
          offenseNow[idx].y = pos.y;
        }
      }

      // QB small dropback (purely visual)
      const qbIdx = offenseNow.findIndex((p) => p.id === "QB");
      if (qbIdx >= 0) {
        const qb = offenseNow[qbIdx];
        const drop = Math.min(simT / 1.0, 1) * 0.04;
        offenseNow[qbIdx] = { ...qb, y: qb.y - drop };
      }

      // ---------- Move defense (man/zone MVP) ----------
      const speedPerSecond: Record<string, number> = {
        CB1: 0.26,
        CB2: 0.26,
        N: 0.24,
        S1: 0.22,
        S2: 0.22,
        LB1: 0.20,
        LB2: 0.20,
      };
      const baseSpeed = 0.20;
      const assign: Record<string, string | undefined> = {
        CB1: "WR1",
        CB2: "WR3",
        N: "WR2",
        LB1: "TE",
        LB2: "RB",
      };

      // clamp frame delta to avoid big jumps if tab was inactive
      const frameDt = Math.min(dt || 0.016, 0.05); // seconds
      const reactionDelay = 0.2;

      for (let i = 0; i < defenseNow.length; i++) {
        const d = defenseNow[i];
        const cur: Pt = { x: d.x, y: d.y };
        const isCorner = d.id === "CB1" || d.id === "CB2";
        const maxDxCorner = 0.0035; // limit lateral slide per frame for corners

        if (simT < reactionDelay) continue;

        if (coverage === "COVER_1") {
          const rid = assign[d.id];
          const wr = rid ? offenseNow.find((p) => p.id === rid) : undefined;
          if (wr) {
            const speed = speedPerSecond[d.id] ?? baseSpeed;
            const step = speed * frameDt;
            const leverageOffset = wr.x < 0.5 ? -0.03 : 0.03; // outside leverage
            const targetX = Math.max(0, Math.min(1, wr.x + leverageOffset));
            const nxt = moveToward(cur, { x: targetX, y: wr.y }, step);
            // keep corners from snapping inside too hard
            if (isCorner) {
              defenseNow[i].x = Math.max(cur.x - maxDxCorner, Math.min(cur.x + maxDxCorner, nxt.x));
              defenseNow[i].y = nxt.y;
            } else {
              defenseNow[i].x = nxt.x;
              defenseNow[i].y = nxt.y;
            }
          }
        } else {
          // zone: base home from coverage landmarks blended with initial depth
          const initial = defenseInitialRef.current.find((p) => p.id === d.id);
          let home = zoneHomeFor(d.id, coverage, losY, initial);
          // keep corners on their aligned pre-snap x for flat/deep leverage
          if (isCorner && initial) {
            home = { ...home, x: initial.x };
          }
          const speed = speedPerSecond[d.id] ?? baseSpeed;

          // closest receiver (non-QB)
          let bestWr: Player | null = null;
          let bestD = 999;
          for (const o of offenseNow) {
            if (o.id === "QB") continue;
            const dd = dist({ x: o.x, y: o.y }, home);
            if (dd < bestD) {
              bestD = dd;
              bestWr = o;
            }
          }

          const threat = bestWr ? { x: bestWr.x, y: bestWr.y } : home;
          const weightHome = isCorner ? 0.95 : 0.8;
          const weightThreat = 1 - weightHome;
          const targetPt: Pt = {
            x: home.x * weightHome + threat.x * weightThreat,
            y: home.y * weightHome + threat.y * weightThreat,
          };

          const step = speed * frameDt;
          const nxt = moveToward(cur, targetPt, step);
          if (isCorner) {
            defenseNow[i].x = Math.max(cur.x - maxDxCorner, Math.min(cur.x + maxDxCorner, nxt.x));
            defenseNow[i].y = nxt.y;
          } else {
            defenseNow[i].x = nxt.x;
            defenseNow[i].y = nxt.y;
          }
        }
      }

      // ---------- Draw routes (as reference lines) ----------
      for (const ra of routes) {
        const receiver0 = offense.find((p) => p.id === ra.receiverId);
        if (!receiver0) continue;

        const pts = buildAbsoluteRoutePoints(receiver0, ra.route);

        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.moveTo(toPxX(pts[0].x, width), toPxY(pts[0].y, height));
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(toPxX(pts[i].x, width), toPxY(pts[i].y, height));
        }
        ctx.stroke();
      }

      // ---------- Ball position ----------
      const qb = offenseNow.find((p) => p.id === "QB")!;
      const center: Pt = { x: 0.5, y: losY }; // "snap point" center of LOS

      let ball: Pt = center;

      if (simT <= tSnap) {
        // snap to QB
        const u = simT / tSnap;
        ball = { x: center.x + (qb.x - center.x) * u, y: center.y + (qb.y - center.y) * u };
      } else if (simT < throwAt) {
        // held by QB
        ball = { x: qb.x, y: qb.y };
      } else {
        // throw
        const targetP = offenseNow.find((p) => p.id === target);
        if (targetP) {
          const start: Pt = { x: qb.x, y: qb.y };
          const end: Pt = { x: targetP.x, y: targetP.y };

          const d = dist(start, end);
          const tFlight = Math.max(0.25, Math.min(0.65, d * 0.9));
          const u = Math.min(1, (simT - throwAt) / tFlight);

          ball = { x: start.x + (end.x - start.x) * u, y: start.y + (end.y - start.y) * u };
        } else {
          ball = { x: qb.x, y: qb.y };
        }
      }

      // ---------- Draw offense players ----------
      for (const p of offenseNow) {
        const px = toPxX(p.x, width);
        const py = toPxY(p.y, height);

        // highlight target receiver once ball is thrown
        const isTarget = p.id === target;
        if (isTarget) {
          ctx.strokeStyle = "#f59e0b"; // amber ring
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(px, py, 20, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.fillStyle = "#111827";
        ctx.beginPath();
        ctx.arc(px, py, 16, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 12px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.id, px, py);
      }
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";

      // ---------- Draw defense ----------
      for (const d of defenseNow) {
        const px = toPxX(d.x, width);
        const py = toPxY(d.y, height);

        ctx.fillStyle = "#dc2626"; // red
        ctx.beginPath();
        ctx.arc(px, py, 16, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(d.id, px, py);
      }
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";

      // ---------- Draw ball (mini football) ----------
      const bx = toPxX(ball.x, width);
      const by = toPxY(ball.y, height);
      const rx = 10; // horizontal radius
      const ry = 6; // vertical radius

      // Body
      ctx.fillStyle = "#8b4513"; // brown leather
      ctx.beginPath();
      ctx.ellipse(bx, by, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();

      // Stitching
      ctx.strokeStyle = "#fefefe";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx - rx * 0.5, by);
      ctx.lineTo(bx + rx * 0.5, by);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(bx - rx * 0.2, by - ry * 0.5);
      ctx.lineTo(bx - rx * 0.2, by + ry * 0.5);
      ctx.moveTo(bx, by - ry * 0.6);
      ctx.lineTo(bx, by + ry * 0.6);
      ctx.moveTo(bx + rx * 0.2, by - ry * 0.5);
      ctx.lineTo(bx + rx * 0.2, by + ry * 0.5);
      ctx.stroke();
    };

    const loop = (ts: number) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;

      if (isPlaying) {
        simTimeRef.current += dt * speed;
        if (simTimeRef.current > tEnd) {
          simTimeRef.current = tEnd;
          onDone?.();
        }
      }

      drawFrame(simTimeRef.current, dt);
      rafRef.current = requestAnimationFrame(loop);
    };

    simTimeRef.current = 0;
    lastTsRef.current = null;
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
    };
  }, [width, height, offense, routes, defense, coverage, isPlaying, speed, target, tThrow, onResult, onDone]);

  return <canvas ref={canvasRef} />;
}
