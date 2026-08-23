/*
 * LINEからの通知が本物かを確かめる部分を固定する。
 *
 *   node --test "src/lib/line-login.test.ts"
 *
 * ここが甘いと、誰でも「友だちになりました」「ブロックされました」を偽装できる。
 * 名簿が汚れると、送ってはいけない相手に送る事故につながる。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { LINE_USER_ID_RE, signatureMatches } from "./line-verify.ts";

/** 鍵を渡すだけの薄い包み（本番は line-login.ts が環境変数から渡す） */
const verifyLineSignature = (body: string, sig: string | null) =>
  signatureMatches(body, sig, process.env.LINE_CHANNEL_SECRET);

const SECRET = "test-channel-secret";
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("base64");

test("LINE_USER_ID_RE: 本物の形だけ通す", () => {
  assert.ok(LINE_USER_ID_RE.test("U" + "a1b2c3d4".repeat(4))); // U＋16進32文字
  assert.ok(!LINE_USER_ID_RE.test("U123")); // 短い
  assert.ok(!LINE_USER_ID_RE.test("x" + "a".repeat(32))); // Uで始まらない
  assert.ok(!LINE_USER_ID_RE.test("U" + "A".repeat(32))); // 大文字の16進は来ない
  assert.ok(!LINE_USER_ID_RE.test("U" + "z".repeat(32))); // 16進でない
  assert.ok(!LINE_USER_ID_RE.test("")); // 空
});

test("verifyLineSignature: 正しい署名は通る", async (t) => {
  process.env.LINE_CHANNEL_SECRET = SECRET;
  t.after(() => delete process.env.LINE_CHANNEL_SECRET);

  const body = JSON.stringify({ events: [{ type: "follow" }] });
  assert.equal(await verifyLineSignature(body, sign(body)), true);
});

test("verifyLineSignature: 本文を1文字でも変えたら通らない", async (t) => {
  process.env.LINE_CHANNEL_SECRET = SECRET;
  t.after(() => delete process.env.LINE_CHANNEL_SECRET);

  const body = JSON.stringify({ events: [{ type: "follow" }] });
  const sig = sign(body);
  assert.equal(await verifyLineSignature(body + " ", sig), false);
});

test("verifyLineSignature: 別の合言葉で作った署名は通らない", async (t) => {
  process.env.LINE_CHANNEL_SECRET = SECRET;
  t.after(() => delete process.env.LINE_CHANNEL_SECRET);

  const body = "{}";
  const other = createHmac("sha256", "someone-else").update(body).digest("base64");
  assert.equal(await verifyLineSignature(body, other), false);
});

test("verifyLineSignature: 署名が無ければ通らない", async (t) => {
  process.env.LINE_CHANNEL_SECRET = SECRET;
  t.after(() => delete process.env.LINE_CHANNEL_SECRET);

  assert.equal(await verifyLineSignature("{}", null), false);
  assert.equal(await verifyLineSignature("{}", ""), false);
});

test("verifyLineSignature: 合言葉が未設定なら、何を渡しても通らない", async () => {
  delete process.env.LINE_CHANNEL_SECRET;
  const body = "{}";
  // 設定漏れのまま「素通し」にすると、公開した瞬間に誰でも叩ける口になる
  assert.equal(await verifyLineSignature(body, sign(body)), false);
});

test("verifyLineSignature: 長さが違う署名でも落ちない", async (t) => {
  process.env.LINE_CHANNEL_SECRET = SECRET;
  t.after(() => delete process.env.LINE_CHANNEL_SECRET);

  assert.equal(await verifyLineSignature("{}", "short"), false);
  assert.equal(await verifyLineSignature("{}", "x".repeat(500)), false);
});
