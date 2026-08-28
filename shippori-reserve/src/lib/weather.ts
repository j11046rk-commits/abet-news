/**
 * 日毎の天気。晴・曇・雨の3区分（店主指定 2026-08-28——細かい区分は要らない、
 * 知りたいのは「天気と売り上げに相関があるか」）。
 *
 * 出どころは気象庁の新居浜アメダスの日別値。区分への読み替え（雨が最優先、
 * 残りは日照時間で晴と曇）は Mac の日次取り込み側で済ませて送ってくる。
 * 実測だけを入れる——予報は入れない（過ぎた日にだけマークが付く）。
 */

export type WeatherKind = "sunny" | "cloudy" | "rainy";

export type WeatherRow = {
  biz_date: string;
  weather: WeatherKind;
  precip_mm: number | null;
  temp_max_c: number | null;
  temp_min_c: number | null;
};

export const WEATHER_KINDS: WeatherKind[] = ["sunny", "cloudy", "rainy"];

/** ☂️は☔より小さい画面で潰れにくい（傘だけ） */
export const WEATHER_ICON: Record<WeatherKind, string> = {
  sunny: "☀️",
  cloudy: "☁️",
  rainy: "☂️",
};

export const WEATHER_JA: Record<WeatherKind, string> = {
  sunny: "晴れ",
  cloudy: "曇り",
  rainy: "雨",
};
