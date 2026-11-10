/*
 * アカウント管理の範囲（店主指示 2026-11-10「アカウント管理、店長からもできるように」）。
 *
 * オーナー：全員を管理できる。
 * 店長　　：スタッフ・事務・閲覧のみ のアカウントだけ（発行・名前・ロール・停止/再開・パスワード再発行）。
 *           オーナー・店長のアカウントには触れず、誰かをオーナー・店長にすることもできない
 *           （店長が自分や他人をオーナーに上げて、給与など全部を見られるようになるのを防ぐ）。
 *
 * 同じ決まりを DB の trigger（0079）でも守る。API はサービスロールで書くので、ここで先に止める。
 * このファイルは値の import を持たない（node --test で直に回すため）。
 */
import type { UserRole } from "./types";

export const ALL_ROLES: UserRole[] = ["owner", "manager", "staff", "jimu", "viewer"];
/** 店長が扱えるロール */
export const MANAGER_SCOPE: UserRole[] = ["staff", "jimu", "viewer"];

/** actor が、いま role のアカウントに手を入れてよいか */
export function canManage(actor: UserRole, target: UserRole): boolean {
  if (actor === "owner") return true;
  if (actor === "manager") return MANAGER_SCOPE.includes(target);
  return false;
}

/** actor が付けられるロール（発行・変更の選択肢） */
export function assignableRoles(actor: UserRole): UserRole[] {
  if (actor === "owner") return ALL_ROLES;
  if (actor === "manager") return MANAGER_SCOPE;
  return [];
}
