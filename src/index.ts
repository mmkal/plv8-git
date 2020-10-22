import * as git from './git'

export {SyncPromise} from './sync-promise'

/**
 * Turn a promise-returning function into a synchronous one. Only works if the function uses
 * `SyncPromise` under the hood.
 */
export const syncify = <A extends unknown[], R>(func: (...args: A) => Promise<R>) => (...args: A) => {
  let result!: R
  func(...args).then(r => (result = r))
  return result!
}

export const rowToRepo = syncify(git.rowToRepo)
export const gitLog = syncify(git.gitLog)
