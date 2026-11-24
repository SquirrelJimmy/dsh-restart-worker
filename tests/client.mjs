/**
 * dsh-restart client-bundle registration tests.
 *
 * Executes the emitted `lib/client.js` inside a synthetic
 * `window.__ModuleLoader__` + a small fake DOM, so the browser half is verified
 * without a browser or a host restart.
 *
 * The old placement tests pinned the shared footer-row injection. DSH 0.2.3
 * exposes the New-session row through `sidebar.session.action`; this suite now
 * pins the two slot registrations and proves the bundle no longer reaches into
 * `settingsArea` or creates a DOM fallback ball.
 *
 * Run `npm run build` first: the suite exercises lib/client.js, not src/.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

let passed = 0
let failed = 0

function check(label, condition, detail = '') {
  if (condition) {
    passed++
    console.log('  ✔ ' + label)
  } else {
    failed++
    console.error('  ✘ ' + label + (detail ? ' — ' + detail : ''))
  }
}

/* ------------------------------------------------------------------ */
/* A tiny fake DOM, enough for the overlay mount                      */
/* ------------------------------------------------------------------ */

function makeNode(tag) {
  const node = {
    tagName: tag,
    dataset: {},
    style: {},
    id: '',
    textContent: '',
    parentNode: null,
    children: [],
    appendChild(child) {
      child.parentNode = node
      node.children.push(child)
      return child
    },
    insertBefore(child, reference) {
      const index = reference === null ? node.children.length : node.children.indexOf(reference)
      if (index < 0) throw new Error('insertBefore: reference is not a child')
      child.parentNode = node
      node.children.splice(index, 0, child)
      return child
    },
    removeChild(child) {
      const index = node.children.indexOf(child)
      if (index >= 0) node.children.splice(index, 1)
      child.parentNode = null
      return child
    },
    querySelector() {
      return null
    },
    querySelectorAll() {
      return []
    },
    contains(other) {
      if (other === node) return true
      return node.children.some((child) => child.contains(other))
    },
  }
  return node
}

const documentRoot = makeNode('html')
const head = makeNode('head')
const body = makeNode('body')
documentRoot.appendChild(head)
documentRoot.appendChild(body)

function makeDocument() {
  return {
    head,
    body,
    visibilityState: 'visible',
    hidden: false,
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    createElement: (tag) => makeNode(tag),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getElementById: (id) => {
      const walk = (node) => {
        for (const child of node.children) {
          if (child.id === id) return child
          const found = walk(child)
          if (found !== null) return found
        }
        return null
      }
      return walk(documentRoot)
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  }
}

/* ------------------------------------------------------------------ */
/* Globals the browser half expects outside of the injected parameters */
/* ------------------------------------------------------------------ */

function defineGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}

const storageStub = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}
defineGlobal('sessionStorage', storageStub)
defineGlobal('localStorage', storageStub)
defineGlobal('navigator', { userAgent: 'node-test', language: 'zh-CN' })
globalThis.fetch = async () => {
  throw new Error('offline in test')
}

const code = await readFile(path.join(here, '..', 'lib', 'client.js'), 'utf8')

console.log('\n[1] bundle 形状')
check('带 __ModuleLoader__.load 包裹', code.includes('window.__ModuleLoader__.load('))
check('声明了插件 id', code.includes('"dsh-restart-worker"') || code.includes("'dsh-restart-worker'"))
check('不再注入 settingsArea DOM', !code.includes('settingsArea'))
check('不再注入共用的横向行', !code.includes('dsh-sidebar-row'))
check('不再创建旧的 DOM 入口', !code.includes('dsh-restart-entry'))
check('声明了侧栏槽位', code.includes('sidebar.session.action'))
check('overlay 使用独立样式命名空间', code.includes('overlay.v2.css') && code.includes('dshrst-root'))
check('主按钮使用 foreground token 且无未替换占位符', code.includes('label-primary-foreground') && !code.includes('{{'))
check('包含 Desktop Host surface', code.includes('DSH Host') && code.includes('重启 DSH Host'))
check('Desktop 明确只重启 host', code.includes('Electron 主进程') && code.includes('不退出桌面应用'))

console.log('\n[2] 外部依赖白名单')
const requiredModules = [...code.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1])
const outsideTable = requiredModules.filter(
  (id) => !['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'].includes(id),
)
check('只 require 模块表里的包', outsideTable.length === 0, outsideTable.join(', '))

/** Evaluate the bundle and collect its slot registrations. */
function evaluate(documentStub) {
  const React = require('react')
  const jsxRuntime = require('react/jsx-runtime')
  const recorded = { loaded: null, roots: 0 }
  const fakeRequire = (id) => {
    if (id === 'react') return React
    if (id === 'react/jsx-runtime') return jsxRuntime
    if (id === 'react-dom/client') {
      return {
        createRoot: () => {
          recorded.roots++
          return { render: () => undefined, unmount: () => undefined }
        },
      }
    }
    if (id === 'react-dom') return {}
    throw new Error('unexpected require in client bundle: ' + id)
  }
  const windowStub = {
    __ModuleLoader__: {
      load: (spec) => {
        recorded.loaded = spec
      },
    },
    matchMedia: () => ({ matches: false }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setTimeout: (fn) => fn(),
    clearTimeout: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
    location: { origin: 'http://127.0.0.1:3080', href: 'http://127.0.0.1:3080/', reload: () => undefined },
  }
  const moduleStub = { exports: {} }
  const factoryFn = new Function(
    'require', 'module', 'exports', 'window', 'document', 'getComputedStyle',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    code,
  )
  factoryFn(
    fakeRequire, moduleStub, moduleStub.exports, windowStub, documentStub,
    () => ({ backgroundColor: 'rgba(0, 0, 0, 0)' }),
    (fn) => fn(), () => undefined, () => 0, () => undefined,
  )
  const exports = recorded.loaded.factory(fakeRequire)
  return { exports, recorded }
}

const documentStub = makeDocument()
const run = evaluate(documentStub)
const registrations = []
const injections = []
const ctx = {
  slots: {
    inject: (name, callback) => {
      injections.push(name)
      callback()
    },
    register: (options, component) => {
      registrations.push({ options, component })
      return () => undefined
    },
  },
}

console.log('\n[3] 槽位注册')
run.exports.apply(ctx)
const settings = registrations.find((item) => item.options.name === 'settings.section')
const sidebar = registrations.find((item) => item.options.name === 'sidebar.session.action')
check('注册了设置卡片', settings !== undefined)
check('设置卡片 id = restart', settings?.options.id === 'restart', String(settings?.options.id))
check('设置卡片 order = 338', settings?.options.order === 338, String(settings?.options.order))
check('设置卡片标题为「重启」', settings?.options.label?.() === '重启')
check('注册了侧栏动作', sidebar !== undefined)
check('侧栏动作 id = restart', sidebar?.options.id === 'restart', String(sidebar?.options.id))
check('侧栏动作 order = 100（位于上传按钮左侧）', sidebar?.options.order === 100, String(sidebar?.options.order))
check('侧栏动作是组件函数', typeof sidebar?.component === 'function')
check('只注入了 settings.section 与 sidebar.session.action', injections.join(',') === 'settings.section,sidebar.session.action')

console.log('\n[4] 不再创建 DOM 入口')
check('没有旧的入口容器', documentStub.getElementById('dsh-restart-entry') === null)
check('遮罩根已挂载（v2 独立 root）', documentStub.getElementById('dsh-restart-overlay-root-v2') !== null)
check('只创建了一个 React root', run.recorded.roots === 1, String(run.recorded.roots))

console.log('\n' + (failed === 0 ? '全部通过' : '有失败项') + '：' + passed + ' passed, ' + failed + ' failed\n')
process.exit(failed === 0 ? 0 : 1)
