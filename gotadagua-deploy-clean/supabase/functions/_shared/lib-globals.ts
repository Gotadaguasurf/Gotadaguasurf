// The camp hub's libraries (lib/*.js, copied to _shared/lib/) are browser scripts: each one puts its API on
// `self` (self.BlReport, self.CampConfig…) and looks the others up there. Deno has `self`; this line makes sure
// of it before they load, whatever the runtime. Import it FIRST.
// deno-lint-ignore no-explicit-any
const g = globalThis as any
if (typeof g.self === 'undefined') g.self = g
export {}
