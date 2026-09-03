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
