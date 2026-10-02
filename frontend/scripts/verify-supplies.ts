// 验证应急物资台账的核心规则：前推约束、幂等出库、极值退回、核销联动。
import { listEntries, runAction } from '@/api/local-service'

let failures = 0
function check(label: string, actual: boolean) {
  if (actual) {
    console.log(`  PASS ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}`)
  }
}

function row(id: number) {
  return listEntries('supplies').items.find((item) => Number(item.id) === id)!
}

console.log('1. 状态只能一段一段往前推')
check('在库直接仓库复核被挡下', !runAction('supplies', 1, '仓库复核').ok)
check('在库直接出库确认被挡下', !runAction('supplies', 1, '出库确认').ok)
check('在库提出调拨放行', runAction('supplies', 1, '提出调拨').ok)
check('调拨申请中仓库复核放行', runAction('supplies', 1, '仓库复核').ok)
check('复核通过出库确认放行', runAction('supplies', 1, '出库确认').ok)
check('出库后可用数量 120-20=100', Number(row(1)['可用数量']) === 100)
check('已出库再提出调拨被挡下', !runAction('supplies', 1, '提出调拨').ok)

console.log('2. 同一物资编号反复出库不叠加')
// SUPP-0004 登记了两条：id=4（B-01，调拨申请中）、id=5（B-03，在库）
check('id=4 仓库复核放行', runAction('supplies', 4, '仓库复核').ok)
check('id=4 出库确认放行', runAction('supplies', 4, '出库确认').ok)
check('id=4 可用数量 200-30=170', Number(row(4)['可用数量']) === 170)
check('id=5 提出调拨放行', runAction('supplies', 5, '提出调拨').ok)
check('id=5 仓库复核放行', runAction('supplies', 5, '仓库复核').ok)
const dup = runAction('supplies', 5, '出库确认')
check('id=5 同编号出库确认状态仍往前走', dup.ok)
check('id=5 可用数量不叠加扣减仍为 50', Number(row(5)['可用数量']) === 50)
const clearanceTodos = listEntries('clearance').items.filter((item) =>
  String(item['核销依据']).includes('SUPP-0004'),
)
check('SUPP-0004 只生成一条核销待办', clearanceTodos.length === 1)
check('核销待办状态为待复核', clearanceTodos[0]?.status === '待复核')

console.log('3. 出库结论驱动隐患核销待办')
const todos = listEntries('clearance').items.filter((item) =>
  String(item['核销依据']).includes('到场物资'),
)
check('到场物资待办共 2 条（SUPP-0001、SUPP-0004）', todos.length === 2)

console.log('4. 极值仓架单独退回核对')
check('正常仓架退回核对被挡下', !runAction('supplies', 2, '退回核对').ok)
check('已出库记录退回核对被挡下', !runAction('supplies', 9, '退回核对').ok)
// id=10（Z-99，未核对）：调拨单据可以走，但出库确认必须挡下
check('极值仓架提出调拨放行', runAction('supplies', 10, '提出调拨').ok)
check('极值仓架仓库复核放行', runAction('supplies', 10, '仓库复核').ok)
check('极值仓架未核对前出库确认被挡下', !runAction('supplies', 10, '出库确认').ok)
check('被挡后仍是复核通过', row(10).status === '复核通过')
check('极值仓架退回核对放行', runAction('supplies', 10, '退回核对').ok)
check('id=10 进入待核对', row(10).status === '待核对')
check('待核对不能提出调拨', !runAction('supplies', 10, '提出调拨').ok)
check('待核对完成核对放行', runAction('supplies', 10, '完成核对').ok)
check('核对后回到在库且已标记核对', row(10).status === '在库' && row(10)['rackVerified'] === true)

console.log('5. 极值仓架核对后可以走完整出库')
check('核对后提出调拨放行', runAction('supplies', 10, '提出调拨').ok)
check('核对后仓库复核放行', runAction('supplies', 10, '仓库复核').ok)
check('核对后出库确认放行', runAction('supplies', 10, '出库确认').ok)
check('id=10 可用数量 90-15=75', Number(row(10)['可用数量']) === 75)

console.log('6. 重复动作幂等')
check('待核对记录重复退回核对被挡下', !runAction('supplies', 11, '退回核对').ok)
check('已出库记录重复出库确认被挡下', !runAction('supplies', 9, '出库确认').ok)

if (failures > 0) {
  console.log(`\n${failures} 项未通过`)
  process.exit(1)
}
console.log('\n全部通过')
