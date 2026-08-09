/**
 * スタッフの名前チップ。
 *
 * 既存アプリ（店で使っているカレンダー）は人ごとに色がついていて、
 * シフトも受付者も「色と名前」で一瞬で見分けられる。それを引き継ぐ。
 * 色はスタッフ一覧の並び順から機械的に割り当てる（マスタに色を持たせない）。
 */

/** 並び順 index → 色相。40度ずつずらすと9人でも隣が紛れない。 */
export const staffHue = (index: number): number => (index * 40 + 15) % 360;

/** チップに載せる短い名前。「安藤 正」→「安藤」 */
export const surname = (name: string): string => name.split(/[\s　]/)[0];

/** 濃紺の地の上で読める、控えめな色チップ */
export const chipColors = (index: number) => {
  const h = staffHue(index);
  return {
    background: `hsl(${h} 38% 26%)`,
    borderColor: `hsl(${h} 42% 44%)`,
    color: "#eef1f8",
  };
};
