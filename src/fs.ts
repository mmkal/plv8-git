import * as memfs from 'memfs'

/**
 * isomorphic-git calls the async versions of file system APIs. But they _can_ all execute synchronously.
 * So shim all the promisified functions to just call the sync equivalents.
 */
export const setupMemfs = () => {
  const vol = new memfs.Volume()
  const fs = memfs.createFsFromVolume(vol)
  Object.assign(fs, {
    promises: {
      // shim the "promises" to be actually sync!
      readFile: fs.readFileSync.bind(fs),
      writeFile: fs.writeFileSync.bind(fs),
      mkdir: fs.mkdirSync.bind(fs),
      rmdir: fs.rmdirSync.bind(fs),
      unlink: fs.unlinkSync.bind(fs),
      stat: fs.statSync.bind(fs),
      lstat: fs.lstatSync.bind(fs),
      readdir: fs.readdirSync.bind(fs),
      readlink: fs.readlinkSync.bind(fs),
      symlink: fs.symlinkSync.bind(fs),
    },
  })
  return {fs, vol}
}
