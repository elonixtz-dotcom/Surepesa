/**
 * `jose` ships only as an ES module. This backend compiles to CommonJS, and Vercel's Node
 * runtime cannot require() an ES module, so it is loaded once with a dynamic import instead.
 */
type Jose = typeof import('jose');

let loading: Promise<Jose> | undefined;

export const loadJose = (): Promise<Jose> => (loading ??= import('jose'));
