/**
 * 阅读器实例桥——命令 handler（非 React 上下文）够到「要动的那一份 store」的唯一入口
 * （形状照 serial-monitor 的 `services/commandBridge.ts`：模块级 Map 单一属主，外部只经函数读）。
 *
 * ── 为什么需要这一层 ──
 * 状态链路的属主是**视图**（一份打开的文档一个 store，ReaderView mount 时建），而命令 handler
 * 不在 React 里；两个 pdf 各开一个标签 = 两份 store 并存 ⇒ 「这份命令打给哪一份」必须先定下来。
 *
 * ── 寻址口径（21-插件命令化规范 §7 之二：点名必须命中，⛔ 不静默回退）──
 *   · **点了名**（实参带 sourceId）⇒ 只认它；查不到如实报 `bad-source` 并把**现有的**列出来，
 *     ⛔ 不偷偷改打活跃的那一份（那会让「我动的是 A」变成「我动了 B」）；
 *   · **没点名** ⇒ 壳的活跃标签（`tabs.list()` 里各窗口聚焦组的 activeTabId）→ 本仓实例；
 *     活跃的不是阅读器 / 壳没给读数 ⇒ 退「第一份」——规范 §7 之二明确允许**缺省**走「活跃 → 第一个」；
 *   · **一份都没挂** ⇒ `no-document`（调用方回「不是失败」那档回执；⛔ 不偷偷开标签——开文档归
 *     fileAssociations 那条路，命令只做「已经开着的那份」）。
 *
 * ⚠️ 本 Map **一池一份**（一窗口一池渲染进程）：`tabs.list()` 返回的是**全窗口**清单，但只有本窗口
 * 真挂着的那几份在表里 ⇒ 跨窗口误配在构造上不可能。
 */
import { PLUGIN_ID } from "../constants";
import type { ReaderStore } from "../views/readerStore";

/**
 * sourceId → 该文档现挂的 store **列表**（ReaderView mount 登记、unmount 销号）。
 *
 * 🔴 一 key 一份存不下：**同一份文件可以同时开在两个分组/窗口里**（壳的标签权威面本来就是
 * `windows[].groups[].tabs[]`），两份视图两份 store 同一个 `sourceId`——用单值 Map 会「后挂的
 * 把先挂的顶掉」，接着**任一份关标签就把还开着的那份的号也销了**（此后命令对着一个开着的阅读器
 * 答 `no-document`——正是规范最恨的那种「答了个空，看着却像答案」）。故存列表：寻址取**最后挂上的**
 * 那份（最近打开的那份视图），关标签只销自己那一份（销号按实例比对）。
 *
 * ⚠️ 已知边界（留给 T6/T7 定夺）：同文件两视图时「谁是被寻址的那一份」只能按挂载先后取最近，
 * 看得出精确意图的判据是**标签 id**（`tabs.list()` 的 `tab.id` 唯一定位一个标签），而对外寻址
 * 口径现在写的是 `sourceId`（文件路径，人/文档好懂）——⛔ 别在这一棒里顺手改口径。
 */
const _stores = new Map<string, ReaderStore[]>();

export function attachReaderStore(sourceId: string, store: ReaderStore): void {
  const list = _stores.get(sourceId);
  if (!list) {
    _stores.set(sourceId, [store]);
    return;
  }
  if (!list.includes(store)) list.push(store);
}

/**
 * 销号。`store` **按实例销**（视图清理应当传自己那一份）；不传则销最后挂上的那份（兼容旧调用形）。
 * 夹在中间的那份关掉时，寻址仍落在最后挂上的那份上——顺序只增不减，⛔ 不做「中间抽走」的花活。
 */
export function detachReaderStore(sourceId: string, store?: ReaderStore): void {
  const list = _stores.get(sourceId);
  if (!list) return;
  const at = store ? list.indexOf(store) : list.length - 1;
  if (at >= 0) list.splice(at, 1);
  if (list.length === 0) _stores.delete(sourceId);
}

/** 该 sourceId 现在够得着的那一份（最后挂上的） */
function storeFor(sourceId: string): ReaderStore | undefined {
  const list = _stores.get(sourceId);
  return list && list.length > 0 ? list[list.length - 1] : undefined;
}

/** 本窗口现挂的阅读器 sourceId 清单——失败回执要「列出有哪些」（规范 §7 之二） */
export function attachedSourceIds(): string[] {
  return [..._stores.keys()];
}

/**
 * 寻址结果：
 *   · `ok`          → 动手的那一份（sourceId 一并交回，多标签下调用方才知道是「谁」答的）；
 *   · `bad-source`  → 点了名但找不到／名字不是非空字符串（调用方回 `ok:false`）；
 *   · `no-document` → 一份都没挂（调用方回「不是失败」那档：目标不存在，不是调用写错了）。
 */
export type ReaderTarget =
  | { kind: "ok"; store: ReaderStore; sourceId: string }
  | { kind: "bad-source"; received: unknown; available: string[] }
  | { kind: "no-document" };

/**
 * 壳侧活跃标签 → 本仓 sourceId——读 `tabs.list()`（池侧唯一的「现在开着什么、谁活跃」权威面）。
 * 活跃的不是阅读器 / 壳没给这个面 / 读数抛了 ⇒ null（调用方退缺省第一份）。
 */
async function activeReaderSourceId(): Promise<string | null> {
  try {
    const snapshot = await window.linkdesk?.tabs?.list?.();
    for (const win of snapshot?.windows ?? []) {
      for (const group of win?.groups ?? []) {
        // 只看「该窗口聚焦的那个组」——其它组的 activeTabId 是「那个组自己的活跃页」，不是全局前台
        if (group?.id !== win?.activeGroupId) continue;
        const tab = (group.tabs ?? []).find((t) => t?.id === group.activeTabId);
        const sourceId = tab?.sourceId;
        if (tab?.pluginId === PLUGIN_ID && typeof sourceId === "string" && storeFor(sourceId)) {
          return sourceId;
        }
      }
    }
  } catch {
    /* 读数拿不到就按「没有活跃」走——缺省语义允许退第一份，⛔ 不因壳侧读数失败把命令判死 */
  }
  return null;
}

/** 寻址到「要动的那一份阅读器」——每条 handler 的唯一目标来源 */
export async function resolveReaderTarget(sourceId?: unknown): Promise<ReaderTarget> {
  if (sourceId !== undefined && sourceId !== null && sourceId !== "") {
    if (typeof sourceId !== "string" || !sourceId.trim()) {
      return { kind: "bad-source", received: sourceId, available: attachedSourceIds() };
    }
    const id = sourceId.trim();
    const store = storeFor(id);
    if (!store) return { kind: "bad-source", received: sourceId, available: attachedSourceIds() };
    return { kind: "ok", store, sourceId: id };
  }
  const active = await activeReaderSourceId();
  const activeStore = active ? storeFor(active) : undefined;
  if (active && activeStore) return { kind: "ok", store: activeStore, sourceId: active };

  const first = attachedSourceIds()[0];
  const firstStore = first ? storeFor(first) : undefined;
  if (first && firstStore) return { kind: "ok", store: firstStore, sourceId: first };

  return { kind: "no-document" };
}
