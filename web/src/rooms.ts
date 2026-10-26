// rooms.ts — RoomId source of truth + display labels + legend order.
//
// The 3D scene geometry lives in officeLayout.ts (data-driven, spec §1/§3/§5).
// This file keeps ONLY: the RoomId union, per-room display label/sub for the
// ROOM GUIDE legend, the legend order, and the watcher→layout alias map so
// goToRoom('po') resolves to the founder office.
//
// Watcher-emitted ids (confirmed in watcher/src/roomMap.ts): archive, dev,
// server, research, meeting, test, po, lobby. The spec renames 'po'→'founder'
// and adds 'corridor' (layout-only routing zone). We keep 'po' as the legend
// display id (its label is "Jia's Office") and alias it to 'founder' for the
// 3D layout, so the ROOM GUIDE panel + main.ts guards never break.

export type RoomId =
  | 'archive'
  | 'dev'
  | 'server'
  | 'research'
  | 'meeting'
  | 'test'
  | 'po'       // watcher id; legend display; aliases to layout 'founder'
  | 'lobby'
  | 'founder'  // spec layout id (same office as 'po')
  | 'corridor'; // spec layout-only routing zone (no legend entry)

export interface RoomRect {
  id: RoomId;
  label: string; // KO
  sub: string;   // EN
  desc?: string; // KO one-line purpose (legend rooms only; layout-only rooms omit)
}

/** Legend/display metadata. Keyed by the ids the ROOM GUIDE shows. corridor and
    founder are layout-only, so they are NOT part of the legend set, but are kept
    resolvable for `room in ROOMS` guards. */
export const ROOMS: Record<RoomId, RoomRect> = {
  archive:  { id: 'archive',  label: '아카이브', sub: 'ARCHIVE',  desc: '코드·파일을 읽고 탐색' },
  dev:      { id: 'dev',      label: '개발실',   sub: 'DEV',      desc: '코드를 작성·수정' },
  research: { id: 'research', label: '리서치',   sub: 'RESEARCH', desc: '웹 검색·문서 조사' },
  meeting:  { id: 'meeting',  label: '회의실',   sub: 'MEETING',  desc: '계획·스펙 작성, 워크플로우 조율' },
  lobby:    { id: 'lobby',    label: '로비',     sub: 'LOBBY',    desc: '턴 사이 대기·휴식' },
  test:     { id: 'test',     label: '테스트실', sub: 'TEST',     desc: '테스트 실행' },
  server:   { id: 'server',   label: '서버실',   sub: 'SERVER',   desc: '명령 실행·빌드·프로세스' },
  po:       { id: 'po',       label: "Jia's Office", sub: 'FOUNDER', desc: '대표에게 승인 요청' },
  founder:  { id: 'founder',  label: "Jia's Office", sub: 'FOUNDER' },
  corridor: { id: 'corridor', label: '복도',     sub: 'CORRIDOR' },
};

/** The ROOM GUIDE legend order (8 labeled rooms as before; corridor/founder
    are layout-only and intentionally excluded from the panel). */
export const ROOM_ORDER: RoomId[] = [
  'archive', 'dev', 'research', 'meeting', 'lobby', 'test', 'server', 'po',
];

/** Watcher id → layout id alias (spec §3): 'po' maps to the founder office. */
export const ROOM_ALIAS: Partial<Record<string, RoomId>> = {
  po: 'founder',
};

/** Resolve any incoming id (watcher or layout) to a valid layout RoomId, or
    null if unknown. Applies the alias first, then validates against ROOMS. */
export function resolveRoom(id: string): RoomId | null {
  const aliased = ROOM_ALIAS[id] ?? id;
  return aliased in ROOMS ? (aliased as RoomId) : null;
}
