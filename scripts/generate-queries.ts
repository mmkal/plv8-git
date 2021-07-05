import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

export const getQuery = (js: string) => {
  const hash = crypto.createHash('sha256').update(js).digest('hex')
  const quotes = `$_${hash}$`
  if (js.includes(quotes)) {
    throw new Error(`Failed to generate quote markers to properly escape js code`)
  }

  return `
    create or replace function git_call_sync(name text, args json) returns json as
    ${quotes}
      var module = {}; // fake module; webpack does 'module.exports.blah = ...'
      ${js}; // <-- bundled code
      return module.exports.git_call_sync(name, args);
    ${quotes}
    language plv8;

    create or replace function git_track() returns trigger as
    $$

      var git_call_sync = plv8.find_function('public.git_call_sync');
      const newData = git_call_sync(
        'rowToRepo',
        [{OLD, NEW, TG_NAME, TG_WHEN, TG_LEVEL, TG_OP, TG_RELID, TG_TABLE_NAME, TG_TABLE_SCHEMA, TG_ARGV}]
      );
      return {...NEW, ...newData};

    $$

    language plv8;

    create or replace function git_resolve(git_json json, ref text) returns json as
    $$

      declare 
        result json;
      begin
        select git_call_sync('gitResolve', json_build_array(git_json, ref))
        into result;

        return result;
      end;

    $$
    language plpgsql;


    create or replace function git_log(git_json json, depth int) returns json as
    $$

      declare 
        result json;
      begin
        select git_call_sync('gitLog', json_build_array(git_json, depth))
        into result;

        return result;
      end;

    $$
    language plpgsql;

    -- overload for getting full depth
    create or replace function git_log(git_json json) returns json as
    $$

      declare 
        result json;
      begin
        select git_log(git_json, 0)
        into result;

        return result;
      end;

    $$
    language plpgsql;
  `
}

export const write = (filesystem = fs) => {
  const sql = getQuery(filesystem.readFileSync(require.resolve('..')).toString())
  const destPath = path.join(__dirname, '../queries/create-git-functions.sql')
  filesystem.mkdirSync(path.dirname(destPath), {recursive: true})
  filesystem.writeFileSync(destPath, sql, 'utf8')
}

if (require.main === module) write()
