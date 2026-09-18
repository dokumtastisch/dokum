/**
 * What the overlay slot renders when nothing is being intercepted — which is
 * every route in the app except a document opened from inside it (#70).
 *
 * A parallel slot without a `default` makes every hard navigation that does
 * not match it a 404, so this file is load-bearing despite rendering nothing:
 * it is what a pasted document URL, a page reload and a closed overlay all
 * fall back to.
 */
export default function NoModal() {
  return null
}
