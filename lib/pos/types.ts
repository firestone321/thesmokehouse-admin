export type PosTenderType = "cash" | "mobile_money" | "card";

export interface PosMenuItem {
  id: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  basePrice: number;
  categoryName: string;
  portionLabel: string | null;
  availableQuantity: number;
}
