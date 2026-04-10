<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { RobustAdaptiveEKF } from '../util/robustEKF'
import uPlot from 'uplot'

const status = ref('Waiting for geolocation permission…')
const statusClass = ref('')
const isRunning = ref(true)

// Current values
const gpsSpd = ref<number | null>(null)
const gpsHdg = ref<number | null>(null)
const gpsAcc = ref<number | null>(null)
const ekfSpd = ref(0)
const ekfHdg = ref(0)
const dSpd = ref<number | null>(null)
const dHdg = ref<number | null>(null)

let ekf: RobustAdaptiveEKF | null = null
let lastTime: number | null = null

// Graphs
let speedPlot: uPlot
let headingPlot: uPlot
let speedData: [number[], number[], number[]]
let headingData: [number[], number[], number[]]
const MAX_POINTS = 100

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

  const currentEkfSpd = ekf.getSpeedKmh()
  const currentEkfHdg = ekf.getHeadingDeg()

  const currentGpsSpd = speed != null ? speed * 3.6 : null
  const currentGpsHdg = heading != null ? heading : null

  const currentDSpd = currentGpsSpd != null ? Math.abs(currentGpsSpd - currentEkfSpd) : null
  const currentDHdg = currentGpsHdg != null ? (() => {
    const d = Math.abs(currentGpsHdg - currentEkfHdg) % 360
    return d > 180 ? 360 - d : d
  })() : null

  // Update current values
  gpsSpd.value = currentGpsSpd
  gpsHdg.value = currentGpsHdg
  gpsAcc.value = accuracy
  ekfSpd.value = currentEkfSpd
  ekfHdg.value = currentEkfHdg
  dSpd.value = currentDSpd
  dHdg.value = currentDHdg

  // Update graphs
  if (isRunning.value) {
    speedData[0].push(now / 1000) // time in seconds
    speedData[1].push(gpsSpd.value ?? NaN)
    speedData[2].push(ekfSpd.value)
    if (speedData[0].length > MAX_POINTS) {
      speedData[0].shift()
      speedData[1].shift()
      speedData[2].shift()
    }
    speedPlot.setData(speedData)

    headingData[0].push(now / 1000)
    headingData[1].push(gpsHdg.value ?? NaN)
    headingData[2].push(ekfHdg.value)
    if (headingData[0].length > MAX_POINTS) {
      headingData[0].shift()
      headingData[1].shift()
      headingData[2].shift()
    }
    headingPlot.setData(headingData)
  }

  const accClass = accuracy < 20 ? 'ok' : 'warn'
  status.value = `acc ${accuracy.toFixed(0)} m · dt ${dtSec.toFixed(1)} s · EKF ${ekfSpd.value.toFixed(1)} km/h @ ${ekfHdg.value.toFixed(0)}°`
  statusClass.value = accClass
}

function onError() {
  status.value = 'Location is unavailable'
  statusClass.value = 'err'
}

function toggleGraphs() {
  isRunning.value = !isRunning.value
}

onMounted(() => {
  // Initialize graphs
  speedData = [[], [], []]
  headingData = [[], [], []]

  const opts: uPlot.Options = {
    width: 400,
    height: 150,
    scales: {
      x: { time: true },
    },
    axes: [
      {
        stroke: '#e2e8f0',
        grid: { stroke: '#1e293b' },
      },
      {
        stroke: '#e2e8f0',
        grid: { stroke: '#1e293b' },
      },
    ],
    series: [
      {},
      {
        stroke: '#7dd3fc',
        width: 2,
      },
      {
        stroke: '#86efac',
        width: 2,
      },
    ],
  }

  speedPlot = new uPlot(opts, speedData, document.getElementById('speed-canvas') as HTMLDivElement)
  headingPlot = new uPlot(opts, headingData, document.getElementById('heading-canvas') as HTMLDivElement)

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
        <div id="speed-canvas" style="width: 100%; height: 150px;"></div>
      </div>
      <div>
        <h2>Heading (°)</h2>
        <div id="heading-canvas" style="width: 100%; height: 150px;"></div>
      </div>
    </div>

    <div class="table-wrap">
      <table id="log">
        <thead>
          <tr>
            <th></th>
            <th>Raw</th>
            <th>Filtered</th>
            <th>Delta</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Speed</th>
            <td :class="gpsSpd == null ? 'null' : 'gps'">{{ gpsSpd == null ? '—' : fmt1(gpsSpd) }}</td>
            <td class="ekf">{{ ekfSpd.toFixed(1) }}</td>
            <td :class="dSpd == null ? 'null' : 'dlt'">{{ dSpd == null ? '—' : fmt1(dSpd) }}</td>
          </tr>
          <tr>
            <th>Heading</th>
            <td :class="gpsHdg == null ? 'null' : 'gps'">{{ gpsHdg == null ? '—' : fmt1(gpsHdg) }}</td>
            <td class="ekf">{{ ekfHdg.toFixed(1) }}</td>
            <td :class="dHdg == null ? 'null' : 'dlt'">{{ dHdg == null ? '—' : fmt1(dHdg) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="4">
              <span class="gps">Raw</span> = GPS &nbsp;·&nbsp;
              <span class="ekf">Filtered</span> = EKF &nbsp;·&nbsp;
              <span class="dlt">Delta</span> = |Raw − Filtered| &nbsp;·&nbsp;
              — = not available
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

    <button id="btn-toggle" @click="toggleGraphs">{{ isRunning ? 'Stop' : 'Start' }} graphs</button>
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
  font-size: 1.2rem; white-space: nowrap;
  table-layout: fixed;
}
th {
  background: #334155; color: #93c5fd;
  padding: 6px 5px; text-align: right;
  width: 25%;
}
th:first-child { text-align: left; width: 25%; }
td {
  padding: 5px 5px; text-align: right;
  border-bottom: 2px solid #374151;
  background: #0f172a;
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

#btn-toggle {
  margin-top: 0.9rem; margin-left: 1rem; padding: 0.35rem 1rem;
  background: #374151; border: none; border-radius: 5px;
  color: #e2e8f0; cursor: pointer; font-size: 0.82rem;
}
#btn-toggle:hover { background: #4b5563; }
</style>