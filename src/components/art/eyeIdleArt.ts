// Each exposure changes the small specular pixels, following lid → iris → lid.
// No full-width sheen, gradient mask, rotation, or movement of the resting iris.
export const EYE_LIGHT_POSES = [
  'M7 9h2v1H7ZM11 6h2v1h-2Z',
  'M10 8h2v1h-2ZM13 7h1v2h-1Z',
  'M14 8h1v1h-1ZM16 9h1v1h-1ZM17 10h1v1h-1Z',
  'M18 8h1v1h-1ZM19 10h1v1h-1ZM20 7h2v1h-2Z',
  'M23 8h2v1h-2ZM25 10h1v1h-1Z',
  'M27 10h1v1h-1Z',
] as const;

// Slightly wider than circular. Half-grid intermediate poses keep the breath
// to two screen pixels before its four-pixel outermost exposure at full size.
export const EYE_HALO_MARKS = [
  { path:'M15 0h2v3h-2Z', dx:0, dy:-1 },
  { path:'M1 4h2v1h1v1H2V5H1Z', dx:-1, dy:-1 },
  { path:'M28 4h2v1h-1v1h-2V5h1Z', dx:1, dy:-1 },
  { path:'M-6 19h3v1h-3Z', dx:-1, dy:0 },
  { path:'M35 19h3v1h-3Z', dx:1, dy:0 },
  { path:'M2 34h2v1H3v1H1v-1h1Z', dx:-1, dy:1 },
  { path:'M27 34h2v1h1v1h-2v-1h-1Z', dx:1, dy:1 },
  { path:'M15 37h2v3h-2Z', dx:0, dy:1 },
] as const;
