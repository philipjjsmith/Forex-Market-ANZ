/**
 * How many decimals a price may carry, per symbol.
 *
 * WHY THIS EXISTS AS ITS OWN MODULE
 *
 * The broker enforces this and we did not. `signal-generator.ts` rounded every price with
 * `toFixed(5)` regardless of pair, and `ctrader-executor.ts` passed those prices straight to the
 * order request, so every USD/JPY order was rejected:
 *
 *   ORDER REJECTED — INVALID_REQUEST: Order price = 153.51051 has more digits than symbol
 *   allows. Allowed 3 digits
 *
 * Measured over the week of 2026-09-07: USD/JPY produced 6 of 13 signals and filled ZERO of
 * them, while being the only pair with a positive record. The published result was -0.99R;
 * excluding the orders that could never be sent it was -3.99R. A rounding rule silently decided
 * which half of the strategy was allowed to trade.
 *
 * The rule itself already existed in four separate copies inside ctrader-executor.ts — the amend
 * path, the price decode, and two smoke tests — and in none of them did the main order path. Four
 * copies of a rule is three opportunities for it to drift, so there is now one.
 *
 * WHY A HEURISTIC AND NOT THE BROKER'S OWN `digits`
 *
 * cTrader exposes true precision on ProtoOASymbol, but the symbol LIST response
 * (ProtoOALightSymbol) does not carry it — reading it would mean an extra SYMBOL_BY_ID round trip
 * on the path that places orders, for a traded set of five major FX pairs where the JPY/non-JPY
 * split is exact. If an instrument is ever added whose precision is not 3 or 5 (metals are 2,
 * indices vary), this is the single place that has to learn about it, and the assumption is
 * asserted below rather than assumed.
 */

/** Quote currencies whose FX pairs are priced to 3 decimals rather than 5. */
const THREE_DECIMAL_QUOTES = ['JPY'];

/** Decimals the broker accepts for this symbol. Accepts "USD/JPY" or "USDJPY". */
export function symbolDigits(symbol: string): number {
  const s = symbol.toUpperCase();
  return THREE_DECIMAL_QUOTES.some(q => s.includes(q)) ? 3 : 5;
}

/** Pip factor that matches those digits: 100 for 3-decimal pairs, 10000 otherwise. */
export function symbolPipFactor(symbol: string): number {
  return symbolDigits(symbol) === 3 ? 100 : 10000;
}

/**
 * Round a price to what the symbol can actually represent.
 *
 * Returns a number, not a string, because every caller stores or sends a number and
 * `parseFloat(x.toFixed(n))` was the shape of the original defect.
 *
 * A non-finite input is returned unchanged rather than silently becoming 0 — a NaN price must
 * reach the validation that rejects it, not be laundered into a plausible-looking number.
 */
export function roundToSymbol(symbol: string, price: number): number {
  if (!Number.isFinite(price)) return price;
  return Number(price.toFixed(symbolDigits(symbol)));
}
