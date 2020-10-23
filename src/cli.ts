import * as cli from '@rushstack/ts-command-line'
import * as fs from 'fs'
import * as path from 'path'
import * as childProcess from 'child_process'

export class Plv8WriteAction extends cli.CommandLineAction {
  private _input!: cli.CommandLineStringParameter
  private _output!: cli.CommandLineStringParameter

  constructor() {
    super({
      actionName: 'write',
      summary: 'Write a git repo to disk',
      documentation:
        'Pass a json-formatted git repo as input. and an output directory. A fully functional git repo representing that row will be written to disk.',
    })
  }

  onDefineParameters() {
    this._input = this.defineStringParameter({
      parameterLongName: '--input',
      description: 'JSON-formatted git repo. Usually retrieved via "select git from some_table"',
      argumentName: 'GIT_JSON',
    })

    this._output = this.defineStringParameter({
      parameterLongName: '--output',
      description: 'Directory git repo should be written to',
      argumentName: 'PATH',
    })
  }

  async onExecute() {
    const [input, output] = [this._input.value, this._output.value!]
    if (!input) {
      throw Error(`Missing input.\n` + this.renderHelpText())
    }
    const repo = JSON.parse(input)
    fs.mkdirSync(output, {recursive: true})
    if (fs.readdirSync(output).length > 0) {
      throw new Error(`driectory ${output} is not empty`)
    }
    Object.entries<number[]>(repo).forEach(([relativePath, byteArray]) => {
      const filepath = path.join(output, relativePath.replace('/repo/', ''))
      fs.mkdirSync(path.dirname(filepath), {recursive: true})
      fs.writeFileSync(filepath, Buffer.from(byteArray))
    })
    childProcess.execSync('git checkout .', {cwd: output, stdio: 'inherit'})
    console.log('git repo written to', output)
  }
}

export class Plv8CommmandLine extends cli.CommandLineParser {
  constructor() {
    super({
      toolFilename: 'plv8-git',
      toolDescription: 'Write a git repo to disk',
    })

    this.addAction(new Plv8WriteAction())
  }

  onDefineParameters() {}

  onExecute() {
    return super.onExecute()
  }
}

if (require.main === module) {
  new Plv8CommmandLine().execute()
}
