import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const url = 'http://127.0.0.1:5173/index.html'

test.before(async () => {
  const { spawn } = await import('node:child_process')
  globalThis.server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: '5173' },
    stdio: 'ignore'
  })
  const { default: net } = await import('node:net')
  await new Promise((resolve) => {
    const retry = () => {
      const socket = net.connect(5173, '127.0.0.1')
      socket.on('connect', () => { socket.destroy(); resolve() })
      socket.on('error', () => setTimeout(retry, 100))
    }
    retry()
  })
})

test.after(() => globalThis.server.kill())

test('浏览器端：渲染、覆盖度零差异、拖动后缓存恢复', async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => {
    const table = document.querySelector('#coverageTable')
    return table && table.textContent.includes('IoU')
  }, { timeout: 15000 })

  const report = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#coverageTable tr')]
      .map((row) => row.innerText.replace(/\t/g, '='))
    return rows
  })
  const iouLine = report.find((line) => line.includes('IoU'))
  assert.ok(iouLine.endsWith('1.000000'), `IoU 应为 1，实际 ${iouLine}`)
  const diffLine = report.find((line) => line.includes('对称差'))
  assert.ok(diffLine.endsWith('=0'), `对称差应为 0，实际 ${diffLine}`)

  const canvasState = await page.evaluate(() => {
    const canvas = document.querySelector('#map canvas')
    return { width: canvas.width, height: canvas.height }
  })
  assert.equal(canvasState.width, 1280)
  assert.equal(canvasState.height, 800)

  await page.evaluate(() => document.querySelector('#clearCache').click())
  await page.waitForTimeout(300)
  await page.mouse.move(640, 400)
  await page.mouse.down()
  await page.mouse.move(300, 250, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  await page.mouse.move(300, 250)
  await page.mouse.down()
  await page.mouse.move(640, 400, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(800)

  const cache = await page.evaluate(() => {
    const rows = Object.fromEntries([...document.querySelectorAll('#cacheTable tr')]
      .map((row) => [row.cells[0].textContent, row.cells[1].textContent]))
    return rows
  })
  assert.ok(Number(cache['命中次数']) > 0, '拖回视口后应命中缓存')
  assert.ok(cache['命中率'].replace('%', '') > 0)

  const logText = await page.textContent('#cacheLog')
  assert.ok(logText.includes('命中缓存') || logText.includes('命中'))
  assert.deepEqual(errors, [])
  await browser.close()
})
