export type RawMaterialCategory = "edible" | "non_edible";
export type RawMaterialSource = "manual" | "excel_import";
export interface RawMaterial { id:number; name:string; category:RawMaterialCategory; unitName:string; currentQuantity:number; reorderThreshold:number; isActive:boolean; }
export interface RawMaterialPurchase { id:number; materialName:string; category:RawMaterialCategory; quantity:number; unitName:string; supplierName:string; totalCostUgx:number; receivedDate:string; notes:string|null; source:RawMaterialSource; importBatchNumber:string|null; createdBy:string; createdAt:string; }
export interface RawMaterialsPageData { materials:RawMaterial[]; suppliers:Array<{id:number;name:string}>; purchases:RawMaterialPurchase[]; }
