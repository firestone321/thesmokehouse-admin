import { z } from "zod";
import {
  inventoryItemTypes,
  movementTypes,
  orderStatuses,
  prepTypes,
  supplierTypes
} from "@/lib/ops/types";

const maxTextLength = 1_000;
const maxLongTextLength = 1_000;
const maxShortTextLength = 120;
const maxCodeLength = 80;
const maxUrlLength = 2_000;
const maxReferenceLength = 300;
const maxNumericValue = 999_999_999;
const maxSearchLength = 100;
const maxStatusLength = 40;

function blankToNull(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return value;
}

function blankToUndefined(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  return value;
}

function parseBoolean(value: unknown) {
  return value === true || value === "true" || value === "on" || value === "1" || value === 1;
}

function nullableText(maxLength = maxTextLength) {
  return z.preprocess(blankToNull, z.string().trim().max(maxLength).nullable()).default(null);
}

function optionalText(maxLength = maxTextLength) {
  return z.preprocess(blankToUndefined, z.string().trim().max(maxLength).optional()).optional();
}

function nullableNumber(min: number, max: number) {
  return z.preprocess(blankToNull, z.coerce.number().min(min).max(max).nullable()).default(null);
}

function optionalNumber(min: number, max: number) {
  return z.preprocess(blankToUndefined, z.coerce.number().min(min).max(max).optional()).optional();
}

export const idSchema = z.coerce.number().int().positive();

export const optionalIdSchema = z.preprocess(blankToNull, idSchema.nullable()).default(null);

export const shortTextSchema = z.string().trim().min(1).max(maxShortTextLength);

export const longTextSchema = nullableText(maxLongTextLength);

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const moneySchema = z.coerce.number().min(0).max(maxNumericValue);

export const quantitySchema = z.coerce.number().min(0).max(maxNumericValue);

export const signedQuantitySchema = z.coerce.number().min(-maxNumericValue).max(maxNumericValue);

const safeReturnPath = z
  .string()
  .trim()
  .max(maxReferenceLength)
  .refine((value) => value.startsWith("/") && !value.startsWith("//") && !value.includes(":"), {
    message: "Invalid return path."
  });

export const returnToSchema = z.preprocess(blankToUndefined, safeReturnPath.default("/orders")).default("/orders");

export const optionalReturnToSchema = z.preprocess(blankToUndefined, safeReturnPath.optional()).optional();

export const checkboxSchema = z.preprocess(parseBoolean, z.boolean());

export const adminPaidOrderPushProcessSchema = z.object({
  orderId: idSchema
});

export const createStaffUserActionSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    role: z.enum(["staff", "chef"]).default("staff"),
    password: z.string().min(12).max(128),
    confirm_password: z.string().min(12).max(128)
  })
  .refine((value) => value.password === value.confirm_password, {
    path: ["confirm_password"],
    message: "Passwords do not match."
  });

export const manageStaffAccountActionSchema = z.object({
  user_id: z.string().uuid(),
  operation: z.enum(["disable", "enable", "set_role"]),
  target_role: z.enum(["staff", "chef", "manager"]).optional()
}).superRefine((value, ctx) => {
  if (value.operation === "set_role" && !value.target_role) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["target_role"],
      message: "Choose the new role."
    });
  }
});

const allowedPushHostSuffixes = [
  "fcm.googleapis.com",
  ".push.services.mozilla.com",
  ".push.apple.com",
  ".push.services.microsoft.com",
  ".windows.com",
  ".notify.windows.com"
];

function isAllowedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return allowedPushHostSuffixes.some((suffix) =>
      suffix.startsWith(".") ? host.endsWith(suffix) : host === suffix
    );
  } catch {
    return false;
  }
}

export const adminPushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .trim()
    .url()
    .max(maxUrlLength)
    .refine(isAllowedPushEndpoint, { message: "Push endpoint host not allowed." }),
  expirationTime: z.number().int().nullable().optional(),
  keys: z.object({
    p256dh: z.string().trim().min(1).max(maxTextLength),
    auth: z.string().trim().min(1).max(maxTextLength)
  })
});

export const adminOrdersQuerySchema = z.object({
  status: optionalText(maxStatusLength),
  search: optionalText(maxSearchLength),
  limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(30).default(30)).default(30),
  page: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).default(1)).default(1)
});

export const orderRouteParamsSchema = z.object({
  orderId: idSchema
});

export const queueActionSchema = z.object({
  return_to: returnToSchema
});

export const menuCategoryActionSchema = z.object({
  name: shortTextSchema,
  sort_order: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(999).default(1)).default(1)
});

export const menuItemActionSchema = z.object({
  menu_item_id: optionalIdSchema,
  name: shortTextSchema,
  description: longTextSchema,
  base_price: moneySchema,
  prep_type: z.enum(prepTypes),
  menu_category_id: idSchema,
  portion_type_id: idSchema,
  sort_order: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(999).default(1)).default(1),
  is_active: checkboxSchema,
  is_available_today: checkboxSchema
});

export const menuItemImageActionSchema = z.object({
  menu_item_id: idSchema
});

export const menuItemComponentActionSchema = z.object({
  menu_item_id: idSchema,
  inventory_item_id: idSchema,
  quantity_required: quantitySchema
});

export const removeMenuItemComponentActionSchema = z.object({
  component_id: idSchema,
  menu_item_id: idSchema
});

export const toggleMenuItemFlagActionSchema = z.object({
  menu_item_id: idSchema,
  next_value: checkboxSchema
});

export const inventoryItemActionSchema = z.object({
  inventory_item_id: optionalIdSchema,
  code: optionalText(maxCodeLength),
  name: shortTextSchema,
  unit_name: shortTextSchema,
  reorder_threshold: quantitySchema.default(0),
  initial_quantity: signedQuantitySchema.default(0),
  item_type: z.enum(inventoryItemTypes).default("supply"),
  is_active: checkboxSchema
});

export const inventoryAdjustmentActionSchema = z.object({
  inventory_item_id: idSchema,
  quantity_delta: signedQuantitySchema,
  movement_type: z.enum(movementTypes),
  note: longTextSchema
});

export const proteinProcurementActionSchema = z.object({
  supplier_id: idSchema,
  protein_intake_item_id: idSchema,
  delivery_date: dateSchema,
  butchered_on: dateSchema,
  abattoir_name: shortTextSchema,
  vet_stamp_number: shortTextSchema,
  inspection_officer_name: shortTextSchema,
  quantity_received: quantitySchema,
  unit_name: shortTextSchema,
  unit_cost: nullableNumber(0, maxNumericValue),
  note: longTextSchema,
  allocated_to_halves: quantitySchema.default(0),
  allocated_to_quarters: quantitySchema.default(0)
});

export const proteinIntakeItemActionSchema = z.object({
  name: shortTextSchema,
  default_unit_name: shortTextSchema,
  protein_id: idSchema,
  portion_type_id: idSchema
});

export const supplyProcurementActionSchema = z.object({
  inventory_item_id: idSchema,
  return_to: optionalReturnToSchema,
  supplier_id: optionalIdSchema,
  supplier_name: longTextSchema,
  delivery_date: dateSchema,
  quantity_received: quantitySchema,
  unit_cost: nullableNumber(0, maxNumericValue),
  note: longTextSchema
});

export const ingredientProcurementActionSchema = z.object({
  inventory_item_id: idSchema,
  supplier_id: optionalIdSchema,
  supplier_name: longTextSchema,
  delivery_date: dateSchema,
  quantity_received: quantitySchema,
  unit_cost: nullableNumber(0, maxNumericValue),
  note: longTextSchema
});

export const supplierActionSchema = z.object({
  supplier_id: optionalIdSchema,
  name: shortTextSchema,
  phone_number: longTextSchema,
  license_number: longTextSchema,
  supplier_type: z.enum(supplierTypes),
  default_abattoir_name: longTextSchema,
  is_active: checkboxSchema,
  notes: longTextSchema
});

export const portionTypeActionSchema = z.object({
  name: shortTextSchema,
  quantity: z.coerce.number().int().min(1).max(maxNumericValue),
  unit: z.enum(["g", "ml"])
});

export const processProcurementReceiptToFinishedStockActionSchema = z.object({
  procurement_receipt_id: idSchema,
  birds_allocated_to_halves: z.coerce.number().int().min(0).max(maxNumericValue).default(0),
  birds_allocated_to_quarters: z.coerce.number().int().min(0).max(maxNumericValue).default(0),
  portion_type_id: optionalIdSchema,
  quantity_produced: z.preprocess(blankToNull, z.coerce.number().int().min(0).max(maxNumericValue).nullable()).default(null),
  post_roast_packed_weight_kg: nullableNumber(0, maxNumericValue),
  note: longTextSchema
});

export const updateOrderStatusActionSchema = z.object({
  order_id: idSchema,
  next_status: z.enum(orderStatuses),
  note: optionalText(maxLongTextLength)
});

export const completeOrderWithPickupCodeActionSchema = z.object({
  order_id: idSchema,
  pickup_code: z.string().trim().regex(/^\d{4}$/)
});

export const reverifyOrderPaymentActionSchema = z.object({
  order_id: idSchema
});

export const addOrderNoteActionSchema = z.object({
  order_id: idSchema,
  note: z.string().trim().min(1).max(maxLongTextLength)
});

export const analyticsMetricSchema = z.enum(["revenue", "orders"]);

export const analyticsTimeframeSchema = z.enum(["today", "7d", "30d", "180d", "12m", "custom"]);

export const adminAnalyticsQuerySchema = z
  .object({
    metric: analyticsMetricSchema,
    timeframe: analyticsTimeframeSchema,
    from: z.preprocess(blankToUndefined, dateSchema.optional()).optional(),
    to: z.preprocess(blankToUndefined, dateSchema.optional()).optional()
  })
  .superRefine((value, ctx) => {
    if (value.timeframe === "custom" && (!value.from || !value.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["from"],
        message: "Custom analytics ranges require both from and to dates."
      });
    }

    if (value.from && value.to && value.from > value.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "The analytics range must start on or before the end date."
      });
    }
  });
