import fs from "node:fs";
import path from "node:path";
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
      outputsDir?: string;
    };

    if (body.outputsDir !== undefined && body.outputsDir.trim()) {
      const dir = path.resolve(body.outputsDir.trim());
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.accessSync(dir, fs.constants.W_OK);
      } catch {
        return NextResponse.json(
          { error: `Cannot use "${body.outputsDir.trim()}" as the save folder — check the path and permissions.` },
          { status: 400 },
        );
      }
    }

    return NextResponse.json(
      saveSettings({
        provider: body.provider,
        apiKey: body.apiKey,
        baseUrl: body.baseUrl,
        model: body.model,
        outputsDir: body.outputsDir,
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
