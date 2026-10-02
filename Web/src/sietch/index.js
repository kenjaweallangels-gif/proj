// ЗАГЛУШКА (заменяет агент «sietch»).
export function create(game) { return game.add('sietch', { zoneAt: () => 'B1_Airlock', enter() {} }); }
