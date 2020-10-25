import {inspect} from 'util'

declare const plv8: any, WARNING: any

/**
 * Wrapper for `plv8.elog` which outputs to a `docker-compose up` console.
 */
export const plog = (...args: any[]): undefined => {
  if (typeof plv8 === 'undefined') return
  // inspect is an easy way to pretty-print any value
  const s = inspect(args).slice(1, -1).trim()
  // if it's on multiple lines, start it on its own line
  const formatted = s.includes('\n') ? `|||\n  ${s}` : s

  plv8.elog(WARNING, formatted)
}

/**
 * stupid function that lets you do `debugPromise('some message').set = _someComplicatedFunctionCall`
 * which is useful when you want to inspect a giant expression without wrapping it parens
 * (some babel-webpack loaders wrap async calls in crazy expressions which makes them hard to read)
 */
export const debugPromise = (m: any, dbg: any) => {
  dbg && plog('about to kick off', m)
  const o = {}
  Object.defineProperty(o, 'set', {
    // prettier-ignore
    // pseudoset val
    set: val => {
      const promiseType = val instanceof Promise ? 'EVIL promise' : val.syncPromise ? 'nice promise' : 'some kinda thing'
      const plogArgs = [`${m} ${val} is ${promiseType}`]
      if (dbg) {
        plogArgs.push('. It will resolve to', val.val)
      }
      plog(...plogArgs)
      return val
    },
  })
  return o
}

const start = Date.now()
let current = start

/** useful for timing. just call `checkpoint('foo')` for timing info to be printed */
export const checkpoint = (name: string) => {
  const previous = current
  current = Date.now()
  plog(['checkpoint', name, current - previous, 'since previous and ', current - start, 'since start'].join(' '))
}
