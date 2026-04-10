<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { RobustAdaptiveEKF } from '../util/robustEKF'
import { TimeSeries, SmoothieChart } from 'smoothie'

interface Row {
  time: string
  gpsSpd: number | null
  gpsHdg: number | null
  gpsAcc: number | null
  ekfSpd: number
  ekfHdg: number
  dSpd: number | null
  dHdg: number | null
}

const rows = ref<Row[]>([])
const status = ref('Waiting for geolocation permission…')
const statusClass = ref('')
const MAX_ROWS = 200

let ekf: RobustAdaptiveEKF | null = null
let lastTime: number | null = null
let rowCount = 0

// Graphs
let speedChart: SmoothieChart
let headingChart: SmoothieChart
let gpsSpeedSeries: TimeSeries
let ekfSpeedSeries: TimeSeries
let gpsHeadingSeries: TimeSeries
let ekfHeadingSeries: TimeSeries

function fmt1(v: number | null): string | null {
  return v == null ? null : v.toFixed(1)
}

function onPosition(pos: GeolocationPosition) {
  const { latitude: lat, longitude: lon, speed, heading, accuracy } = pos.coords
  const now = pos.timestamp

  if (!ekf) {
    const h0 = heading != null ? heading * Math.PI / 180 : 0
    const v0 = speed != null ? speed : 0
    ekf = new RobustAdaptiveEKF(lat, lon, h0, v0)
    lastTime = now
    status.value = `EKF initialised at ${lat.toFixed(5)}, ${lon.toFixed(5)} — waiting for next fix…`
    statusClass.value = 'ok'
    return
  }

  const dtSec = (now - lastTime!) / 1000
  lastTime = now

  ekf.predict(dtSec)
  ekf.update(lat, lon)

  const ekfSpd = ekf.getSpeedKmh()
  const ekfHdg = ekf.getHeadingDeg()

  const gpsSpd = speed != null ? speed * 3.6 : null
  const gpsHdg = heading != null ? heading : null

  const dSpd = gpsSpd != null ? Math.abs(gpsSpd - ekfSpd) : null
  const dHdg = gpsHdg != null ? (() => {
    const d = Math.abs(gpsHdg - ekfHdg) % 360
    return d > 180 ? 360 - d : d
  })() : null

  const timeStr = new Date(now).toLocaleTimeString()

  const row: Row = {
    time: timeStr,
    gpsSpd,
    gpsHdg,
    gpsAcc: accuracy,
    ekfSpd,
    ekfHdg,
    dSpd,
    dHdg
  }

  rows.value.unshift(row)

  if (++rowCount > MAX_ROWS) rows.value.pop()

  // Update graphs
  if (gpsSpd != null) gpsSpeedSeries.append(now, gpsSpd)
  ekfSpeedSeries.append(now, ekfSpd)
  if (gpsHdg != null) gpsHeadingSeries.append(now, gpsHdg)
  ekfHeadingSeries.append(now, ekfHdg)

  const accClass = accuracy < 20 ? 'ok' : 'warn'
  status.value = `Fix #${rowCount} · acc ${accuracy.toFixed(0)} m · dt ${dtSec.toFixed(1)} s · EKF ${ekfSpd.toFixed(1)} km/h @ ${ekfHdg.toFixed(0)}°`
  statusClass.value = accClass
}

function onError() {
  status.value = 'Location is unavailable'
  statusClass.value = 'err'
}

function clearTable() {
  rows.value = []
  rowCount = 0
}

onMounted(() => {
  // Initialize graphs
  gpsSpeedSeries = new TimeSeries()
  ekfSpeedSeries = new TimeSeries()
  gpsHeadingSeries = new TimeSeries()
  ekfHeadingSeries = new TimeSeries()

  speedChart = new SmoothieChart({
    millisPerPixel: 100,
    grid: { fillStyle: '#0f172a', strokeStyle: '#1e293b' },
    labels: { fillStyle: '#e2e8f0' }
  })
  speedChart.addTimeSeries(gpsSpeedSeries, { strokeStyle: '#7dd3fc', lineWidth: 2 })
  speedChart.addTimeSeries(ekfSpeedSeries, { strokeStyle: '#86efac', lineWidth: 2 })
  speedChart.streamTo(document.getElementById('speed-canvas') as HTMLCanvasElement, 1000)

  headingChart = new SmoothieChart({
    millisPerPixel: 100,
    grid: { fillStyle: '#0f172a', strokeStyle: '#1e293b' },
    labels: { fillStyle: '#e2e8f0' }
  })
  headingChart.addTimeSeries(gpsHeadingSeries, { strokeStyle: '#7dd3fc', lineWidth: 2 })
  headingChart.addTimeSeries(ekfHeadingSeries, { strokeStyle: '#86efac', lineWidth: 2 })
  headingChart.streamTo(document.getElementById('heading-canvas') as HTMLCanvasElement, 1000)

  if (!navigator.geolocation) {
    status.value = 'Location is unavailable'
    statusClass.value = 'err'
  } else {
    navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 30000
    })
  }
})
</script>

<template>
  <div>
    <h1>RobustAdaptiveEKF — watchPosition demo</h1>
    <div :class="['status', statusClass]">{{ status }}</div>

    <div class="graphs">
      <div>
        <h2>Speed (km/h)</h2>
        <canvas id="speed-canvas" width="800" height="200"></canvas>
      </div>
      <div>
        <h2>Heading (°)</h2>
        <canvas id="heading-canvas" width="800" height="200"></canvas>
      </div>
    </div>

    <div class="table-wrap">
      <table id="log">
        <thead>
          <tr>
            <th>Time</th>
            <th class="gps">GPS spd<br>(km/h)</th>
            <th class="gps">GPS hdg<br>(°)</th>
            <th class="gps">GPS acc<br>(m)</th>
            <th class="ekf">EKF spd<br>(km/h)</th>
            <th class="ekf">EKF hdg<br>(°)</th>
            <th class="dlt">Δ spd<br>(km/h)</th>
            <th class="dlt">Δ hdg<br>(°)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.time">
            <td>{{ row.time }}</td>
            <td :class="row.gpsSpd == null ? 'null' : 'gps'">{{ row.gpsSpd == null ? '—' : fmt1(row.gpsSpd) }}</td>
            <td :class="row.gpsHdg == null ? 'null' : 'gps'">{{ row.gpsHdg == null ? '—' : fmt1(row.gpsHdg) }}</td>
            <td :class="row.gpsAcc == null ? 'null' : 'gps'">{{ row.gpsAcc == null ? '—' : fmt1(row.gpsAcc) }}</td>
            <td class="ekf">{{ row.ekfSpd.toFixed(1) }}</td>
            <td class="ekf">{{ row.ekfHdg.toFixed(1) }}</td>
            <td :class="row.dSpd == null ? 'null' : 'dlt'">{{ row.dSpd == null ? '—' : fmt1(row.dSpd) }}</td>
            <td :class="row.dHdg == null ? 'null' : 'dlt'">{{ row.dHdg == null ? '—' : fmt1(row.dHdg) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="8">
              <span class="gps">GPS</span> = raw GeolocationCoordinates &nbsp;·&nbsp;
              <span class="ekf">EKF</span> = filtered estimate &nbsp;·&nbsp;
              <span class="dlt">Δ</span> = |GPS − EKF| &nbsp;·&nbsp;
              — = field not provided by browser/device
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

    <button id="btn-clear" @click="clearTable">Clear table</button>
  </div>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; padding: 1.25rem;
       background: #0f172a; color: #e2e8f0; }

h1   { font-size: 1.1rem; margin-bottom: 0.75rem; color: #93c5fd; }
h2   { font-size: 1rem; margin-bottom: 0.5rem; color: #93c5fd; }

.status {
  margin-bottom: 0.75rem; padding: 0.45rem 0.75rem;
  border-radius: 6px; background: #1e293b;
  font-size: 0.82rem; color: #94a3b8;
}
.status.ok   { color: #4ade80; }
.status.warn { color: #facc15; }
.status.err  { color: #f87171; }

.graphs { margin-bottom: 1rem; }
.graphs > div { margin-bottom: 1rem; }

.table-wrap { overflow-x: auto; }

table {
  border-collapse: collapse; width: 100%;
  font-size: 0.78rem; white-space: nowrap;
}
th {
  background: #1e3a5f; color: #93c5fd;
  padding: 6px 10px; text-align: right;
}
th:first-child { text-align: left; }
td {
  padding: 5px 10px; text-align: right;
  border-bottom: 1px solid #1e293b;
}
td:first-child { text-align: left; font-variant-numeric: tabular-nums; color: #64748b; }
tr:hover td { background: #1e293b; }

.gps  { color: #7dd3fc; }
.ekf  { color: #86efac; }
.null { color: #475569; font-style: italic; }
.dlt  { color: #fcd34d; }

tfoot td {
  padding-top: 0.6rem; font-size: 0.72rem;
  color: #475569; text-align: left;
  white-space: normal; border: none;
}

#btn-clear {
  margin-top: 0.9rem; padding: 0.35rem 1rem;
  background: #374151; border: none; border-radius: 5px;
  color: #e2e8f0; cursor: pointer; font-size: 0.82rem;
}
#btn-clear:hover { background: #4b5563; }
</style>