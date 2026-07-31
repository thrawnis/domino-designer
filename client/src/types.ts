export interface User {
  id: string;
  username: string;
  createdAt: string;
}

export interface DominoColor {
  id: string;
  name: string;
  hex: string;
  quantity: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Design {
  id: string;
  name: string;
  gridWidth: number;
  gridHeight: number;
  createdAt: string;
  updatedAt: string;
}

export interface DominoPlacement {
  id: string;
  designId: string;
  colorId: string;
  color: DominoColor;
  x: number;
  y: number;
  rotation: number;
  zIndex: number;
}

export interface GridCell {
  x: number;
  y: number;
  colorId: string;
  hex: string;
}

export interface ImportGridResult {
  cells: GridCell[];
  ranOutOfInventory: boolean;
}

export interface AlgorithmInfo {
  id: string;
  label: string;
  description: string;
}
