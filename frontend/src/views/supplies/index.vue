<template>
  <section class="page" data-module="supplies">
    <header class="page-head">
      <div>
        <h2>应急物资储备与调拨台账</h2>
        <p class="page-desc">储备按存放仓架分栏，调拨按提出调拨、仓库复核、出库确认一段一段往前推。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportReserve">导出储备台账</button>
        <button class="btn" type="button" @click="exportDispatch">导出调拨清单</button>
      </div>
    </header>

    <p class="rule-note">
      口径说明：储备数量只此一份，储备台账与调拨单读的是同一份数；存放仓架与物资编号冲突时，以物资编号在储备台账上的登记为准；
      存放仓架填成极值（字母段 A–D、数字段 01–12 之外）的记录单独退回核对，核对前不能调拨；
      调拨状态只进不退，倒序改动一律挡下；同一物资编号反复出库，库存扣减不叠加。
    </p>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <h3 class="section-title">储备台账（按存放仓架分栏）</h3>
    <div class="rack-board">
      <article v-for="column in rackColumns" :key="column.rack" class="rack-col">
        <header>{{ column.rack }}</header>
        <table class="rack-table">
          <thead>
            <tr><th>物资编号</th><th>储备数量</th><th>可用数量</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in column.items" :key="item.id" :class="{ 'below-warning': item.belowWarning }">
              <td>{{ item.物资编号 }}<br /><span class="item-name">{{ item.物资名称 }}</span></td>
              <td>{{ item.储备数量 }}{{ item.计量单位 }}</td>
              <td>{{ item.可用数量 }}{{ item.计量单位 }}</td>
            </tr>
          </tbody>
        </table>
      </article>

      <article class="rack-col warning">
        <header>低于预警线（{{ warningLines.length }}）</header>
        <table class="rack-table">
          <thead>
            <tr><th>物资编号</th><th>可用数量</th><th>预警线</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in warningLines" :key="item.id">
              <td>{{ item.物资编号 }}<br /><span class="item-name">{{ item.物资名称 }} · {{ item.存放仓架 }}</span></td>
              <td class="warning-num">{{ item.可用数量 }}{{ item.计量单位 }}</td>
              <td>{{ item.预警线 }}{{ item.计量单位 }}</td>
            </tr>
            <tr v-if="!warningLines.length"><td colspan="3" class="empty-state">暂无低于预警线的物资</td></tr>
          </tbody>
        </table>
      </article>

      <article class="rack-col returned">
        <header>退回核对·仓架极值（{{ returnedRows.length }}）</header>
        <table class="rack-table">
          <thead>
            <tr><th>物资编号</th><th>填报仓架</th><th>储备数量</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in returnedRows" :key="String(row.id)">
              <td>{{ row['物资编号'] }}<br /><span class="item-name">{{ row['物资名称'] }}</span></td>
              <td class="warning-num">{{ row['存放仓架'] }}</td>
              <td>{{ row['储备数量'] }}{{ row['计量单位'] }}</td>
            </tr>
            <tr v-if="!returnedRows.length"><td colspan="3" class="empty-state">暂无仓架极值记录</td></tr>
          </tbody>
        </table>
        <p class="col-note">这几条存放仓架填成极值，已单独退回核对，改正前不参与调拨。</p>
      </article>
    </div>

    <h3 class="section-title">提出调拨</h3>
    <form class="filter-bar" @submit.prevent="submitDispatch">
      <label class="filter-item">
        <span>物资编号</span>
        <select v-model="form.物资编号">
          <option value="" disabled>选择物资</option>
          <option v-for="item in dispatchable" :key="item.id" :value="item.物资编号">
            {{ item.物资编号 }} {{ item.物资名称 }}（{{ item.存放仓架 }}，可用 {{ item.可用数量 }}{{ item.计量单位 }}）
          </option>
        </select>
      </label>
      <label class="filter-item">
        <span>调拨数量</span>
        <input v-model.number="form.调拨数量" type="number" min="1" placeholder="大于 0 的整数" />
      </label>
      <label class="filter-item">
        <span>调拨去向</span>
        <input v-model="form.调拨去向" placeholder="如 HAZA-0001" />
      </label>
      <label class="filter-item">
        <span>填报仓架（可空）</span>
        <input v-model="form.填报仓架" placeholder="与台账不一致时以物资编号登记为准" />
      </label>
      <button class="btn primary" type="submit">提出调拨</button>
    </form>

    <h3 class="section-title">调拨单</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>调拨单号</th>
          <th>物资编号</th>
          <th>调拨数量</th>
          <th>调拨去向</th>
          <th>存放仓架（台账 / 填报）</th>
          <th>当前可用</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="line in dispatchLines" :key="line.id">
          <td>{{ line.调拨单号 }}</td>
          <td>{{ line.物资编号 }}<br /><span class="item-name">{{ line.物资名称 }}</span></td>
          <td>{{ line.调拨数量 }}</td>
          <td>{{ line.调拨去向 }}</td>
          <td>
            {{ line.台账仓架 }} / {{ line.填报仓架 }}
            <span v-if="line.rackConflict" class="conflict-note">不一致，以物资编号登记为准</span>
          </td>
          <td>{{ line.当前可用 }}</td>
          <td>{{ line.status }}</td>
          <td class="row-actions">
            <button v-if="line.nextAction === '仓库复核'" class="link" type="button" @click="doReview(line)">仓库复核</button>
            <button v-if="line.nextAction === '出库确认'" class="link" type="button" @click="doOutbound(line)">出库确认</button>
            <span v-if="!line.nextAction" class="item-name">已出库，库存已扣减</span>
          </td>
        </tr>
        <tr v-if="!dispatchLines.length">
          <td colspan="8" class="empty-state">暂无调拨单，可先在上方提出调拨</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ dispatchLines.length }} 张调拨单 · 出库确认后隐患核销会多出一条到场物资待办</span>
      <span v-if="message" class="ok-text">{{ message }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  DISPATCH_KEY,
  RESERVE_KEY,
  confirmOutbound,
  createDispatch,
  ledgerSummary,
  listDispatchLines,
  listRackColumns,
  listReturnedRows,
  listWarningLines,
  reviewDispatch,
} from '@/api/supplies-service'
import type { DispatchLine, RackColumn, ReserveLine } from '@/api/supplies-service'
import type { EntryRow } from '@/data/types'

const rackColumns = ref<RackColumn[]>([])
const warningLines = ref<ReserveLine[]>([])
const returnedRows = ref<EntryRow[]>([])
const dispatchLines = ref<DispatchLine[]>([])
const stats = ref<{ label: string; value: number }[]>([])
const message = ref('')
const errorMessage = ref('')
const form = ref({ 物资编号: '', 调拨数量: 1, 调拨去向: '', 填报仓架: '' })

// 仓架极值退回核对的物资不进待调拨列表。
const dispatchable = computed(() => rackColumns.value.flatMap((column) => column.items))

function exportReserve() {
  downloadEntries(RESERVE_KEY)
}

function exportDispatch() {
  downloadEntries(DISPATCH_KEY)
}

function showResult(result: { ok: boolean; message: string }) {
  message.value = ''
  errorMessage.value = ''
  if (result.ok) {
    message.value = result.message
  } else {
    errorMessage.value = result.message
  }
}

function submitDispatch() {
  const result = createDispatch(form.value)
  showResult(result)
  if (result.ok) {
    form.value = { 物资编号: '', 调拨数量: 1, 调拨去向: '', 填报仓架: '' }
  }
  reload()
}

function doReview(line: DispatchLine) {
  showResult(reviewDispatch(line.id))
  reload()
}

function doOutbound(line: DispatchLine) {
  showResult(confirmOutbound(line.id))
  reload()
}

function reload() {
  rackColumns.value = listRackColumns()
  warningLines.value = listWarningLines()
  returnedRows.value = listReturnedRows()
  dispatchLines.value = listDispatchLines()
  stats.value = ledgerSummary()
}

onMounted(reload)
</script>

<style scoped>
.rule-note {
  background: #fff8e6;
  border: 1px solid #f0d48a;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  color: #7a5b13;
  line-height: 1.7;
}
.section-title {
  font-size: 14px;
  margin: 16px 0 8px;
}
.rack-board {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  overflow-x: auto;
  padding-bottom: 4px;
}
.rack-col {
  min-width: 200px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.rack-col > header {
  padding: 8px 10px;
  font-weight: 600;
  font-size: 13px;
  border-bottom: 1px solid var(--border);
  background: #f4f7fb;
}
.rack-col.warning > header {
  color: #b42318;
  background: #fef3f2;
}
.rack-col.returned > header {
  color: #b42318;
  background: #fef3f2;
}
.rack-table {
  width: 100%;
  border-collapse: collapse;
}
.rack-table th,
.rack-table td {
  padding: 6px 10px;
  font-size: 12px;
  text-align: left;
  border-bottom: 1px solid #eef1f5;
}
.rack-table th {
  color: var(--muted);
  font-weight: 500;
}
.below-warning td {
  background: #fff5f5;
}
.warning-num {
  color: #b42318;
  font-weight: 600;
}
.item-name {
  color: var(--muted);
  font-size: 12px;
}
.col-note {
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--muted);
}
.conflict-note {
  display: block;
  color: #b42318;
  font-size: 12px;
}
.ok-text {
  color: #067647;
}
select,
input {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
}
</style>
