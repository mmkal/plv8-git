import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

export const getFunctionBody = (js: string) => {
  return `
    var module = {}; // fake module; webpack does 'module.exports.blah = ...'
    Object.assign(Promise, module.exports.SyncPromise)
    ${js}; // <-- bundled code
  `
}

export const query = (js: string) => {
  const quotes = `$_${crypto.createHash('sha256').update(js).digest('hex')}$`
  if (js.includes(quotes)) {
    throw new Error(`Failed to generate quote markers to properly escape js code`)
  }
  return `
    create function git_track() returns trigger as
    ${quotes}
      ${getFunctionBody(js)}
      return module.exports.rowToRepo({
        OLD, NEW, TG_NAME, TG_WHEN, TG_LEVEL, TG_OP, TG_RELID, TG_TABLE_NAME, TG_TABLE_SCHEMA, TG_ARGV,
      })
    ${quotes}
    language plv8;

    create function git_log(git_repo_json json, depth int) returns json as
    ${quotes}
      ${getFunctionBody(js)}
      return module.exports.gitLog(git_repo_json, depth)
    ${quotes}
    language plv8 immutable strict;

    -- overload for getting full depth
    create or replace function git_log(git_repo_json json) returns json as
    $$
    
      declare 
        result json;
      begin
        select git_log(git_repo_json, 0)
        into result;
  
        return result;
      end;

    $$
    language plpgsql;
  `
}

export const write = (filesystem = fs) => {
  const sql = query(filesystem.readFileSync(require.resolve('..')).toString())
  const destPath = path.join(__dirname, '../queries/create-git-functions.sql')
  filesystem.mkdirSync(path.dirname(destPath), {recursive: true})
  filesystem.writeFileSync(destPath, sql, 'utf8')
}

if (require.main === module) write()
