export type OffensePosition = "QB" | "WR1" | "WR2" | "WR3" | "TE" | "RB";
export type DefensePosition = "CB1" | "CB2" | "S1" | "S2" | "N" | "LB1" | "LB2";

export type Team = "O" | "D";

export interface Player {
  id: OffensePosition | DefensePosition;
  team: Team;
  x: number; 
  y: number; 
}

export type Formation = "TRIPS_RIGHT" | "DOUBLES_2x2" | "BUNCH_LEFT";

export type RouteType =
  | "HITCH"
  | "SLANT"
  | "OUT"
  | "CORNER"
  | "POST"
  | "GO"
  | "DIG"
  | "CURL"
  | "FLAT"
  | "STICK";

export interface RouteAssignment {
  receiverId: OffensePosition;
  route: RouteType;
}

export interface Play {
  formation: Formation;
  offense: Player[];
  routes: RouteAssignment[];
}
