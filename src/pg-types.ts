/**
 * The variables available in plv8 triggers: https://plv8.github.io/#trigger-function-calls
 */
export type PG_Vars = {
  OLD?: Record<string, any>
  NEW?: Record<string, any>
  TG_NAME: unknown
  TG_WHEN: unknown
  TG_LEVEL: unknown
  TG_OP: unknown
  TG_RELID: unknown
  TG_TABLE_NAME: unknown
  TG_TABLE_SCHEMA: unknown
  TG_ARGV: string[]
}
