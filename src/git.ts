import * as memfs from 'memfs'
import * as path from 'path'
import * as git from 'isomorphic-git'
import * as serializer from './serializer'
import {SyncPromise} from './sync-promise'
import {PG_Vars} from './pg-types'
import {setupMemfs} from './fs'

function writeGitFiles(gitFiles: any, fs: memfs.IFs) {
  Object.keys(gitFiles).map(filepath => {
    fs.mkdirSync(path.dirname(filepath), {recursive: true})
    fs.writeFileSync(filepath, Buffer.from(gitFiles[filepath]))
  })
}

/**
 * Implementation for a trigger function which takes a row as a hashmap, and returns
 * a new value with a `git` json property, representing the `.git` folder of a repo.
 * Note - a different column name can be passed to `TG_ARGV`.
 */
export const rowToRepo = ({OLD, NEW, ...pg}: PG_Vars) => {
  const {fs, vol} = setupMemfs()
  const repo = {fs, dir: '/repo'}
  const repoColumn = pg.TG_ARGV[0] || 'git'
  if (pg.TG_ARGV[0] && repoColumn.match(/\W/)) {
    throw new Error(`Invalid column name ${repoColumn}`)
  }

  const setupGitFolder =
    pg.TG_OP === 'INSERT' ? () => git.init({...repo, defaultBranch: 'main'}) : () => writeGitFiles(OLD![repoColumn], fs)

  const commitMessage = `${pg.TG_NAME}: ${pg.TG_WHEN} ${pg.TG_OP} ${pg.TG_LEVEL} on ${pg.TG_TABLE_SCHEMA}.${pg.TG_TABLE_NAME}`.trim()

  return SyncPromise.resolve()
    .then(setupGitFolder)
    .then(() => {
      if (!NEW) return
      Object.keys(NEW)
        .filter(k => k !== repoColumn)
        .forEach((k, i) => {
          const val = NEW[k]
          const content = serializer.stringify(val)
          const filepath = `${repo.dir}/${k.replace(/\W/g, '_')}`
          fs.writeFileSync(filepath, content, {encoding: 'utf8'})
        })
      return SyncPromise.resolve()
        .then(() => git.add({...repo, filepath: '.'}))
        .then(() =>
          git.commit({
            ...repo,
            message: [NEW?.[repoColumn]?.commit?.message, commitMessage].filter(Boolean).join('\n\n'),
            author: {name: 'pguser', email: 'pguser@pg.com', ...NEW?.[repoColumn]?.commit?.author},
          }),
        )
    })
    .then(() => {
      const files: Record<string, number[]> = {}
      // memfs has a toJSON method, but we can't use it directly because it tries to coerce all files into utf8 strings. Take advantage of its directory-walking though.
      const volJson = vol.toJSON(repo.dir + '/.git')
      const paths = Object.keys(volJson).filter(p => volJson[p] !== null)
      paths.forEach(p => {
        files[p] = Array.from(fs.readFileSync(p) as Buffer)
      })

      return files
    })
    .then(repo => ({
      ...NEW,
      [repoColumn]: repo,
    }))
}

/**
 * When passed a json object representing the `.git` folder of a repo, returns a list
 * of changes made to corresponding row. Optionally, pass `depth` to limit how far back
 * in time to fetch history for.
 */
export const gitLog = (gitRepoJson: object, depth?: number) => {
  const {fs} = setupMemfs()
  const repo = {fs, dir: '/repo'}

  type TreeInfo = {type: string; content: string; oid: string}
  type WalkResult = {filepath: string; ChildInfo: TreeInfo; ParentInfo?: TreeInfo}

  return SyncPromise.resolve()
    .then(() => writeGitFiles(gitRepoJson, fs))
    .then(() => git.log({...repo, depth}))
    .then(log => {
      return SyncPromise.all(
        log.map(e => {
          return git
            .walk({
              ...repo,
              trees: [e.oid, e.commit.parent[0]].filter(Boolean).map(ref => git.TREE({ref})),
              map: (filepath, entries) => {
                const [Child, Parent] = entries || []
                return SyncPromise.all([resolveTree(Child), Parent && resolveTree(Parent)]).then(
                  ([ChildInfo, ParentInfo]): WalkResult => ({filepath, ChildInfo, ParentInfo} as WalkResult),
                )
              },
            })
            .then((results: WalkResult[]) => ({
              message: e.commit.message.trim(),
              author: `${e.commit.author.name} (${e.commit.author.email})`,
              timestamp: new Date(e.commit.author.timestamp * 1000).toISOString(),
              changes: results
                .filter(
                  r => r.ChildInfo?.type === 'blob' && r.filepath !== '.' && r.ChildInfo.oid !== r.ParentInfo?.oid,
                )
                .map(r => ({
                  field: r.filepath,
                  new: serializer.parse(r.ChildInfo.content),
                  old: r.ParentInfo && serializer.parse(r.ParentInfo.content),
                })),
            }))
        }),
      )
    })
}

/**
 * for some reason A.content() converts from a buffer to {"0": 100, "1": 101} format.
 * Object.values(...) converts back to a number array. Wasteful, but works for now.
 */
const btos = (obj: any) => Buffer.from(Object.values<number>(obj || {})).toString()

/** gets the type, content and oid for a `WalkerEntry` */
const resolveTree = (tree: git.WalkerEntry | undefined) => {
  const promises = tree && [tree.type(), tree.content().then(btos), tree.oid()]
  return promises && SyncPromise.all(promises).then(([type, content, oid]) => ({type, content, oid}))
}
