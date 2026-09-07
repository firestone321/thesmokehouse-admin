import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { AdminAuthorizationError, requireApprovedAdminRole } from "@/lib/auth/admin-role";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireApprovedAdminRole();
    const workbook = await readFile(path.join(process.cwd(), "assets", "templates", "AUGUST EXPENDITURE FIRESTONE.xlsx"));
    return new NextResponse(new Uint8Array(workbook), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="AUGUST EXPENDITURE FIRESTONE.xlsx"',
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Raw-material template download failed.", error);
    return NextResponse.json({ message: "Unable to download the raw-material workbook template." }, { status: 500 });
  }
}
