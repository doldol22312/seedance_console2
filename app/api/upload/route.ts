import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { kindFromMime, saveUpload } from "@/lib/media";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose a file to load into the gate." }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = saveUpload(buffer, file.name);
    return NextResponse.json({
      ...saved,
      kind: kindFromMime(file.type || saved.mime, file.name),
    });
  } catch (error) {
    return jsonError(error);
  }
}
