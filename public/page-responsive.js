(function (root) {
  const ELEMENT_BASE_SIZES = Object.freeze({
    'profile-card': [72, 48],
    text: [38, 12],
    'social-links': [48, 10],
    image: [24, 24],
    sticker: [14, 16],
    music: [35, 11]
  });

  function resolveElementLayout(element, mobile) {
    const overrides = mobile ? (element.mobileOverrides || {}) : {};
    const position = overrides.mobilePosition || overrides.position || element.position;
    const size = {
      width: overrides.mobileWidth ?? overrides.size?.width ?? element.size.width,
      height: overrides.mobileHeight ?? overrides.size?.height ?? element.size.height
    };
    return {
      position,
      size,
      scale: overrides.mobileScale ?? 1,
      visible: overrides.hideOnMobile ? false : (overrides.visible ?? element.visible),
      alignment: overrides.mobileAlignment || null
    };
  }

  function elementVisualScale(element, mobile, resolvedLayout = resolveElementLayout(element, mobile)) {
    const fallbackHeight = element.widgetData?.kind === 'gallery' ? 30 : 16;
    const [baseWidth, baseHeight] = ELEMENT_BASE_SIZES[element.type] || [38, fallbackHeight];
    const scale = Math.sqrt((resolvedLayout.size.width / baseWidth) * (resolvedLayout.size.height / baseHeight));
    return Math.max(.15, Math.min(4, scale));
  }

  const api = { ELEMENT_BASE_SIZES, resolveElementLayout, elementVisualScale };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CelestiaPageResponsive = api;
}(typeof window !== 'undefined' ? window : globalThis));
