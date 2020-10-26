module.exports.process = {
  env: {},
}
module.exports.setTimeout = () => {
  throw new Error(`Can't use setTimeout in postgres!`)
}
module.exports.setInterval = () => {
  throw new Error(`Can't use setInterval in postgres!`)
}
