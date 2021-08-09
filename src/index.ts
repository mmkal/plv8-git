import * as git from './git'
import {plog} from './pg-log'
import {SyncPromise0} from './sync-promise'

export {SyncPromise0 as SyncPromise} from './sync-promise'

export * from './git'

/**
 * Calls a function from the `./git` module.
 * Turn a promise-returning function into a synchronous one. Only works if the function uses
 * `.then` rather than `async`/`await`, and doesn't use timers/the event loop.
 * @param name the name of the function from the `./git` module
 * @param args args that will be passed directly to the function
 */
export const git_call_sync = (name: keyof typeof git, args: any[]) => {
  Object.assign(Promise, SyncPromise0)
  Object.assign(console, {log: plog})
  const operation: (...args: any[]) => Promise<any> = git[name]
  let result
  operation(...args).then(r => (result = r))
  return result
}
