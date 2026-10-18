// Visual themes for the battlefield. A layout's resources and navigation are identical in every theme:
// only the ground, scenery, light and minimap change, so the choice never affects balance.
// Colours are 0..255 sRGB for the ground canvas; tints multiply the vertex colours of the models.
export const THEMES = {
  temperate: {
    id: 'temperate', label: 'Templado',
    ground: {
      low: [57, 72, 51], high: [90, 105, 65], patch: [133, 116, 86], patchAt: .52,
      road: [139, 120, 88], scree: [108, 104, 90], dust: [112, 109, 94],
      ore: [57, 56, 49], dusk: [34, 38, 38],
    },
    sky: 0x0e1216, hemi: [0xd6e4ff, 0x40483a, 1.25], sun: [0xfff0d8, 2.3],
    tree: { model: 'tree', tint: [1, 1, 1] }, rock: [1, 1, 1], cliff: [1, 1, 1], ruin: [1, 1, 1],
    cover: null, slab: { tint: [.86, .88, .9], dust: [118, 112, 96], dustAmount: .18 },
    // Rivers: bank mud, the bed under deep water, ford gravel; the surface colour and its ripples.
    water: { bank: [78, 74, 56], bed: [44, 56, 54], ford: [124, 118, 98], color: 0x5d8f9a, opacity: .86, shallow: .4, ripple: .22 },
    mini: { tree: 'rgba(20,50,20,0.9)', rock: 'rgba(110,110,110,0.95)', cliff: '#969783', water: '#2f5866', ford: '#6f8a86' },
  },
  desert: {
    id: 'desert', label: 'Desierto',
    ground: {
      low: [176, 138, 90], high: [204, 170, 116], patch: [150, 104, 70], patchAt: .5, ripple: .12,
      road: [160, 128, 92], scree: [150, 112, 78], dust: [190, 152, 104],
      ore: [104, 82, 62], dusk: [48, 36, 26],
    },
    sky: 0x2a2018, hemi: [0xffe6c2, 0x7a5a38, 1.35], sun: [0xffdcaa, 2.6],
    tree: { model: 'cactus', tint: [1, 1, 1] }, rock: [1.25, .95, .7], cliff: [1.3, .92, .66], ruin: [1.2, 1, .8],
    cover: { color: [232, 196, 140], from: .55, to: .95, amount: .45 },
    slab: { tint: [1.08, 1, .86], dust: [214, 176, 122], dustAmount: .4 },
    water: { bank: [142, 112, 78], bed: [98, 84, 64], ford: [184, 156, 114], color: 0x5fa3a0, opacity: .84, shallow: .38, ripple: .2 },
    mini: { tree: 'rgba(70,96,46,0.95)', rock: 'rgba(130,92,62,0.95)', cliff: '#a7754c', water: '#3f7f80', ford: '#a99a72' },
  },
  ice: {
    id: 'ice', label: 'Helado',
    ground: {
      low: [206, 218, 228], high: [236, 242, 248], patch: [150, 184, 206], patchAt: .55,
      road: [160, 166, 172], scree: [132, 140, 150], dust: [196, 206, 216],
      ore: [92, 104, 116], dusk: [22, 30, 40],
    },
    sky: 0x111a24, hemi: [0xdcecff, 0x6a7a90, 1.4], sun: [0xe6f0ff, 2.1],
    tree: { model: 'tree', tint: [.55, .78, .78] }, rock: [.85, .95, 1.1], cliff: [.8, .9, 1.05], ruin: [.85, .92, 1.05],
    cover: { color: [244, 250, 255], from: .35, to: .75, amount: .9 },
    slab: { tint: [.8, .84, .9], dust: [238, 244, 250], dustAmount: .55 },
    // Meltwater: dark and cold, with drifting floes of ice.
    water: { bank: [150, 166, 180], bed: [70, 90, 108], ford: [150, 160, 170], color: 0x6f9ab8, opacity: .9, shallow: .45, ripple: .45 },
    mini: { tree: 'rgba(36,70,72,0.95)', rock: 'rgba(120,134,150,0.95)', cliff: '#c8d6e2', water: '#3d6584', ford: '#8ea3b4' },
  },
};

export const THEME_IDS = Object.keys(THEMES);

// 'random' (or anything unknown) draws one of the themes.
export function resolveTheme(id, rng = Math.random) {
  return THEMES[id] || THEMES[THEME_IDS[Math.floor(rng() * THEME_IDS.length)]];
}
