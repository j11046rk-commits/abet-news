"use client";

import { useEffect, useState } from "react";

/**
 * LINEアプリの中で開かれたときに、「いま見ているお客様が誰か」を受け取る。
 *
 * ★ここで取れる名前とIDは、画面を親切にするためだけに使う。
 *   本人の証明に使うのは**IDトークン**（LINEが署名した身分証）だけで、
 *   それはサーバーがLINEに問い合わせて確かめる。
 *   ブラウザの中の値は誰にでも書き換えられるので、
 *   「userId が取れたから本人」とは絶対に扱わない。
 *
 * ★LIFFが使えなくても、予約は必ずできる。
 *   外のブラウザで開いた人、LINEを使っていない人、読み込みに失敗した人——
 *   どの場合も ready=false のまま、いままでどおり電話番号＋SMSの道を通る。
 *   ここで転んで予約フォームごと出なくなる、が一番やってはいけない形なので、
 *   失敗は全部 catch して黙って諦める。
 */

type LiffProfile = { userId?: string; displayName?: string };
type LiffSdk = {
  init: (c: { liffId: string }) => Promise<void>;
  isLoggedIn: () => boolean;
  login: (c?: { redirectUri?: string }) => void;
  getIDToken: () => string | null;
  getProfile: () => Promise<LiffProfile>;
  isInClient: () => boolean;
  getFriendship?: () => Promise<{ friendFlag?: boolean }>;
};

declare global {
  interface Window {
    liff?: LiffSdk;
  }
}

export type LiffState = {
  /** IDトークンまで取れて、LINEとして予約できる状態 */
  ready: boolean;
  /**
   * 公式アカウントの友だちか。分からなければ null。
   *
   * ★false のときは、控えもリマインドも**届かない**（LINEは友だちでない人に
   *   送信できない）。完了画面はこれを見て「お送りしました」と言わない。
   *   同意画面で友だち追加のチェックを外した人・チェックが出なかった人がここに落ちる。
   */
  friend: boolean | null;
  /** LINEに登録されたお名前（お名前欄の下書きに使う。お客様は直せる） */
  displayName: string | null;
  /** サーバーに渡す身分証 */
  idToken: string | null;
  /** LINEアプリの中で開かれているか（外のブラウザなら false） */
  inClient: boolean;
  /** 読み込みが終わったか（終わるまで導線を出さない） */
  settled: boolean;
};

const SDK_URL = "https://static.line-scdn.net/liff/edge/2/sdk.js";

function loadSdk(): Promise<LiffSdk | null> {
  return new Promise((resolve) => {
    if (window.liff) return resolve(window.liff);
    const el = document.createElement("script");
    el.src = SDK_URL;
    el.async = true;
    el.onload = () => resolve(window.liff ?? null);
    el.onerror = () => resolve(null);
    document.head.appendChild(el);
    // 読み込みが返ってこないときのために、待つ時間に上限を置く
    setTimeout(() => resolve(window.liff ?? null), 5000);
  });
}

export function useLiff(liffId: string | undefined): LiffState {
  const [state, setState] = useState<LiffState>({
    ready: false,
    friend: null,
    displayName: null,
    idToken: null,
    inClient: false,
    settled: false,
  });

  useEffect(() => {
    let alive = true;
    if (!liffId) {
      setState((s) => ({ ...s, settled: true }));
      return;
    }

    (async () => {
      try {
        const liff = await loadSdk();
        if (!liff || !alive) {
          if (alive) setState((s) => ({ ...s, settled: true }));
          return;
        }
        await liff.init({ liffId });
        const inClient = liff.isInClient();

        if (!liff.isLoggedIn()) {
          // 外のブラウザで開かれた場合。ここで勝手にLINEへ飛ばさない——
          // 電話番号で予約したいお客様を追い出すことになるので、
          // 「LINEで予約する」を押したときだけ飛ばす（下の startLogin）。
          if (alive)
            setState({ ready: false, friend: null, displayName: null, idToken: null, inClient, settled: true });
          return;
        }

        const idToken = liff.getIDToken();
        let displayName: string | null = null;
        try {
          displayName = (await liff.getProfile()).displayName ?? null;
        } catch {
          // 名前が取れなくても予約はできる
        }
        // 友だちかどうか。リンクされたボットが未設定だと取れない（→ null のまま）
        let friend: boolean | null = null;
        try {
          const f = await liff.getFriendship?.();
          if (typeof f?.friendFlag === "boolean") friend = f.friendFlag;
        } catch {
          // 分からないままでよい。予約は止めない
        }
        if (alive) {
          setState({ ready: !!idToken, friend, displayName, idToken: idToken ?? null, inClient, settled: true });
        }
      } catch (e) {
        console.error("liff_init_failed", e instanceof Error ? e.message : e);
        if (alive) setState((s) => ({ ...s, settled: true }));
      }
    })();

    return () => {
      alive = false;
    };
  }, [liffId]);

  return state;
}

/** 「LINEで予約する」を押されたとき。ここで初めてLINEのログイン画面へ送る */
export function startLineLogin(): void {
  try {
    window.liff?.login({ redirectUri: window.location.href });
  } catch (e) {
    console.error("liff_login_failed", e instanceof Error ? e.message : e);
  }
}
