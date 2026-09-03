const test = require('node:test');
const assert = require('node:assert/strict');
const { createDefaultPageConfiguration } = require('../services/page-config');
const EditorState = require('../public/pages-editor-state');

function textElement() {
  return {
    type: 'text',
    content: 'Celestia',
    position: { x: 20, y: 20 },
    size: { width: 30, height: 10 },
    style: { color: '#fff7dc' }
  };
}

test('editor state supports drag, resize, undo, redo, and reload snapshots', () => {
  const state = EditorState.createState(createDefaultPageConfiguration());
  EditorState.addElement(state, textElement());
  const textId = state.selectedId;

  EditorState.updateElement(state, textId, (element) => {
    element.position.x = 40;
    element.position.y = 55;
  }, false);
  EditorState.pushHistory(state);
  assert.deepEqual(EditorState.selectedElement(state).position, { x: 40, y: 55 });

  EditorState.updateElement(state, textId, (element) => {
    element.size.width = 48;
    element.size.height = 18;
  }, false);
  EditorState.pushHistory(state);
  assert.deepEqual(EditorState.selectedElement(state).size, { width: 48, height: 18 });

  assert.equal(EditorState.undo(state), true);
  assert.deepEqual(EditorState.selectedElement(state).size, { width: 30, height: 10 });
  assert.equal(EditorState.redo(state), true);
  assert.deepEqual(EditorState.selectedElement(state).size, { width: 48, height: 18 });

  const restored = EditorState.createState(structuredClone(state.configuration));
  const restoredText = restored.configuration.elements.find((element) => element.id === textId);
  assert.deepEqual(restoredText.size, { width: 48, height: 18 });
});

test('editor state duplicates, reorders, hides, and deletes selected elements', () => {
  const state = EditorState.createState(createDefaultPageConfiguration());
  EditorState.addElement(state, textElement());
  const firstId = state.selectedId;
  EditorState.duplicateSelected(state);
  const secondId = state.selectedId;

  assert.notEqual(firstId, secondId);
  assert.equal(state.configuration.elements.filter((element) => element.type === 'text').length, 2);

  EditorState.updateElement(state, secondId, (element) => { element.visible = false; });
  assert.equal(EditorState.selectedElement(state).visible, false);
  EditorState.setLayer(state, secondId, -1);
  assert.notEqual(EditorState.selectedElement(state).zIndex, 0);

  EditorState.setOrder(state, [firstId, secondId, 'profile-card']);
  assert.equal(state.configuration.elements.find((element) => element.id === firstId).zIndex, 3);
  assert.equal(state.configuration.elements.find((element) => element.id === secondId).zIndex, 2);

  EditorState.deleteSelected(state);
  assert.equal(state.configuration.elements.some((element) => element.id === secondId), false);
  state.selectedId = 'profile-card';
  const historyIndex = state.historyIndex;
  EditorState.deleteSelected(state);
  assert.equal(state.historyIndex, historyIndex);
});

test('resize geometry keeps the opposite corner fixed in every direction', () => {
  const layout = { position: { x: 50, y: 50 }, size: { width: 40, height: 20 } };

  const southeast = EditorState.resizeLayout(layout, { x: 80, y: 70 }, 'se');
  assert.deepEqual(southeast, { position: { x: 55, y: 55 }, size: { width: 50, height: 30 } });

  const northwest = EditorState.resizeLayout(layout, { x: 20, y: 30 }, 'nw');
  assert.deepEqual(northwest, { position: { x: 45, y: 45 }, size: { width: 50, height: 30 } });

  const northeast = EditorState.resizeLayout(layout, { x: 80, y: 30 }, 'ne');
  assert.deepEqual(northeast, { position: { x: 55, y: 45 }, size: { width: 50, height: 30 } });

  const southwest = EditorState.resizeLayout(layout, { x: 20, y: 70 }, 'sw');
  assert.deepEqual(southwest, { position: { x: 45, y: 55 }, size: { width: 50, height: 30 } });
});

test('delta resize follows the physical drag direction for every handle', () => {
  const layout = { position: { x: 50, y: 50 }, size: { width: 30, height: 20 } };
  const southeast = EditorState.resizeLayoutByDelta(layout, { x: 8, y: 6 }, 'se');
  const northwest = EditorState.resizeLayoutByDelta(layout, { x: -8, y: -6 }, 'nw');
  const northeast = EditorState.resizeLayoutByDelta(layout, { x: 8, y: -6 }, 'ne');
  const southwest = EditorState.resizeLayoutByDelta(layout, { x: -8, y: 6 }, 'sw');

  for (const resized of [southeast, northwest, northeast, southwest]) {
    assert.equal(resized.size.width, 38);
    assert.equal(resized.size.height, 26);
  }
  assert.deepEqual(southeast.position, { x: 54, y: 53 });
  assert.deepEqual(northwest.position, { x: 46, y: 47 });
  assert.deepEqual(northeast.position, { x: 54, y: 47 });
  assert.deepEqual(southwest.position, { x: 46, y: 53 });
});

test('delta resize shrinks when a corner is dragged inward', () => {
  const layout = { position: { x: 50, y: 50 }, size: { width: 30, height: 20 } };
  const resized = EditorState.resizeLayoutByDelta(layout, { x: -5, y: -4 }, 'se');
  assert.equal(resized.size.width, 25);
  assert.equal(resized.size.height, 16);
  assert.deepEqual(resized.position, { x: 47.5, y: 48 });
});

test('resize geometry clamps minimum size and canvas boundaries', () => {
  const layout = { position: { x: 20, y: 20 }, size: { width: 20, height: 20 } };
  assert.deepEqual(
    EditorState.resizeLayout(layout, { x: 99, y: 99 }, 'nw', { width: 4, height: 5 }),
    { position: { x: 28, y: 27.5 }, size: { width: 4, height: 5 } }
  );
  assert.deepEqual(
    EditorState.resizeLayout(layout, { x: 110, y: 120 }, 'se'),
    { position: { x: 55, y: 55 }, size: { width: 90, height: 90 } }
  );
});

test('move geometry keeps the complete element inside the canvas', () => {
  const layout = { position: { x: 50, y: 50 }, size: { width: 40, height: 20 } };
  assert.deepEqual(EditorState.moveLayout(layout, { x: -80, y: 90 }), {
    position: { x: 20, y: 90 },
    size: { width: 40, height: 20 }
  });
});

test('text font size follows visual resize and remains bounded', () => {
  assert.equal(EditorState.resizedFontSize(20, { width: 40, height: 10 }, { width: 80, height: 20 }), 40);
  assert.equal(EditorState.resizedFontSize(20, { width: 40, height: 10 }, { width: 1, height: 1 }), 10);
  assert.equal(EditorState.resizedFontSize(80, { width: 20, height: 10 }, { width: 100, height: 100 }), 96);
});

test('move and resize account for a mobile visual scale', () => {
  const layout = { position: { x: 50, y: 50 }, size: { width: 40, height: 20 } };
  assert.deepEqual(EditorState.moveLayout(layout, { x: 100, y: 100 }, {}, 2), {
    position: { x: 60, y: 80 },
    size: { width: 40, height: 20 }
  });
  assert.deepEqual(EditorState.resizeLayout(layout, { x: 100, y: 80 }, 'se', { width: 1, height: 1 }, 2), {
    position: { x: 55, y: 55 },
    size: { width: 45, height: 25 }
  });
});
