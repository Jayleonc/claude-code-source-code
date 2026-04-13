#!/usr/bin/env node
/**
 * prepare-src.mjs — Pre-build source transformation
 *
 * This script patches the source tree to make it compilable without Bun:
 *   1. Replace `import { feature } from 'bun:bundle'` with our stub
 *   2. Replace `MACRO.X` references with runtime values
 *   3. Create missing type declarations
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')

const VERSION = '2.1.88'

// ── Helpers ──────────────────────────────────────────────────────────────────

function walk(dir, ext = '.ts') {
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...walk(full, ext))
    } else if (entry.name.endsWith(ext) || entry.name.endsWith('.tsx')) {
      results.push(full)
    }
  }
  return results
}

function patchFile(filePath) {
  let src = fs.readFileSync(filePath, 'utf8')
  let changed = false

  // 1. Replace `import { feature } from 'bun:bundle'` / `"bun:bundle"`
  if (src.includes("from 'bun:bundle'") || src.includes('from "bun:bundle"')) {
    src = src.replace(/import\s*\{\s*feature\s*\}\s*from\s*['"]bun:bundle['"]/g,
      "import { feature } from '../stubs/bun-bundle.js'")
    // Fix relative depth based on file location
    const rel = path.relative(SRC, path.dirname(filePath))
    const depth = rel ? '../'.repeat(rel.split('/').length) : ''
    if (depth) {
      src = src.replace("from '../stubs/bun-bundle.js'", `from '${depth}stubs/bun-bundle.js'`)
    }
    changed = true
  }

  // 2. Replace MACRO.X with string literals
  const macroReplacements = {
    'MACRO.VERSION': `'${VERSION}'`,
    'MACRO.BUILD_TIME': `'${new Date().toISOString()}'`,
    'MACRO.FEEDBACK_CHANNEL': `'https://github.com/anthropics/claude-code/issues'`,
    'MACRO.ISSUES_EXPLAINER': `'https://github.com/anthropics/claude-code/issues/new/choose'`,
    'MACRO.NATIVE_PACKAGE_URL': `'@anthropic-ai/claude-code'`,
    'MACRO.PACKAGE_URL': `'@anthropic-ai/claude-code'`,
    'MACRO.VERSION_CHANGELOG': `''`,
  }

  for (const [macro, replacement] of Object.entries(macroReplacements)) {
    if (src.includes(macro)) {
      // Don't replace inside strings
      const macroRegex = new RegExp(`(?<![\\w'"])${macro.replace('.', '\\.')}(?![\\w'" ])`, 'g')
      if (macroRegex.test(src)) {
        src = src.replace(macroRegex, replacement)
        changed = true
      }
    }
  }

  // 3. Patch require('bun:ffi') if present
  if (src.includes("require('bun:ffi')") || src.includes('require("bun:ffi")')) {
    const rel = path.relative(SRC, path.dirname(filePath))
    const depth = rel ? '../'.repeat(rel.split('/').length) : ''
    const stubPath = depth ? `${depth}stubs/bun-ffi.js` : './stubs/bun-ffi.js'
    src = src.replace(/require\(['"]bun:ffi['"]\)/g, `require('${stubPath}')`)
    changed = true
  }

  // 4. Strip .js extensions from relative imports (decompiled ESM artifacts)
  if (src.includes("from './") || src.includes('from "../') || src.includes("require('./") || src.includes('require("../') || src.includes("import('./") || src.includes('import("../')) {
    const original = src
    // Covers: from './foo.js', require('./foo.js'), import('./foo.js')
    src = src.replace(/((?:from|require|import)\s*\(?\s*['"]\.\.?\/[^'"]+)\.js(['"\)])/g, '$1$2')
    if (src !== original) changed = true
  }

  if (changed) {
    fs.writeFileSync(filePath, src, 'utf8')
    return true
  }
  return false
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('🔧 Preparing source files...\n')

const files = walk(SRC)
let patched = 0

for (const file of files) {
  if (patchFile(file)) {
    patched++
    console.log(`  patched: ${path.relative(ROOT, file)}`)
  }
}

// Create stub for bun:ffi (only used in upstreamproxy)
const ffiStub = path.join(ROOT, 'stubs', 'bun-ffi.ts')
if (!fs.existsSync(ffiStub)) {
  fs.writeFileSync(ffiStub, `/**
 * Stub for bun:ffi — missing in Node, used for libc/prctl in Linux containers.
 * This satisfies TypeScript and provides a no-op implementation for Mac/Node.
 */

export function dlopen(path: string, symbols: Record<string, any>): any {
  // Return a proxy that returns a no-op function for any symbol requested
  return {
    symbols: new Proxy({}, {
      get(_target, prop) {
        return () => {
          console.warn(\`[bun:ffi stub] dlopen symbol called: \${String(prop)} (no-op)\`)
          return 0
        }
      }
    }),
    close: () => {}
  }
}

export function ptr(_val: any): any { return 0 }
export function toArrayBuffer(_ptr: any, _offset?: number, _length?: number): ArrayBuffer { return new ArrayBuffer(0) }
export function viewSource(_ptr: any, _length?: number): Uint8Array { return new Uint8Array(0) }

export const CString = 'cstring'
export const i32 = 'i32'
export const u32 = 'u32'
export const i64 = 'i64'
export const u64 = 'u64'
export const f32 = 'f32'
export const f64 = 'f64'
export const bool = 'bool'
export const ptr_type = 'ptr'
export const void_type = 'void'
`)
  console.log('  created: stubs/bun-ffi.ts')
}

// Create global MACRO type declaration
const macroDecl = path.join(ROOT, 'stubs', 'global.d.ts')
fs.writeFileSync(macroDecl, `// Global compile-time macros (normally injected by Bun bundler)
declare const MACRO: {
  VERSION: string
  BUILD_TIME: string
  FEEDBACK_CHANNEL: string
  ISSUES_EXPLAINER: string
  NATIVE_PACKAGE_URL: string
  PACKAGE_URL: string
  VERSION_CHANGELOG: string
}

declare const Bun: any;
`)
console.log('  created: stubs/global.d.ts')

// 3. Create missing stubs for relative imports
console.log('\n🔍 Finding and stubbing missing relative imports...')
const missingEntries = new Set()

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8')
  // Match relative imports: import from './foo' or require('./foo')
  const relativeRe = /(?:from|require)\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g
  const relativeFromRe = /from\s+['"](\.[^'"]+)['"]/g
  
  const collectMissing = (re) => {
    let m
    while ((m = re.exec(content)) !== null) {
      let rel = m[1]
      // Strip .js from the end if it's there, as we already stripped it from src or will use .ts stubs
      if (rel.endsWith('.js')) rel = rel.slice(0, -3)
      const absBase = path.resolve(path.dirname(file), rel)
      
      // Extensions to check
      const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.json']
      let found = false
      for (const ext of exts) {
        if (fs.existsSync(absBase + ext)) {
          found = true
          break
        }
      }
      
      if (!found) {
        // Normalize for src folder stubbing
        if (absBase.startsWith(SRC) || absBase.includes('/stubs/')) {
          missingEntries.add(absBase)
        }
      }
    }
  }
  
  collectMissing(relativeRe)
  collectMissing(relativeFromRe)
}

let stubCount = 0
for (const absBase of missingEntries) {
  const dir = path.dirname(absBase)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  
  // Create TS stub by default
  const stubPath = absBase.endsWith('.json') ? absBase : absBase + '.ts'
  if (!fs.existsSync(stubPath)) {
    const basename = path.basename(absBase)
    const safeName = basename.replace(/[^a-zA-Z0-9_$]/g, '_') || 'stub'
    const content = absBase.endsWith('.json') ? '{}' : `// Auto-generated stub for ${basename}\nexport default {} as any\nexport const ${safeName} = {} as any\n`
    fs.writeFileSync(stubPath, content)
    stubCount++
    if (stubCount < 50) console.log(`  created stub: ${path.relative(ROOT, stubPath)}`)
  }
}
if (stubCount >= 50) console.log(`  ... and ${stubCount - 50} more stubs created.`)
else if (stubCount > 0) console.log(`\n✅ Created ${stubCount} missing relative stubs`)

console.log(`\n✅ Patched ${patched} / ${files.length} source files`)
