import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 应急物资台账的专属读写口。储备与调拨分开存，但储备数量只有一份：
// 储备台账、调拨单两条路径都调这里的 availableFor / listRackColumns，读的是同一份数。
export const RESERVE_KEY = 'supplies'
export const DISPATCH_KEY = 'supplies_dispatch'
const CLEARANCE_KEY = 'clearance'

// 存放仓架的合法口径：字母段 A–D、数字段 01–12（如 A-01、C-12）。落在范围外的都算极值，单独退回核对。
const RACK_PATTERN = /^[A-D]-(0[1-9]|1[0-2])$/

// 调拨状态机：提出调拨 → 仓库复核 → 出库确认，只能一段一段往前推，倒序改动一律挡下。
const NEXT_STEP: Record<string, { action: string; target: string }> = {
  待复核: { action: '仓库复核', target: '已复核' },
  已复核: { action: '出库确认', target: '已出库' },
}

export function isExtremeRack(rack: string): boolean {
  return !RACK_PATTERN.test(rack.trim())
}

export type ReserveLine = {
  id: number
  物资编号: string
  物资名称: string
  存放仓架: string
  储备数量: number
  可用数量: number
  预警线: number
  计量单位: string
  belowWarning: boolean
}

export type RackColumn = {
  rack: string
  items: ReserveLine[]
}

export type DispatchLine = {
  id: number
  调拨单号: string
  物资编号: string
  物资名称: string
  调拨数量: number
  调拨去向: string
  台账仓架: string
  填报仓架: string
  rackConflict: boolean
  当前可用: number
  status: string
  nextAction: string | null
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function nextSerial(rows: EntryRow[], field: string, prefix: string): string {
  const max = rows.reduce((acc, row) => {
    const match = String(row[field] ?? '').match(/(\d+)$/)
    return match ? Math.max(acc, Number(match[1])) : acc
  }, 0)
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

// 已出库合计：按调拨单号去重，同一物资编号反复出库，结果不叠加。
function deliveredQuantity(itemCode: string, dispatches: EntryRow[]): number {
  const seen = new Set<string>()
  let total = 0
  for (const row of dispatches) {
    if (String(row['物资编号']) !== itemCode || String(row.status) !== '已出库') {
      continue
    }
    const orderNo = String(row['调拨单号'])
    if (seen.has(orderNo)) {
      continue
    }
    seen.add(orderNo)
    total += Number(row['调拨数量']) || 0
  }
  return total
}

// 可用数量 = 储备数量 − 已出库合计。储备台账和调拨单都从这里读，保证两条路径一个数。
export function availableFor(itemCode: string): number {
  const reserve = listRows(RESERVE_KEY).find((row) => String(row['物资编号']) === itemCode)
  if (!reserve) {
    return 0
  }
  return Number(reserve['储备数量']) - deliveredQuantity(itemCode, listRows(DISPATCH_KEY))
}

function toReserveLine(row: EntryRow, dispatches: EntryRow[]): ReserveLine {
  const 储备数量 = Number(row['储备数量']) || 0
  const 可用数量 = 储备数量 - deliveredQuantity(String(row['物资编号']), dispatches)
  const 预警线 = Number(row['预警线']) || 0
  return {
    id: Number(row.id),
    物资编号: String(row['物资编号']),
    物资名称: String(row['物资名称'] ?? ''),
    存放仓架: String(row['存放仓架']),
    储备数量,
    可用数量,
    预警线,
    计量单位: String(row['计量单位'] ?? ''),
    belowWarning: 可用数量 < 预警线,
  }
}

// 储备台账按存放仓架分栏；仓架填成极值的不进栏，单独退回核对。
export function listRackColumns(): RackColumn[] {
  const dispatches = listRows(DISPATCH_KEY)
  const groups = new Map<string, ReserveLine[]>()
  for (const row of listRows(RESERVE_KEY)) {
    const rack = String(row['存放仓架'])
    if (isExtremeRack(rack)) {
      continue
    }
    const items = groups.get(rack) ?? []
    items.push(toReserveLine(row, dispatches))
    groups.set(rack, items)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rack, items]) => ({ rack, items }))
}

// 可动用数量低于预警线的，单独汇成一栏。
export function listWarningLines(): ReserveLine[] {
  const dispatches = listRows(DISPATCH_KEY)
  return listRows(RESERVE_KEY)
    .filter((row) => !isExtremeRack(String(row['存放仓架'])))
    .map((row) => toReserveLine(row, dispatches))
    .filter((line) => line.belowWarning)
}

// 存放仓架填成极值的那几条，单独退回核对。
export function listReturnedRows(): EntryRow[] {
  return listRows(RESERVE_KEY).filter((row) => isExtremeRack(String(row['存放仓架'])))
}

// 调拨单视图：仓架以物资编号在储备台账上的登记为准，填报仓架不一致时标出冲突。
export function listDispatchLines(): DispatchLine[] {
  const reserveRows = listRows(RESERVE_KEY)
  return listRows(DISPATCH_KEY).map((row) => {
    const code = String(row['物资编号'])
    const reserve = reserveRows.find((item) => String(item['物资编号']) === code)
    const 台账仓架 = reserve ? String(reserve['存放仓架']) : '未上账'
    const 填报仓架 = String(row['填报仓架'] ?? '')
    const status = String(row.status)
    return {
      id: Number(row.id),
      调拨单号: String(row['调拨单号']),
      物资编号: code,
      物资名称: reserve ? String(reserve['物资名称'] ?? '') : '未知物资',
      调拨数量: Number(row['调拨数量']) || 0,
      调拨去向: String(row['调拨去向'] ?? ''),
      台账仓架,
      填报仓架: 填报仓架 || '—',
      rackConflict: 填报仓架 !== '' && 填报仓架 !== 台账仓架,
      当前可用: availableFor(code),
      status,
      nextAction: NEXT_STEP[status]?.action ?? null,
    }
  })
}

export function ledgerSummary(): { label: string; value: number }[] {
  const dispatches = listRows(DISPATCH_KEY)
  return [
    { label: '在册物资（种）', value: listRows(RESERVE_KEY).length },
    { label: '低于预警线', value: listWarningLines().length },
    { label: '仓架极值退回', value: listReturnedRows().length },
    { label: '待推进调拨单', value: dispatches.filter((row) => row.pending).length },
  ]
}

export function createDispatch(input: {
  物资编号: string
  调拨数量: number
  调拨去向: string
  填报仓架?: string
}): ActionResult {
  const code = input.物资编号.trim()
  const reserve = listRows(RESERVE_KEY).find((row) => String(row['物资编号']) === code)
  if (!reserve) {
    return { ok: false, message: `物资编号 ${code || '(空)'} 不在储备台账里，先上账再调拨` }
  }
  const rack = String(reserve['存放仓架'])
  if (isExtremeRack(rack)) {
    return { ok: false, message: `${code} 的存放仓架「${rack}」是极值，已退回核对，核对前不能调拨` }
  }
  const qty = Math.floor(Number(input.调拨数量))
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, message: '调拨数量要是大于 0 的整数' }
  }
  const available = availableFor(code)
  if (qty > available) {
    return { ok: false, message: `${code} 当前可用 ${available}，不够调 ${qty}` }
  }
  const target = input.调拨去向.trim()
  if (!target) {
    return { ok: false, message: '调拨去向不能为空' }
  }
  const declared = (input.填报仓架 ?? '').trim()
  if (declared && isExtremeRack(declared)) {
    return { ok: false, message: `填报仓架「${declared}」是极值，这条先退回核对，改正后再提调拨` }
  }
  const rows = listRows(DISPATCH_KEY)
  const orderNo = nextSerial(rows, '调拨单号', 'DISP')
  const row: EntryRow = {
    id: nextId(rows),
    status: '待复核',
    pending: true,
    abnormal: false,
    调拨单号: orderNo,
    物资编号: code,
    调拨数量: qty,
    调拨去向: target,
    填报仓架: declared,
    调拨状态: '待复核',
    已扣减: false,
  }
  saveRows(DISPATCH_KEY, [...rows, row])
  const conflict =
    declared && declared !== rack ? `；填报仓架 ${declared} 与台账 ${rack} 不一致，以物资编号登记为准` : ''
  return { ok: true, message: `调拨单 ${orderNo} 已提出，待仓库复核${conflict}` }
}

function advance(id: number, action: string): { ok: boolean; message: string; row?: EntryRow; rows?: EntryRow[]; index?: number } {
  const rows = listRows(DISPATCH_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的调拨单` }
  }
  const row = rows[index]
  const step = NEXT_STEP[String(row.status)]
  if (!step) {
    return { ok: false, message: `调拨单 ${row['调拨单号']} 已是「${row.status}」，状态只进不退，倒序改动一律挡下` }
  }
  if (step.action !== action) {
    return { ok: false, message: `调拨单 ${row['调拨单号']} 当前「${row.status}」，只能${step.action}，不能跳段也不能倒序` }
  }
  return { ok: true, message: '', row, rows, index }
}

export function reviewDispatch(id: number): ActionResult {
  const step = advance(id, '仓库复核')
  if (!step.ok || !step.row || !step.rows || step.index === undefined) {
    return { ok: false, message: step.message }
  }
  const next = [...step.rows]
  next[step.index] = { ...step.row, status: '已复核', 调拨状态: '已复核' }
  saveRows(DISPATCH_KEY, next)
  return { ok: true, message: `调拨单 ${step.row['调拨单号']} 仓库复核通过，待出库确认` }
}

export function confirmOutbound(id: number): ActionResult {
  const step = advance(id, '出库确认')
  if (!step.ok || !step.row || !step.rows || step.index === undefined) {
    return { ok: false, message: step.message }
  }
  const order = step.row
  // 幂等：这张单已经扣减过就不再扣，同一物资编号反复出库结果不叠加。
  if (order['已扣减'] === true) {
    return { ok: false, message: `调拨单 ${order['调拨单号']} 已扣减过，重复出库不叠加` }
  }
  const next = [...step.rows]
  next[step.index] = { ...order, status: '已出库', 调拨状态: '已出库', pending: false, 已扣减: true }
  saveRows(DISPATCH_KEY, next)
  syncReserveFlags()
  const todoNo = appendClearanceTodo(next[step.index])
  const todoMessage = todoNo ? `，隐患核销多出一条到场物资待办 ${todoNo}` : '，到场物资待办此前已生成，不重复加'
  return { ok: true, message: `调拨单 ${order['调拨单号']} 出库确认，库存已扣减${todoMessage}` }
}

// 出库的结论驱动隐患核销的待办：那边多出一条到场物资。按来源调拨单去重，不重复生成。
function appendClearanceTodo(order: EntryRow): string {
  const rows = listRows(CLEARANCE_KEY)
  const orderNo = String(order['调拨单号'])
  if (rows.some((row) => String(row['来源调拨单'] ?? '') === orderNo)) {
    return ''
  }
  const reserve = listRows(RESERVE_KEY).find((row) => String(row['物资编号']) === String(order['物资编号']))
  const name = reserve ? String(reserve['物资名称'] ?? '') : ''
  const unit = reserve ? String(reserve['计量单位'] ?? '') : ''
  const serial = nextSerial(rows, '核销编号', 'CLEA')
  const todo: EntryRow = {
    id: nextId(rows),
    status: '待复核',
    pending: true,
    abnormal: false,
    核销编号: serial,
    所属隐患点: String(order['调拨去向']),
    核销依据: `调拨单 ${orderNo} 到场物资：${order['物资编号']} ${name} × ${order['调拨数量']}${unit}`,
    复核人: '待指派',
    复核日期: '',
    核销结论: '',
    归档日期: '',
    核销状态: '到场物资待复核',
    来源调拨单: orderNo,
  }
  saveRows(CLEARANCE_KEY, [...rows, todo])
  return serial
}

// 储备行的 pending / abnormal 标志跟着最新口径走：低于预警线算待处理，仓架极值算异常退回。
function syncReserveFlags(): void {
  const dispatches = listRows(DISPATCH_KEY)
  const rows = listRows(RESERVE_KEY).map((row) => {
    const extreme = isExtremeRack(String(row['存放仓架']))
    const line = toReserveLine(row, dispatches)
    const status = extreme ? '退回核对' : '在库'
    return { ...row, status, 台账状态: status, pending: !extreme && line.belowWarning, abnormal: extreme }
  })
  saveRows(RESERVE_KEY, rows)
}
