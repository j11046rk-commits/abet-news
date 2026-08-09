import { NextResponse } from "next/server";

/** 死活確認用。認証もDBも通らない（ミドルウェアでも素通しにしてある）。 */
export async function GET() {
  return NextResponse.json({ ok: true });
}
