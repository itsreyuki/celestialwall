const { createDefaultPageConfiguration } = require('./page-config');

const THEME_PALETTES = {
  'soft-pink': ['#2d172d', '#8c4f78', '#ffd4e5', '#f8b7d2', 'Cairo'],
  dreamcore: ['#18142d', '#624c9b', '#f1d7ff', '#b8a1ff', 'Georgia'],
  'dark-anime': ['#0f101a', '#2e2440', '#f1d7ed', '#e75480', 'Cairo'],
  cyber: ['#07151b', '#0b4e5b', '#d6fffb', '#00e5d6', 'Space Grotesk'],
  webcore: ['#17213b', '#3558a2', '#e5f2ff', '#79b7ff', 'Verdana'],
  y2k: ['#2b1940', '#a15dd3', '#fff0fb', '#71e3ff', 'Space Grotesk'],
  'minimal-glass': ['#101217', '#2d3440', '#f5f7fb', '#aab6c9', 'Arial'],
  sakura: ['#2a1620', '#9e4d69', '#fff0f4', '#f4a8c1', 'Cairo'],
  space: ['#090d20', '#2c2369', '#e9e8ff', '#8e7dff', 'Space Grotesk'],
  scrapbook: ['#30241c', '#6d523d', '#fff3d6', '#e4ad67', 'Georgia']
};

const THEMES = Object.keys(THEME_PALETTES).map((id) => ({ id, name: id.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ') }));

function createThemeConfiguration(id) {
  const palette = THEME_PALETTES[id];
  if (!palette) throw new Error('Unknown theme.');
  const [background, accentBackground, text, accent, fontFamily] = palette;
  const config = createDefaultPageConfiguration();
  config.background = { ...config.background, type: 'gradient', color: background, gradient: { from: background, to: accentBackground, angle: id === 'cyber' ? 115 : 135 }, overlayOpacity: id === 'minimal-glass' ? .08 : .18, vignette: .18, grain: id === 'scrapbook' ? .14 : .04 };
  config.profileCard = { ...config.profileCard, backgroundColor: `rgba(18, 14, 31, ${id === 'minimal-glass' ? .58 : .84})`, borderColor: accent, borderRadius: id === 'scrapbook' ? 8 : 24, glow: ['cyber', 'space'].includes(id), glass: true, alignment: 'center' };
  ['displayName', 'bio', 'link'].forEach((key) => { config.typography[key] = { ...config.typography[key], fontFamily, color: key === 'bio' ? text : accent, effect: key === 'displayName' && ['dreamcore', 'cyber'].includes(id) ? 'glow' : 'none' }; });
  config.effects = id === 'space' ? [{ type: 'glow', intensity: .45 }] : (id === 'scrapbook' ? [{ type: 'grain', intensity: .18 }] : []);
  config.desktop = { ...config.desktop, verticalAlignment: 'center' };
  config.elements = [config.elements[0], { id: 'theme-welcome', type: 'text', position: { x: 50, y: 19 }, size: { width: 58, height: 10 }, zIndex: 2, visible: true, style: { color: accent, fontFamily, fontSize: 24, fontWeight: '700', textAlign: 'center', letterSpacing: 0, lineHeight: 1.3, effect: 'none' }, content: 'Your space' }];
  return config;
}

function applyTheme(current, id, mode = 'style') {
  const theme = createThemeConfiguration(id);
  if (mode === 'full') return theme;
  return {
    ...current,
    background: theme.background,
    profileCard: theme.profileCard,
    typography: theme.typography,
    effects: theme.effects,
    desktop: theme.desktop,
    mobileOverrides: theme.mobileOverrides
  };
}

function placeholderImage() {
  return { url: 'https://celes.lol/assets/logo.png', position: 'center', fit: 'cover' };
}

function sanitizeWidget(widgetData) {
  if (widgetData.kind === 'characters' || widgetData.kind === 'games') return { kind: widgetData.kind, items: [{ id: 'remix-item', name: 'Your favorite', image: placeholderImage() }] };
  if (widgetData.kind === 'counter' || widgetData.kind === 'clock') return structuredClone(widgetData);
  return null;
}

function createRemixConfiguration(source) {
  const fresh = createDefaultPageConfiguration();
  const config = structuredClone(source);
  config.avatar = { ...fresh.avatar, asset: null };
  config.banner = { ...fresh.banner, asset: null, visible: false };
  config.background = config.background.type === 'solid' || config.background.type === 'gradient' ? config.background : fresh.background;
  config.socialLinks = [];
  config.musicPlayer = source.musicPlayer?.enabled || source.elements.some((element) => element.type === 'music')
    ? { ...fresh.musicPlayer, enabled: true, title: 'Your song', artist: 'Add music' }
    : fresh.musicPlayer;
  config.entranceScreen = { ...config.entranceScreen, background: null, text: '' };
  config.cursor = { ...config.cursor, type: 'default', image: null };
  config.elements = config.elements.flatMap((element) => {
    if (element.type === 'image') return [{ ...element, assetUrl: placeholderImage().url, name: 'Image placeholder' }];
    if (element.type === 'music') return [{ ...element, content: 'Music Player' }];
    if (element.type === 'social-links') return [{ ...element, links: [] }];
    if (element.type === 'sticker' || element.type === 'decoration') return [{ ...element, assetUrl: undefined, content: '✨' }];
    if (element.type === 'widget') { const widgetData = sanitizeWidget(element.widgetData); return widgetData ? [{ ...element, widgetData, widget: widgetData.kind }] : []; }
    if (element.type === 'text') return [{ ...element, content: 'Your text' }];
    return [{ ...element }];
  });
  return config;
}

module.exports = { THEMES, createThemeConfiguration, applyTheme, createRemixConfiguration };
