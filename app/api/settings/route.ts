import { NextResponse } from "next/server";
import { getSettings, saveSettings, toPublicSettings } from "@/lib/settings";
import { jsonError } from "@/lib/http";
import type { Provider } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(toPublicSettings(getSettings()));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      provider?: Provider;
      apiKey?: string;
      baseUrl?: string;
      model?: string;
    };
    return NextResponse.json(
      saveSettings({
        provider: body.provider,
        apiKey: body.apiKey,
        baseUrl: body.baseUrl,
        model: body.model,
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
