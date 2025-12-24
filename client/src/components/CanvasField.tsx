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

function zoneHomeFor(
  id: string,
  coverage: Coverage,
  losY: number,
  nickelLeft: boolean,
  initial?: Player
): Pt {
  if (coverage === "COVER_2") {
    const map: Record<string, Pt> = {
      CB1: { x: 0.15, y: losY + 0.24 }, // flat
      CB2: { x: 0.85, y: losY + 0.24 },
      N: { x: nickelLeft ? 0.35 : 0.65, y: losY + 0.26 }, // curl/flat to slot side
      LB1: { x: 0.46, y: losY + 0.30 }, // hook
      LB2: { x: 0.54, y: losY + 0.30 },
      S1: { x: 0.32, y: losY + 0.52 }, // deep half
      S2: { x: 0.68, y: losY + 0.52 },
    };
    const baseY = map[id]?.y ?? losY + 0.28;
    const y = initial ? initial.y * 0.6 + baseY * 0.4 : baseY;
    return map[id] ? { x: map[id].x, y } : { x: 0.5, y };
  }
  if (coverage === "COVER_3") {
    const map: Record<string, Pt> = {
      CB1: { x: 0.16, y: losY + 0.52 }, // deep left third
      CB2: { x: 0.84, y: losY + 0.52 }, // deep right third
      S1: { x: 0.50, y: losY + 0.56 }, // deep middle third (FS)
      N: { x: nickelLeft ? 0.32 : 0.68, y: losY + 0.28 }, // curl/flat to passing strength
      S2: { x: nickelLeft ? 0.70 : 0.30, y: losY + 0.28 }, // curl/flat away from strength
      LB1: { x: 0.44, y: losY + 0.32 }, // hook/curl
      LB2: { x: 0.56, y: losY + 0.32 },
    };
    // Keep S2 opposite the nickel and on the weak side of the hooks
    const lb1x = map.LB1?.x ?? 0.44;
    const lb2x = map.LB2?.x ?? 0.56;
    if (map.S2) {
      if (nickelLeft) {
        // Nickel left => S2 weak/right; keep to the right of LB2
        map.S2.x = clamp01(Math.max(map.S2.x, lb2x + 0.10));
      } else {
        // Nickel right => S2 weak/left; keep to the left of LB1
        map.S2.x = clamp01(Math.min(map.S2.x, lb1x - 0.10));
      }
    }
    const baseY = map[id]?.y ?? losY + 0.3;
    const y = initial ? initial.y * 0.6 + baseY * 0.4 : baseY;
    return map[id] ? { x: map[id].x, y } : { x: 0.5, y };
  }
  if (coverage === "QUARTERS") {
    const map: Record<string, Pt> = {
      CB1: { x: 0.18, y: losY + 0.52 }, // deep quarter
      CB2: { x: 0.82, y: losY + 0.52 }, // deep quarter
      S1: { x: 0.38, y: losY + 0.56 }, // deep quarter
      S2: { x: 0.62, y: losY + 0.56 }, // deep quarter
      N: { x: nickelLeft ? 0.32 : 0.68, y: losY + 0.26 }, // flat/force to strength
      LB1: { x: 0.46, y: losY + 0.32 }, // hook/curl
      LB2: { x: 0.54, y: losY + 0.32 }, // hook/curl
    };
    const baseY = map[id]?.y ?? losY + 0.32;
    const y = initial ? initial.y * 0.6 + baseY * 0.4 : baseY;
    return map[id] ? { x: map[id].x, y } : { x: 0.5, y };
  }
  // default / Cover 1 man: shallow homes
  const map: Record<string, Pt> = {
    CB1: { x: 0.18, y: losY + 0.20 },
    CB2: { x: 0.82, y: losY + 0.20 },
    N: { x: nickelLeft ? 0.40 : 0.60, y: losY + 0.22 },
    LB1: { x: 0.46, y: losY + 0.24 },
    LB2: { x: 0.54, y: losY + 0.24 },
    S1: { x: 0.50, y: losY + 0.52 }, // deep middle FS
    S2: { x: 0.60, y: losY + 0.26 }, // down safety
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
  const isPlayingRef = useRef(isPlaying);
  const speedRef = useRef(speed);
  const onDoneRef = useRef(onDone);
  const onResultRef = useRef(onResult);
  const nickelLeftRef = useRef(false);
  const manLeverageRef = useRef<Record<string, number>>({});

  const offenseColor = useMemo(() => "#1f2937", []); // dark gray
  const alignedDefense = useMemo(() => alignDefense(defense, offense), [defense, offense]);

  useEffect(() => {
    // reset defense state when inputs change
    defenseStateRef.current = alignedDefense.map((d) => ({ ...d }));
    defenseInitialRef.current = defense.map((d) => ({ ...d }));
  }, [alignedDefense, defense]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    const wr2 = offense.find((p) => p.id === "WR2");
    nickelLeftRef.current = !!(wr2 && wr2.x < 0.5);
    manLeverageRef.current = {}; // reset leverage memory when offense changes
  }, [offense]);

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
      const receiverDir: Record<string, Pt> = {};
      const allowMotion = isPlayingRef.current;

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
        const future = positionAlongPolyline(absPts, wrSpeed * Math.max(simT + 0.10, simT)); // peek ahead
        receiverDir[ra.receiverId] = {
          x: future.x - pos.x,
          y: future.y - pos.y,
        };

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
      if (allowMotion) {
        const speedPerSecond: Record<string, number> = {
          CB1: 0.26,
          CB2: 0.26,
          N: 0.26,
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
        if (coverage === "COVER_1") {
          const lb1 = defenseNow.find((d) => d.id === "LB1");
          const lb2 = defenseNow.find((d) => d.id === "LB2");
          const te = offenseNow.find((p) => p.id === "TE");
          const rb = offenseNow.find((p) => p.id === "RB");
          const distTo = (a?: Player, b?: Player) => (a && b ? dist({ x: a.x, y: a.y }, { x: b.x, y: b.y }) : Infinity);
          if (lb1 && lb2 && te && rb) {
            const combo1 = distTo(lb1, te) + distTo(lb2, rb);
            const combo2 = distTo(lb1, rb) + distTo(lb2, te);
            if (combo2 < combo1) {
              assign.LB1 = "RB";
              assign.LB2 = "TE";
            } else {
              assign.LB1 = "TE";
              assign.LB2 = "RB";
            }
          } else if (te && (lb1 || lb2)) {
            if (distTo(lb1, te) <= distTo(lb2, te)) {
              assign.LB1 = "TE";
              assign.LB2 = undefined;
            } else {
              assign.LB1 = undefined;
              assign.LB2 = "TE";
            }
          } else if (rb && (lb1 || lb2)) {
            if (distTo(lb1, rb) <= distTo(lb2, rb)) {
              assign.LB1 = "RB";
              assign.LB2 = undefined;
            } else {
              assign.LB1 = undefined;
              assign.LB2 = "RB";
            }
          }
        }

        // clamp frame delta to avoid big jumps if tab was inactive
        const frameDt = Math.min(dt || 0.016, 0.05); // seconds
        const reactionDelay = 0.2;

        for (let i = 0; i < defenseNow.length; i++) {
          const d = defenseNow[i];
          const cur: Pt = { x: d.x, y: d.y };
          const isCorner = d.id === "CB1" || d.id === "CB2";
          const maxDxCorner = 0.0035; // limit lateral slide per frame for corners
          const initial = defenseInitialRef.current.find((p) => p.id === d.id);

          if (simT < reactionDelay) continue;

          if (coverage === "COVER_1") {
            const rid = assign[d.id];
            if (rid) {
              const wr = offenseNow.find((p) => p.id === rid);
              if (!wr) continue;
              const speed = speedPerSecond[d.id] ?? baseSpeed;
              const step = speed * frameDt * (d.id === "N" ? 0.78 : 0.82); // nickel trails slightly but with CB speed
              const prevLev = manLeverageRef.current[rid] ?? 0;
              // default leverage: outside for corners/LBs, inside for nickel (align to inside shoulder)
              let desiredLev = wr.x < 0.5 ? -0.02 : 0.02;
              if (d.id === "N") {
                const inside = wr.x < 0.5 ? 0.025 : -0.025; // inside shade
                const dir = receiverDir[rid] ?? { x: 0, y: 0 };
                const threshold = 0.0025;
                if (dir.x < -threshold) desiredLev = inside; // WR breaking left -> stay to his right/inside
                else if (dir.x > threshold) desiredLev = -inside; // WR breaking right -> stay to his left/inside
                else desiredLev = inside;
              }
              const leverageOffset = prevLev * 0.6 + desiredLev * 0.4; // smooth to avoid twitch, but react quicker
              manLeverageRef.current[rid] = leverageOffset;
              const targetX = Math.max(0, Math.min(1, wr.x + leverageOffset));
              const desired = { x: targetX, y: wr.y };
              // lag pursuit to avoid beating the break
              const mix = d.id === "N" ? 0.55 : 0.65;
              const lagged = {
                x: cur.x * (1 - mix) + desired.x * mix,
                y: cur.y * (1 - mix) + desired.y * mix,
              };
              // do not overrun vertically past the receiver
              const leadLimitY = wr.y + 0.01;
              if (lagged.y > leadLimitY) lagged.y = leadLimitY;
              const nxt = moveToward(cur, lagged, step);
              // keep corners from snapping inside too hard
              if (isCorner) {
                defenseNow[i].x = Math.max(cur.x - maxDxCorner, Math.min(cur.x + maxDxCorner, nxt.x));
                defenseNow[i].y = nxt.y;
              } else {
                defenseNow[i].x = nxt.x;
                defenseNow[i].y = nxt.y;
              }
            } else if (d.id === "S1" || d.id === "S2") {
              // free players: drop/robber toward their cover 1 landmarks and threats
              const home = zoneHomeFor(d.id, "COVER_1", losY, nickelLeftRef.current, initial);
              const speed = speedPerSecond[d.id] ?? baseSpeed;
              const step = speed * frameDt;
              let targetPt = home;
              if (d.id === "S2") {
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
                targetPt = {
                  x: home.x * 0.7 + threat.x * 0.3,
                  y: home.y * 0.7 + threat.y * 0.3,
                };
              }
              const nxt = moveToward(cur, targetPt, step);
              defenseNow[i].x = nxt.x;
              defenseNow[i].y = nxt.y;
            }
          } else {
            // zone: base home from coverage landmarks blended with initial depth
            let home = zoneHomeFor(d.id, coverage, losY, nickelLeftRef.current, initial);
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

      if (isPlayingRef.current) {
        simTimeRef.current += dt * speedRef.current;
        if (simTimeRef.current > tEnd) {
          simTimeRef.current = tEnd;
          onDoneRef.current?.();
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
  }, [width, height, offense, routes, defense, coverage, target, tThrow]);

  return <canvas ref={canvasRef} />;
}
