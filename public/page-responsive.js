(function (root) {
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

  const api = { resolveElementLayout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CelestiaPageResponsive = api;
}(typeof window !== 'undefined' ? window : globalThis));
