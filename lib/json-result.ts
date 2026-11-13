// Results of our JSON queries (quote, giftOffer, campaignStats…) come back JSON-encoded more
// than once: the Lambda returns JSON.stringify(...) and AppSync encodes the AWSJSON value again.
// Unwrap until it is no longer a string. Returns null when it never becomes an object.
export function parseJsonResult<T>(value: unknown): T | null {
  let v = value;
  for (let i = 0; i < 3 && typeof v === "string"; i++) {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v && typeof v === "object" ? (v as T) : null;
}
