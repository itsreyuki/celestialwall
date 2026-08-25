const fs = require('fs');
const path = require('path');
const Datastore = require('@seald-io/nedb');

const dataDirectory = path.join(__dirname, 'data');
fs.mkdirSync(dataDirectory, { recursive: true });

const datastore = new Datastore({
  filename: path.join(dataDirectory, 'celestial-wall.db'),
  autoload: false
});

const defaultCanvasState = {
  version: '6.9.1',
  width: 1200,
  height: 700,
  backgroundColor: '#080b12',
  objects: []
};

let canvasState = structuredClone(defaultCanvasState);

function initCanvasDatabase() {
  return new Promise((resolve, reject) => {
    datastore.loadDatabase((loadError) => {
      if (loadError) return reject(loadError);

      datastore.findOne({ key: 'canvas' }, (findError, document) => {
        if (findError) return reject(findError);
        if (!document) {
          canvasState = structuredClone(defaultCanvasState);
          return datastore.insert({ key: 'canvas', state: canvasState, updatedAt: new Date().toISOString() }, (insertError) => {
            if (insertError) return reject(insertError);
            return resolve();
          });
        }

        canvasState = {
          ...structuredClone(defaultCanvasState),
          ...(document.state || {}),
          objects: Array.isArray(document.state?.objects) ? document.state.objects : []
        };
        return resolve();
      });
    });
  });
}

function getCanvasState() {
  return structuredClone(canvasState);
}

function saveCanvasState(nextState) {
  canvasState = {
    ...structuredClone(defaultCanvasState),
    ...structuredClone(nextState),
    objects: Array.isArray(nextState.objects) ? structuredClone(nextState.objects) : []
  };

  return new Promise((resolve, reject) => {
    datastore.update(
      { key: 'canvas' },
      { $set: { state: canvasState, updatedAt: new Date().toISOString() } },
      { upsert: true },
      (error) => error ? reject(error) : resolve(getCanvasState())
    );
  });
}

module.exports = {
  initCanvasDatabase,
  getCanvasState,
  saveCanvasState
};
