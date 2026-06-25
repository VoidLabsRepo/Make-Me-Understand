import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8007";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const backendUrl = new URL(request.nextUrl.pathname, BACKEND_URL);
    backendUrl.search = request.nextUrl.search;
    return NextResponse.rewrite(backendUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
