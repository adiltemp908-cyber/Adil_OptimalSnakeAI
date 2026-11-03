export const MIN_SIDE = 2;
export const MAX_SIDE = 40;
export const validSquareSide = side => Number.isInteger(side) && side >= MIN_SIDE && side <= MAX_SIDE && side % 2 === 0;
