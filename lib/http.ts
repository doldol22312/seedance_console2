import { NextResponse } from "next/server";
import { ArkError } from "@/lib/ark";

export function jsonError(error: unknown) {
  if (error instanceof ArkError) {
    return NextResponse.json({ error: error.message, details: error.body }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unexpected server error";
  return NextResponse.json({ error: message }, { status: 500 });
}
