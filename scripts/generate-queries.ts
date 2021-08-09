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

    create or replace function git_set_local_config(name text, value text) returns text as
    $$
      select set_config('git.' || name, value, /* is_local */ true);
    $$
    language sql;

    create or replace function git_set_global_config(name text, value text) returns text as
    $$
      select set_config('git.' || name, value, /* is_local */ false);
    $$
    language sql;

    create or replace function git_get_config(name text) returns text as
    $$
      select current_setting('git.' || name, /* missing_ok */ true);
    $$
    language sql;
  `
}

export const write = (filesystem = fs) => {
  const sql = getQuery(filesystem.readFileSync(require.resolve('..')).toString())
  const queriesDir = path.join(__dirname, '../queries')

  filesystem.mkdirSync(queriesDir, {recursive: true})
  filesystem.writeFileSync(path.join(queriesDir, 'create-git-functions.sql'), sql, 'utf8')
  filesystem.writeFileSync(
    path.join(queriesDir, 'index.js'),
    `const path = require('path')\n` + //
      `const fs = require('fs')\n\n` +
      `exports.gitFunctionsPath = path.join(__dirname, 'create-git-functions.sql')\n\n` +
      `exports.getGitFunctionsSql = () => fs.readFileSync(exports.createGitFunctionsPath, 'utf8')\n\n` +
      `exports.getGitFunctionsSqlAsync = () => fs.promises.readFile(exports.createGitFunctionsPath, 'utf8')\n`,
    'utf8',
  )
  filesystem.writeFileSync(
    path.join(queriesDir, 'index.d.ts'),
    `/** Path on filesystem to file containing git tracking SQL functions */\n` + //
      `export const gitFunctionsPath: string\n\n` +
      `/** Synchronously read the file system to return git tracking SQL functions as a string */\n` +
      `export const getGitFunctionsSql: () => string\n\n` +
      `/** Asynchronously read the file system to return git tracking SQL functions as a string */\n` +
      `export const getGitFunctionsSqlAsync: () => Promise<string>\n`,
    'utf8',
  )
}

if (require.main === module) write()
