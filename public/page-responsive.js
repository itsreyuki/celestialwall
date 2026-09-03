(function (root) {
  const DESIGN_VIEWPORTS = Object.freeze({
    desktop: Object.freeze({ width: 920, height: 575 }),
    mobile: Object.freeze({ width: 360, height: 640 })
  });

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

  function fitDesignViewport(availableWidth, availableHeight, mobile) {
    const viewport = mobile ? DESIGN_VIEWPORTS.mobile : DESIGN_VIEWPORTS.desktop;
    const width = Math.max(1, Number(availableWidth) || viewport.width);
    const height = Math.max(1, Number(availableHeight) || viewport.height);
    const scale = Math.max(.1, Math.min(width / viewport.width, height / viewport.height));
    return { ...viewport, scale, renderedWidth: viewport.width * scale, renderedHeight: viewport.height * scale };
  }

  const api = { DESIGN_VIEWPORTS, ELEMENT_BASE_SIZES, resolveElementLayout, elementVisualScale, fitDesignViewport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CelestiaPageResponsive = api;
}(typeof window !== 'undefined' ? window : globalThis));
