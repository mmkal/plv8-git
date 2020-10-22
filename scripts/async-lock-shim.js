/**
 * A dumb webpack loader that bypasses everything the `async-lock` module does.
 * async-lock uses clever timers to ensure operations don't conflict with each other.
 * That's not a concern in this project's use-case, because all operations happen synchronously on
 * an ephemeral in-memory filesystem, so conflicts aren't possible. And postgres doesn't have an
 * event loop, so async function won't work.
 * @type {(source: string) => string}
 */
module.exports = function (source) {
  return source.replace(
    /AsyncLock.prototype.acquire = function/,
    `
      AsyncLock.prototype.acquire = function (key, fn) {
        return fn(); // no locking! Not needed because everything's synchronous; not possible because everything's synchronous
      }

      AsyncLock.prototype.acquire_original = function
    `,
  )
}
