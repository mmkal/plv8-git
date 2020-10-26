const rethrow = (e: unknown) => {
  throw e
}

const createSyncPromise = (val: any): any => {
  const self = {
    syncPromise: true,
    val,
    then: (onok = (x: any) => x, onerr = rethrow) => {
      let next
      try {
        next = onok(val)
      } catch (e) {
        next = onerr(e)
      }
      return SyncPromise.resolve(next)
    },
    catch: () => {
      throw Error(`catch not supported by sync promises`)
    },
  }
  return self
}

/**
 * A partial replacement implementation of `Promise` which _doesn't_ use the event loop. plv8 triggers
 * require return values synchronously, so this executes the `.then` callbacks immediately. It doesn't
 * support `.catch` because errors are thrown synchronously too.
 */
export const SyncPromise: Pick<typeof Promise, 'resolve' | 'reject' | 'all'> = {
  resolve: ((val?: any): Promise<any> =>
    val && typeof val.then === 'function' ? val : createSyncPromise(val)) as typeof Promise.resolve,
  reject: rethrow,
  all: (((promises: any[]) =>
    SyncPromise.resolve(
      promises.map(p => {
        let result: any = null
        SyncPromise.resolve(p).then((value: unknown) => (result = {value}))
        return result.value
      }),
    )) as unknown) as typeof Promise.all,
}
