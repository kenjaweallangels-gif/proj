// ЗАГЛУШКА (заменяет агент «ui/story»).
export function create(game) { return game.add('audio', { event() {} }); }
