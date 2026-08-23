import { requireProfile } from "@/lib/auth";
import FloorBoard from "@/components/FloorBoard";
import { getBoardSnapshot } from "./actions";

/**
 * 席ボード（レジ横のタブレットに出しっぱなしにする画面）。
 * 飛び込みのお客様が座ったらワンタップ。ネット予約の空席判定がリアルタイムで正確になる。
 * 新しいネット予約が入ると、音つきの大きなお知らせが出る（タップで確認）。
 */
export default async function BoardPage() {
  await requireProfile();
  const snapshot = await getBoardSnapshot();
  return <FloorBoard initial={snapshot} />;
}
