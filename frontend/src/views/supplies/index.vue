<template>
  <section class="page" data-module="supplies">
    <header class="page-head">
      <div>
        <h2>应急物资储备与调拨台账</h2>
        <p class="page-desc">{{ meta.desc }}</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记物资</button>
        <button class="btn" type="button" @click="exportRows">导出应急物资清单</button>
      </div>
    </header>

    <div class="rule-board">
      <p>流转规则：提出调拨 → 仓库复核 → 出库确认，状态一段一段往前推，倒序、跳段改动一律挡下。</p>
      <p>扣减规则：同一物资编号反复出库结果不叠加，全台账只扣一次；出库确认后隐患核销多出一条到场物资待办。</p>
      <p>冲突规则：存放仓架与物资编号对不上时以物资编号为准，存放仓架只用于分栏陈列，不参与扣减。</p>
      <p>极值规则：存放仓架超出 A-01~D-12 的记录单独退回核对，核对完成前不能出库。</p>
      <p>口径规则：储备分栏、预警栏与调拨流转读的是同一份储备数量，不另立账本。</p>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <section class="board warn-board">
      <h3 class="board-title">低于预警线 · 单独一栏（{{ lowStock.length }} 条）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>物资编号</th>
            <th>物资名称</th>
            <th>存放仓架</th>
            <th>储备数量</th>
            <th>可用数量</th>
            <th>预警线</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in lowStock" :key="String(row.id)">
            <td>{{ row['物资编号'] }}</td>
            <td>{{ row['物资名称'] }}</td>
            <td>{{ row['存放仓架'] }}</td>
            <td>{{ row['储备数量'] }}</td>
            <td class="warn-text">{{ row['可用数量'] }}</td>
            <td>{{ row['预警线'] }}</td>
          </tr>
          <tr v-if="!lowStock.length">
            <td colspan="6" class="empty-state">当前没有可用数量低于预警线的物资</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="extremeRows.length" class="board board-extreme">
      <h3 class="board-title">仓架极值 · 单独退回核对（{{ extremeRows.length }} 条）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>物资编号</th>
            <th>物资名称</th>
            <th>存放仓架</th>
            <th>储备数量</th>
            <th>可用数量</th>
            <th>当前状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in extremeRows" :key="String(row.id)">
            <td>{{ row['物资编号'] }}</td>
            <td>{{ row['物资名称'] }}</td>
            <td class="warn-text">{{ row['存放仓架'] }}</td>
            <td>{{ row['储备数量'] }}</td>
            <td>{{ row['可用数量'] }}</td>
            <td>{{ row.status }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section
      v-for="group in rackGroups"
      :key="group.rack"
      class="board"
      :class="{ 'board-extreme': group.extreme }"
    >
      <h3 class="board-title">
        存放仓架 {{ group.rack }}
        <span v-if="group.extreme" class="warn-text">（极值仓架，以物资编号为准）</span>
      </h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>物资编号</th>
            <th>物资名称</th>
            <th>储备数量</th>
            <th>可用数量</th>
            <th>预警线</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in group.items" :key="String(row.id)">
            <td>{{ row['物资编号'] }}</td>
            <td>{{ row['物资名称'] }}</td>
            <td>{{ row['储备数量'] }}</td>
            <td :class="{ 'warn-text': isLow(row) }">{{ row['可用数量'] }}</td>
            <td>{{ row['预警线'] }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="board">
      <h3 class="board-title">调拨流转</h3>
      <form class="filter-bar" @submit.prevent="clearMessages">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-abnormal': row.abnormal }">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无应急物资数据，可先登记物资</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条应急物资记录</span>
      <span v-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  filterRows,
  isExtremeRack,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('supplies')
const columns = meta.fields
const actions = meta.actions
const statuses = meta.statuses

// 全量台账：储备分栏、预警栏、极值栏都从这里读；调拨流转表在同一份数据上加检索条件，
// 两条路径读的是同一份储备数量，不会两样。
const ledger = ref<EntryRow[]>([])
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const rows = computed(() => filterRows(ledger.value, filters.value))
const total = computed(() => ledger.value.length)

function isLow(row: EntryRow): boolean {
  return Number(row['可用数量']) < Number(row['预警线'])
}

const lowStock = computed(() => ledger.value.filter(isLow))

const extremeRows = computed(() => ledger.value.filter((row) => isExtremeRack(row['存放仓架'])))

const rackGroups = computed(() => {
  const groups = new Map<string, EntryRow[]>()
  for (const row of ledger.value) {
    const rack = String(row['存放仓架'] ?? '未登记')
    if (!groups.has(rack)) {
      groups.set(rack, [])
    }
    groups.get(rack)!.push(row)
  }
  return [...groups.entries()]
    .map(([rack, items]) => ({ rack, items, extreme: isExtremeRack(rack) }))
    .sort((left, right) => left.rack.localeCompare(right.rack))
})

const stats = computed(() => [
  { label: '低于预警线物资', value: lowStock.value.length },
  {
    label: '调拨流转中单据',
    value: ledger.value.filter((row) => row.status === '调拨申请中' || row.status === '复核通过').length,
  },
  { label: '已出库单据', value: ledger.value.filter((row) => row.status === '已出库').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: ledger.value.filter((row) => String(row.status) === status).length,
  })),
)

function clearMessages() {
  errorMessage.value = ''
  noticeMessage.value = ''
}

function resetFilters() {
  filters.value = {}
  clearMessages()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  clearMessages()
  errorMessage.value = '物资登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  clearMessages()
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  try {
    const payload = listEntries(meta.key)
    ledger.value = payload.items
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '应急物资列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.rule-board {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 12px;
}
.rule-board p {
  margin: 4px 0;
  font-size: 12px;
  color: var(--muted);
}
.board {
  margin-bottom: 16px;
}
.board-title {
  font-size: 14px;
  margin: 0 0 8px;
}
.warn-board .board-title {
  color: #b54708;
}
.board-extreme .board-title {
  color: #b42318;
}
.warn-text {
  color: #b42318;
  font-weight: 600;
}
.row-abnormal td {
  background: #fef3f2;
}
.ok-text {
  color: #027a48;
}
</style>
