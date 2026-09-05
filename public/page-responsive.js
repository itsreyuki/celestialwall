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

  const CONTENT_SCALE_LIMITS = Object.freeze({
    'profile-card': 1.25,
    'social-links': 1.15,
    music: 1.15,
    widget: 1.2,
    'widget:characters': 1.08,
    'widget:games': 1.08
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
    const [baseWidth, baseHeight] = ELEMENT_BASE_SIZES[element.type] || [38, 16];
    const scale = Math.sqrt((resolvedLayout.size.width / baseWidth) * (resolvedLayout.size.height / baseHeight));
    return Math.max(.15, Math.min(4, scale));
  }

  function contentVisualScale(element, mobile, resolvedLayout = resolveElementLayout(element, mobile)) {
    const visualScale = elementVisualScale(element, mobile, resolvedLayout);
    const widgetKey = element.type === 'widget' ? `widget:${element.widgetData?.kind || ''}` : '';
    const limit = CONTENT_SCALE_LIMITS[widgetKey] || CONTENT_SCALE_LIMITS[element.type];
    return limit ? Math.min(visualScale, limit) : visualScale;
  }

  function fitDesignViewport(availableWidth, availableHeight, mobile) {
    const viewport = mobile ? DESIGN_VIEWPORTS.mobile : DESIGN_VIEWPORTS.desktop;
    const width = Math.max(1, Number(availableWidth) || viewport.width);
    const height = Math.max(1, Number(availableHeight) || viewport.height);
    const scale = Math.max(.1, Math.min(width / viewport.width, height / viewport.height));
    return { ...viewport, scale, renderedWidth: viewport.width * scale, renderedHeight: viewport.height * scale };
  }

  const api = { DESIGN_VIEWPORTS, ELEMENT_BASE_SIZES, CONTENT_SCALE_LIMITS, resolveElementLayout, elementVisualScale, contentVisualScale, fitDesignViewport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CelestiaPageResponsive = api;
}(typeof window !== 'undefined' ? window : globalThis));
