import { useEffect, useMemo, useRef, useState } from "react";
import CanvasField from "./components/CanvasField";
import "./App.css";
import type { Formation, Player, RouteAssignment, RouteType, OffensePosition, Coverage } from "./types";


const ROUTES: RouteType[] = [
  "HITCH", "SLANT", "OUT", "CORNER", "POST", "GO", "DIG", "CURL", "FLAT", "STICK",
];

type TargetPosition = Exclude<OffensePosition, "QB">;

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function jitter(x: number, amt = 0.03) {
  return Math.max(0, Math.min(1, x + rand(-amt, amt)));
}

function getO(offense: Player[], id: OffensePosition | string) {
  return offense.find((p) => p.team === "O" && p.id === id);
}

function eligible(offense: Player[]) {
  return offense.filter((p) => p.team === "O" && p.id !== "QB");
}

function strongSide(offense: Player[]) {
  const left = eligible(offense).filter((p) => p.x < 0.5).length;
  const right = eligible(offense).filter((p) => p.x >= 0.5).length;
  return right >= left ? "RIGHT" : "LEFT";
}

function findSlotLike(offense: Player[]) {
  const wr2 = getO(offense, "WR2");
  if (wr2) return wr2;

  const side = strongSide(offense);
  const candidates = eligible(offense).filter((p) => (side === "RIGHT" ? p.x >= 0.5 : p.x < 0.5));

  let best = candidates[0];
  let bestDist = best ? Math.abs(best.x - 0.5) : 999;
  for (const p of candidates) {
    const d = Math.abs(p.x - 0.5);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best ?? wr2 ?? getO(offense, "TE") ?? getO(offense, "WR1")!;
}

function findTE(offense: Player[]) {
  return getO(offense, "TE");
}

function generateDefense(cov: Coverage, offense: Player[]): Player[] {
  const losY = 0.2;

  const X = getO(offense, "WR1");
  const Z = getO(offense, "WR3");
  const slot = findSlotLike(offense);
  const te = findTE(offense);
  const rb = getO(offense, "RB");

  const cb1x = X ? X.x : 0.16;
  const cb2x = Z ? Z.x : 0.84;
  const nickelX = slot ? slot.x * 0.85 + 0.5 * 0.15 : 0.62;
  const lbToTeX = te ? te.x : 0.52;
  const lbToRbX = rb ? rb.x * 0.7 + 0.5 * 0.3 : 0.48;
  const strong = strongSide(offense);

  const cornerY = losY + rand(0.04, 0.15);
  const lbY = losY + rand(0.11, 0.16);
  const safetyY = losY + rand(0.34, 0.42);

  const base: Player[] = [
    { id: "CB1", team: "D", x: jitter(cb1x, 0.02), y: jitter(cornerY, 0.01) },
    { id: "CB2", team: "D", x: jitter(cb2x, 0.02), y: jitter(cornerY, 0.01) },
    { id: "N", team: "D", x: jitter(nickelX, 0.02), y: jitter(cornerY + 0.02, 0.01) },
    { id: "LB1", team: "D", x: jitter(lbToTeX, 0.03), y: jitter(lbY, 0.02) },
    { id: "LB2", team: "D", x: jitter(lbToRbX, 0.03), y: jitter(lbY, 0.02) },
    { id: "S1", team: "D", x: 0.40, y: safetyY },
    { id: "S2", team: "D", x: 0.60, y: safetyY },
  ];

  const S1 = base.find((p) => p.id === "S1")!;
  const S2 = base.find((p) => p.id === "S2")!;

  if (cov === "COVER_1") {
    S1.x = 0.50; S1.y = losY + 0.42;
    S2.x = jitter(0.55, 0.05); S2.y = losY + 0.18;
  } else if (cov === "COVER_2") {
    S1.x = 0.35; S1.y = losY + 0.40;
    S2.x = 0.65; S2.y = losY + 0.40;
  } else if (cov === "COVER_3") {
    S1.x = 0.50; S1.y = losY + 0.42;
    S2.x = strong === "RIGHT" ? jitter(0.30, 0.04) : jitter(0.70, 0.04);
    S2.y = losY + 0.20;
  } else if (cov === "QUARTERS") {
    S1.x = 0.32; S1.y = losY + 0.38;
    S2.x = 0.68; S2.y = losY + 0.38;
  }

  const lb1 = base.find((p) => p.id === "LB1");
  const lb2 = base.find((p) => p.id === "LB2");
  if (lb1 && lb2 && lb2.x <= lb1.x) {
    // keep LB2 aligned to the right of LB1 with a small buffer
    const mid = (lb1.x + lb2.x) / 2;
    lb1.x = Math.max(0, mid - 0.025);
    lb2.x = Math.min(1, mid + 0.025);
  }

  return base.map((d) => ({ ...d, x: jitter(d.x, 0.01), y: jitter(d.y, 0.01) }));
}

function defaultRoutesForFormation(): RouteAssignment[] {
  // MVP defaults; you can tweak anytime
  return [
    { receiverId: "WR1", route: "GO" },
    { receiverId: "WR2", route: "OUT" },
    { receiverId: "WR3", route: "POST" },
    { receiverId: "TE", route: "HITCH" },
    { receiverId: "RB", route: "FLAT" },
  ];
}

function eligibleReceivers(offense: Player[]): OffensePosition[] {
  return offense
    .map((p) => p.id)
    .filter((id): id is OffensePosition => id !== "QB");
}


function offenseForFormation(f: Formation): Player[] {
  // normalized coords in [0,1]
  // LOS at y=0.2
  switch (f) {
    case "TRIPS_RIGHT":
      return [
        { id: "QB", team: "O", x: 0.5, y: 0.12 },
        { id: "WR1", team: "O", x: 0.14, y: 0.2 },
        { id: "WR2", team: "O", x: 0.68, y: 0.2 },
        { id: "WR3", team: "O", x: 0.88, y: 0.2 },
        { id: "TE", team: "O", x: 0.60, y: 0.2 },
        { id: "RB", team: "O", x: 0.44, y: 0.12 },
      ];
    case "DOUBLES_2x2":
      return [
        { id: "QB", team: "O", x: 0.5, y: 0.12 },
        { id: "WR1", team: "O", x: 0.14, y: 0.2 },
        { id: "WR2", team: "O", x: 0.32, y: 0.2 },
        { id: "WR3", team: "O", x: 0.86, y: 0.2 },
        { id: "TE", team: "O", x: 0.68, y: 0.2 },
        { id: "RB", team: "O", x: 0.44, y: 0.12 },
      ];
    case "BUNCH_LEFT":
      return [
        { id: "QB", team: "O", x: 0.5, y: 0.12 },
        { id: "WR1", team: "O", x: 0.18, y: 0.18 },
        { id: "WR2", team: "O", x: 0.22, y: 0.2 },
        { id: "TE", team: "O", x: 0.26, y: 0.18 },
        { id: "WR3", team: "O", x: 0.86, y: 0.2 },
        { id: "RB", team: "O", x: 0.44, y: 0.12 },
      ];
    default:
      return [];
  }
}

export default function App() {
  const [formation, setFormation] = useState<Formation>("TRIPS_RIGHT");
  const [dimensions, setDimensions] = useState({ width: 900, height: 520 });
  const [routes, setRoutes] = useState<RouteAssignment[]>(defaultRoutesForFormation());
  const [canvasKey, setCanvasKey] = useState(0);
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [target, setTarget] = useState<TargetPosition>("WR3");
  const [coverage, setCoverage] = useState<Coverage>("COVER_2");
  const [defense, setDefense] = useState<Player[]>([]);
  const [playResult, setPlayResult] = useState<string | null>(null);
  const playFinishedRef = useRef(false);


  const offense = useMemo(() => offenseForFormation(formation), [formation]);

  useEffect(() => {
    if (isPlaying) playFinishedRef.current = false;
  }, [isPlaying]);

  // 1) resize observer
  useEffect(() => {
    const node = fieldRef.current;
    if (!node) return;

    const updateSize = () => {
      const w = node.clientWidth;
      const h = node.clientHeight;
      setDimensions({
        width: Math.max(360, w),
        height: Math.max(360, h),
      });
    };

    updateSize();

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(node);
    window.addEventListener("resize", updateSize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  // 2) regenerate defense when formation/coverage changes (offense derived from formation)
  useEffect(() => {
    setDefense(generateDefense(coverage, offense));
    setPlayResult(null);
  }, [coverage, offense]);

  return (
    <div className="app">
      <div className="field-shell" ref={fieldRef}>
        <CanvasField
          key={canvasKey}
          offense={offense}
          routes={routes}
          defense={defense}
          coverage={coverage}
          width={dimensions.width}
          height={dimensions.height}
          isPlaying={isPlaying}
          speed={speed}
          target={target}
          onDone={() => {
            if (playFinishedRef.current) return;
            playFinishedRef.current = true;
            setIsPlaying(false);
            setCanvasKey((k) => k + 1); // force remount to reset defense
          }}
          onResult={(r) => setPlayResult(r)}
        />
      </div>

      <div className="controls">
        <div className="control-card">
          <div className="card-top">
            <div>
              <div className="eyebrow">Play setup</div>
              <div className="card-title">Route Lab</div>
            </div>
            <span className="badge">{coverage.replace("_", " ")}</span>
          </div>
          <div className="setup-grid">
            <label className="control-field">
              <span>Formation</span>
              <select
                value={formation}
                onChange={(e) => setFormation(e.target.value as Formation)}
              >
                <option value="TRIPS_RIGHT">Trips Right</option>
                <option value="DOUBLES_2x2">Doubles 2x2</option>
                <option value="BUNCH_LEFT">Bunch Left</option>
              </select>
            </label>

            <label className="control-field">
              <span>Target</span>
              <select value={target} onChange={(e) => setTarget(e.target.value as TargetPosition)}>
                <option value="WR1">WR1</option>
                <option value="WR2">WR2</option>
                <option value="WR3">WR3</option>
                <option value="TE">TE</option>
                <option value="RB">RB</option>
              </select>
            </label>
          </div>

          <div className="pill-row">
            <span className="pill-label">Coverage</span>
            <div className="pill-group">
              {["COVER_1", "COVER_2", "COVER_3", "QUARTERS"].map((cov) => (
                <button
                  key={cov}
                  className={`pill ${coverage === cov ? "active" : ""}`}
                  onClick={() => setCoverage(cov as Coverage)}
                  type="button"
                >
                  {cov.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>

          <div className="pill-row">
            <span className="pill-label">Speed</span>
            <div className="pill-group">
              {[0.5, 1, 2].map((s) => (
                <button
                  key={s}
                  className={`pill ${speed === s ? "active" : ""}`}
                  onClick={() => setSpeed(s)}
                  type="button"
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="control-card routes-card">
          <div className="card-top">
            <div>
              <div className="eyebrow">Routes</div>
              <div className="card-title">Assignments</div>
            </div>
            <button
              className="ghost-button"
              onClick={() => {
                setDefense(generateDefense(coverage, offense));
                setPlayResult(null);
              }}
              type="button"
            >
              New Defense
            </button>
          </div>
          <div className="routes-grid">
            {eligibleReceivers(offense).map((rid) => {
              const current = routes.find((r) => r.receiverId === rid)?.route ?? "HITCH";

              return (
                <label key={rid} className="route-row">
                  <span className="route-chip">{rid}</span>
                  <select
                    value={current}
                    onChange={(e) => {
                      const next = e.target.value as RouteType;
                      setRoutes((prev) => {
                        const copy = [...prev];
                        const idx = copy.findIndex((r) => r.receiverId === rid);
                        if (idx >= 0) copy[idx] = { receiverId: rid, route: next };
                        else copy.push({ receiverId: rid, route: next });
                        return copy;
                      });
                    }}
                  >
                    {ROUTES.map((rt) => (
                      <option key={rt} value={rt}>
                        {rt}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </div>

        <div className="control-card actions-card">
          <div className="button-row">
            <button className="cta" onClick={() => setIsPlaying((p) => !p)} type="button">
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              className="secondary"
              onClick={() => {
                setIsPlaying(false);
                setCanvasKey((k) => k + 1); // force remount to reset
              }}
              type="button"
            >
              Reset
            </button>
          </div>
          <div className="meta-row">
            <span className="hint">Pick a formation, tweak routes, then hit Play.</span>
            {playResult && <span className="result">Result: {playResult}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
