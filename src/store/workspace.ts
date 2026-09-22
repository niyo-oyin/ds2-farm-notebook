// ロード前に始めた非同期処理と、ロード後の編集を区別する。
export const USER_DATA_KEY = 'ds2tool.userdata.v2';
let generation: number | undefined;
/** 世代はタブごとに保持する。他のタブがキャッシュを書き換えても、手元の古い状態を新世代として送らない。 */
export function workspaceGeneration(): number {
  if (generation === undefined) {
    try { generation = JSON.parse(localStorage.getItem(USER_DATA_KEY) ?? '{}').syncGeneration ?? 0; }
    catch { generation = 0; }
  }
  return generation!;
}
export const setWorkspaceGeneration = (next: number) => { generation = next; };
export function checkWorkspace(generation: number) {
  if (generation !== workspaceGeneration()) throw new Error('セーブデータがロードされたため、以前の状態への操作を中止しました。');
}
