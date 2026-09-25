// A Sealed<T> is how every secret lives in ServerGameState. It is opaque to the type system (no readable
// fields), it serialises to the constant "[sealed]" (so even an accidental JSON.stringify of a whole player
// or of the whole state emits nothing secret), and the value can only be read with `unseal()`.
// Reading a secret is therefore always an explicit, greppable act.

const vault = new WeakMap<object, unknown>();
const brand: unique symbol = Symbol("sealed");

export class Sealed<T> {
  declare readonly [brand]: T;
  constructor(value: T) {
    vault.set(this, value);
  }
  toJSON(): string {
    return "[sealed]";
  }
  toString(): string {
    return "[sealed]";
  }
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "[sealed]";
  }
}

export function seal<T>(value: T): Sealed<T> {
  return new Sealed(value);
}

export function unseal<T>(s: Sealed<T>): T {
  if (!vault.has(s)) throw new Error("not a sealed value");
  return vault.get(s) as T;
}
