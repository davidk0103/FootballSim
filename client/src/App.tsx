import { useEffect, useMemo, useRef, useState } from "react";
import CanvasField from "./components/CanvasField";
import type { Formation, Player } from "./types";
import "./App.css";

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
  const fieldRef = useRef<HTMLDivElement | null>(null);

  const offense = useMemo(() => offenseForFormation(formation), [formation]);

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

  return (
    <div className="app">
      <div className="field-shell" ref={fieldRef}>
        <CanvasField offense={offense} width={dimensions.width} height={dimensions.height} />
      </div>

      <div className="controls">
        <div className="control-stack">
          <label htmlFor="formation">Formation</label>
          <select
            id="formation"
            value={formation}
            onChange={(e) => setFormation(e.target.value as Formation)}
          >
            <option value="TRIPS_RIGHT">Trips Right</option>
            <option value="DOUBLES_2x2">Doubles 2x2</option>
            <option value="BUNCH_LEFT">Bunch Left</option>
          </select>
        </div>
        <span className="hint">Visualizer above; choose a formation to update it.</span>
      </div>
    </div>
  );
}
