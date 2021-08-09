import {plog} from './pg-log'

const rethrow = (e: any) => {
  plog('stackkkk', e.stack)
  throw new Error(`${e && e.stack}`)
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
      return SyncPromise0.resolve(next)
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
export const SyncPromise0: Pick<typeof Promise, 'resolve' | 'reject' | 'all'> = {
  resolve: ((val?: any): Promise<any> =>
    val && typeof val.then === 'function' ? val : createSyncPromise(val)) as typeof Promise.resolve,
  reject: rethrow,
  all: (((promises: any[]) =>
    SyncPromise0.resolve(
      promises.map(p => {
        let result: any = null
        SyncPromise0.resolve(p).then((value: unknown) => (result = {value}))
        return result.value
      }),
    )) as unknown) as typeof Promise.all,
}

import {Either, Right, Left} from 'purify-ts/Either'

function tryCatch<T, U>(attempt: () => T, recovery: (e: unknown) => U) {
  try {
    return attempt()
  } catch (e) {
    return recovery(e)
  }
}

export class SyncPromise3<T> {
  static resolve<U>(value: U) {
    return new SyncPromise3(Right(value))
  }
  static reject(error: unknown) {
    return new SyncPromise3(Left(error))
  }

  static unwrap<T>(promise: PromiseLike<T>): T {
    if (promise instanceof SyncPromise3) {
      return promise.unwrap()
    }

    throw new Error(`Expected a sync promise. Got a ${promise.constructor} ${typeof promise}`)
  }

  private static flattenToEither<T>(value: SyncPromise3<T> | T) {
    return value instanceof SyncPromise3 ? value.either : Right(value)
  }

  private constructor(readonly either: Either<unknown, T>) {}

  unwrap() {
    return this.either.caseOf({
      Left: rethrow,
      Right: val => val,
    })
  }

  then<U>(
    onok: (value: T) => U | SyncPromise3<U> = value => value as any,
    onerror: (error: unknown) => U | SyncPromise3<U> = rethrow,
  ): SyncPromise3<U> {
    return new SyncPromise3(
      this.either.caseOf({
        Right: value => tryCatch(() => SyncPromise3.flattenToEither(onok(value)), Left),
        Left: err => tryCatch(() => SyncPromise3.flattenToEither(onerror(err)), Left),
      }),
    )
  }

  catch<U>(onerror: (error: unknown) => U) {
    return this.then<T | U>(x => x, onerror)
  }
}

export class SyncPromise2<T> {
  static resolve<U>(value: U) {
    return new SyncPromise2(() => value)
  }
  static reject(error: unknown) {
    return new SyncPromise2(() => error).then(rethrow)
  }

  private constructor(readonly getValue: () => T) {}

  then<U>(onok: (value: T) => U = value => value as any, onerror: (error: unknown) => U = rethrow) {
    return new SyncPromise2<U>(() => {
      try {
        return onok(this.getValue())
      } catch (e) {
        return onerror(e)
      }
    })
  }

  catch<U>(onerror: (error: unknown) => U = rethrow) {
    return new SyncPromise2<T | U>(() => {
      try {
        return this.getValue()
      } catch (e) {
        console.log('caught', e, onerror.toString())
        return onerror(e)
      }
    })
  }
}
