// Helpers of the tea-dirtybits apps whose components hold more bits than one integer (a
// prototype; only big-component includes this file). A component's dirty set is a sparse array
// of words of 31 bits, `d[k]`, and "every bit" is ALL, an array of full words.

export const ALL = Array(%WORDS%).fill(-1);

// Conditional content, as the runtime's `branch`, but its nested patch gets ALL when it shows
// again.
export function branch(node, patch) {
  const anchor = new Comment();
  return (show, s, d, w) => {
    if (show) {
      if (anchor.parentNode) {
        anchor.replaceWith(node);
        d = ALL;
      }
      patch?.(s, d, w);
    } else node.replaceWith(anchor);
  };
}
