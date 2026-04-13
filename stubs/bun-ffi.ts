/**
 * Stub for bun:ffi — missing in Node, used for libc/prctl in Linux containers.
 * This satisfies TypeScript and provides a no-op implementation for Mac/Node.
 */

export function dlopen(path: string, symbols: Record<string, any>): any {
  // Return a proxy that returns a no-op function for any symbol requested
  return {
    symbols: new Proxy({}, {
      get(_target, prop) {
        return () => {
          console.warn(`[bun:ffi stub] dlopen symbol called: ${String(prop)} (no-op)`)
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
