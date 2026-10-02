import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// —— 应急物资台账的专属口径 ——
// 存放仓架的合法区间是 A-01~D-12，落在外面的按极值处理，单独退回核对。
export const SUPPLIES_KEY = 'supplies'
const RACK_PATTERN = /^[A-D]-(0[1-9]|1[0-2])$/

export function isExtremeRack(value: unknown): boolean {
  return !RACK_PATTERN.test(String(value ?? '').trim())
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 约定了前置状态的动作：只能一段一段往前推，倒序、跳段改动一律挡下。
  const from = meta.actionFrom?.[action]
  if (from && current !== from) {
    return { ok: false, message: `「${action}」只能从「${from}」往前推，当前是「${current}」，倒序或跳段改动一律挡下` }
  }
  if (key === SUPPLIES_KEY) {
    const blocked = guardSuppliesAction(action, rows[index])
    if (blocked) {
      return { ok: false, message: blocked }
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    // 物资台账的异常标记只看存放仓架是否极值，不随动作变化。
    abnormal: key === SUPPLIES_KEY
      ? isExtremeRack(rows[index]['存放仓架'])
      : NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (key === SUPPLIES_KEY && action === '完成核对') {
    // 仓架极值的记录核对完成后，以物资编号为准继续流转。
    updated['rackVerified'] = true
  }
  const next = [...rows]
  next[index] = updated
  let extra = ''
  if (key === SUPPLIES_KEY && action === '出库确认') {
    extra = applySuppliesOutbound(next, index)
  }
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${extra ? `；${extra}` : ''}` }
}

// 应急物资：退回核对只收仓架极值的记录；极值仓架未核对前不能出库。
function guardSuppliesAction(action: string, row: EntryRow): string {
  if (action === '退回核对') {
    if (String(row.status) === '已出库') {
      return '已经出库的记录不再退回核对，出库结论已生效'
    }
    if (!isExtremeRack(row['存放仓架'])) {
      return `存放仓架「${row['存放仓架']}」在 A-01~D-12 正常区间内，不在退回核对之列`
    }
  }
  if (action === '出库确认' && isExtremeRack(row['存放仓架']) && row['rackVerified'] !== true) {
    return '存放仓架是极值，先退回核对再出库；核对完成后以物资编号为准继续流转'
  }
  return ''
}

// 应急物资：同一物资编号在全台账里只扣减一回，反复出库结果不叠加，
// 也不重复生成隐患核销的到场物资待办。
function applySuppliesOutbound(rows: EntryRow[], index: number): string {
  const row = rows[index]
  const code = String(row['物资编号'])
  const deductedElsewhere = rows.some(
    (item, cursor) => cursor !== index && String(item['物资编号']) === code && item['outboundDeducted'] === true,
  )
  if (deductedElsewhere || row['outboundDeducted'] === true) {
    return '同一物资编号已出库过，结果不叠加：不再扣减可用数量，也不再生成核销待办'
  }
  const quantity = Number(row['调拨数量']) || 0
  const available = Number(row['可用数量']) || 0
  row['可用数量'] = Math.max(0, available - quantity)
  row['outboundDeducted'] = true
  appendClearanceTodo(row)
  return `可用数量扣减 ${quantity}，隐患核销那边多出一条到场物资待办`
}

// 出库结论驱动隐患核销：在核销模块追加一条「到场物资」待办，状态待复核。
function appendClearanceTodo(row: EntryRow): void {
  const rows = listRows('clearance')
  const nextId = rows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const today = new Date().toISOString().slice(0, 10)
  const todo: EntryRow = {
    id: nextId,
    status: '待复核',
    pending: true,
    abnormal: false,
    核销编号: `CLEA-${String(nextId).padStart(4, '0')}`,
    所属隐患点: '应急物资调拨',
    核销依据: `到场物资：${row['物资名称']}（${row['物资编号']}）×${row['调拨数量']}，自仓架 ${row['存放仓架']} 出库`,
    复核人: '待指派',
    复核日期: today,
    核销结论: '待复核',
    归档日期: '',
    核销状态: '待复核',
  }
  saveRows('clearance', [...rows, todo])
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
