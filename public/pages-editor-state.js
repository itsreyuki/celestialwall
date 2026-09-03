(function initializeEditorState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CelestiaEditorState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const HISTORY_LIMIT = 40;

  function clone(value) {
    return structuredClone(value);
  }

  function createId(prefix = 'element') {
    const random = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
    return `${prefix}-${random}`;
  }

  function createState(configuration) {
    const initial = clone(configuration);
    return {
      configuration: initial,
      selectedId: initial.elements[0]?.id || null,
      history: [clone(initial)],
      historyIndex: 0
    };
  }

  function selectedElement(state) {
    return state.configuration.elements.find((element) => element.id === state.selectedId) || null;
  }

  function pushHistory(state) {
    const snapshot = clone(state.configuration);
    state.history.splice(state.historyIndex + 1);
    state.history.push(snapshot);
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
    state.historyIndex = state.history.length - 1;
    return state;
  }

  function mutate(state, update) {
    update(state.configuration);
    return pushHistory(state);
  }

  function updateElement(state, id, update, record = true) {
    const element = state.configuration.elements.find((item) => item.id === id);
    if (!element) return state;
    update(element, state.configuration);
    if (record) pushHistory(state);
    return state;
  }

  function addElement(state, element) {
    const maxZIndex = Math.max(0, ...state.configuration.elements.map((item) => item.zIndex || 0));
    state.configuration.elements.push({
      id: createId(element.type),
      position: { x: 50, y: 50 },
      size: { width: 30, height: 12 },
      zIndex: maxZIndex + 1,
      visible: true,
      style: {},
      ...clone(element)
    });
    state.selectedId = state.configuration.elements.at(-1).id;
    return pushHistory(state);
  }

  function deleteSelected(state) {
    const index = state.configuration.elements.findIndex((item) => item.id === state.selectedId);
    if (index === -1 || state.configuration.elements[index].type === 'profile-card') return state;
    state.configuration.elements.splice(index, 1);
    state.selectedId = state.configuration.elements[index - 1]?.id || state.configuration.elements[0]?.id || null;
    return pushHistory(state);
  }

  function duplicateSelected(state) {
    const source = selectedElement(state);
    if (!source || source.type === 'profile-card') return state;
    const copy = clone(source);
    copy.id = createId(source.type);
    copy.position.x = Math.min(95, copy.position.x + 4);
    copy.position.y = Math.min(95, copy.position.y + 4);
    copy.zIndex = Math.max(0, ...state.configuration.elements.map((item) => item.zIndex || 0)) + 1;
    state.configuration.elements.push(copy);
    state.selectedId = copy.id;
    return pushHistory(state);
  }

  function setLayer(state, id, direction) {
    const ordered = [...state.configuration.elements].sort((first, second) => first.zIndex - second.zIndex);
    const index = ordered.findIndex((item) => item.id === id);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= ordered.length) return state;
    const current = ordered[index];
    const target = ordered[targetIndex];
    const zIndex = current.zIndex;
    current.zIndex = target.zIndex;
    target.zIndex = zIndex;
    return pushHistory(state);
  }

  function setOrder(state, orderedIds) {
    const elements = state.configuration.elements;
    if (orderedIds.length !== elements.length || new Set(orderedIds).size !== elements.length) return state;
    const knownIds = new Set(elements.map((element) => element.id));
    if (orderedIds.some((id) => !knownIds.has(id))) return state;
    orderedIds.forEach((id, index) => {
      const element = elements.find((item) => item.id === id);
      element.zIndex = orderedIds.length - index;
    });
    return pushHistory(state);
  }

  function undo(state) {
    if (state.historyIndex === 0) return false;
    state.historyIndex -= 1;
    state.configuration = clone(state.history[state.historyIndex]);
    if (!selectedElement(state)) state.selectedId = state.configuration.elements[0]?.id || null;
    return true;
  }

  function redo(state) {
    if (state.historyIndex >= state.history.length - 1) return false;
    state.historyIndex += 1;
    state.configuration = clone(state.history[state.historyIndex]);
    if (!selectedElement(state)) state.selectedId = state.configuration.elements[0]?.id || null;
    return true;
  }

  return {
    HISTORY_LIMIT,
    createId,
    createState,
    selectedElement,
    pushHistory,
    mutate,
    updateElement,
    addElement,
    deleteSelected,
    duplicateSelected,
    setLayer,
    setOrder,
    undo,
    redo
  };
}));
