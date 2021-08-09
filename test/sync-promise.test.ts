import {SyncPromise3 as SyncPromise, SyncPromise3} from '../src/sync-promise'

test('sync promise', () => {
  const result = SyncPromise.resolve(123)
    .then(x => x * 2)
    .then(x => [x, x])
    .unwrap()

  expect(result).toEqual([246, 246])
})

test('flatten then result', () => {
  const result = SyncPromise.resolve(123)
    .then(x => x * 2)
    .then(x => SyncPromise3.resolve(x))
    .unwrap()

  expect(result).toEqual(246)
})

test('catch', () => {
  const result = SyncPromise.resolve(123)
    .then(x => x * 2)
    .then(x => {
      throw new Error(`Bad value: ${x}`)
    })
    .catch(e => `Failure message: ${e}`)
    .then(message => message + '!')
    .unwrap()

  expect(result).toEqual(`Failure message: Error: Bad value: 246!`)
})

test('reject', () => {
  const result = SyncPromise.resolve(123)
    .then(x => x * 2)
    .then(x => SyncPromise.reject(Error(`Bad value: ${x}`)))
    .catch(e => `Failure message: ${e}`)
    .then(message => message + '!')
    .unwrap()

  expect(result).toEqual(`Failure message: Error: Bad value: 246!`)
})

test('then with catch arg', () => {
  const f = (input: number) => {
    return SyncPromise.resolve(input)
      .then(x => {
        if (x > 100) {
          throw new Error(`value > 100`)
        }
        return x
      })
      .then(
        val => `Got value: ${val}`,
        e => `Failure message: ${e}`,
      )
  }

  expect(f(50).unwrap()).toEqual(`Got value: 50`)
  expect(f(150).unwrap()).toEqual(`Failure message: Error: value > 100`)
})
