// ЗАГЛУШКА (заменяет агент «worm»).
export function create(game) { return game.add('worm', { state: 'Dormant', threat: 0, forceSurface() {} }); }
