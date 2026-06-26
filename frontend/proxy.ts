import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8007";

export function proxy(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [],
};

