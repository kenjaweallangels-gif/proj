// ЗАГЛУШКА (заменяет агент «ui/story»).
export function create(game) { return game.add('dialogue', { play() {}, bark() {} }); }
