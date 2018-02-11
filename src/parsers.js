import _ from 'underscore';
import d3 from 'd3';
import Zip from 'jszip';

import { SQL } from './utils/sql';
import { ankiSeparator, tabulate, arrayNamesToObj } from './utils/utils';
import { core5000Modify } from './utils/kanji-utils';

const GLOBAL_CORS_PROXY = 'http://cors-anywhere.herokuapp.com/';

// deckNotes contains the contents of any APKG decks uploaded. It is an array of
// objects with the following properties:
// - "name", a string
// - "fieldNames", an array of strings
// - "notes", an array of objects, each with properties corresponding to the
// entries of fieldNames.

export async function ankiBinaryToTable(ankiArray, options) {
  const compressed = new Uint8Array(ankiArray);

  const zip = new Zip();
  await zip.loadAsync(compressed, { createFolders: true });

  const collectionFile = zip.files['collection.anki2'];
  if (collectionFile) {
    const sqlData = await collectionFile.async('uint8array');
    sqlToTable(sqlData);

    if (options && options.loadImage) {
      const mediaFile = zip.files['media'];

      if (mediaFile) {
        const mediaJSON = await mediaFile.async('string');
        await parseImages(JSON.parse(mediaJSON), zip);
      }
    }
  }
}

export function ankiURLToTable(ankiURL, options, useCorsProxy, corsProxyURL) {
  if (typeof useCorsProxy === 'undefined') {
    useCorsProxy = false;
  }
  if (typeof corsProxyURL === 'undefined') {
    corsProxyURL = GLOBAL_CORS_PROXY;
  }

  let zipxhr = new XMLHttpRequest();

  zipxhr.open('GET', (useCorsProxy ? corsProxyURL : '') + ankiURL, true);
  zipxhr.responseType = 'arraybuffer';
  zipxhr.onload = function() {
    ankiBinaryToTable(this.response, options);
  };

  zipxhr.send();
}

function sqlToTable(uInt8ArraySQLdb) {
  const db = new SQL.Database(uInt8ArraySQLdb);

  // // Decks table (for deck names)
  // let decks = db.exec('SELECT decks FROM col');
  // decks = JSON.parse(decks[0].values[0][0]);

  // Models table (for field names)
  const col = db.exec('SELECT models FROM col');
  const models = JSON.parse(col[0].values[0][0]);

  // Notes table, for raw facts that make up individual cards
  let deckNotes = db.exec('SELECT mid, flds FROM notes');

  Object.keys(models).forEach(key => {
    models[key].fields = _.pluck(models[key].flds, 'name');
  });

  const notesByModel = _.groupBy(deckNotes[0].values, row => row[0]);

  deckNotes = Object.entries(notesByModel).map(([modelId, notesArray]) => {
    const modelName = models[modelId].name;
    const fieldNames = models[modelId].fields;

    notesArray = notesArray.map(note => {
      const fields = note[1].split(ankiSeparator);
      return arrayNamesToObj(fieldNames, fields);
    });

    return { name: modelName, notes: notesArray, fieldNames: fieldNames };
  });

  // Visualize!
  if (specialDisplayHandlers(deckNotes) === 0) {
    deckNotes.forEach((model, idx) => {
      const deckId = `deck-${idx}`;

      d3
        .select('#anki')
        .append('h2')
        .text(model.name);

      d3
        .select('#anki')
        .append('div')
        .attr('id', deckId);

      tabulate(model.notes, model.fieldNames, `#${deckId}`);
    });
  }
}

async function parseImages(imageTable, zip) {
  const map = {};

  for (const prop in imageTable) {
    const file = zip.files[prop];

    if (file) {
      map[imageTable[prop]] = converterEngine(await file.async('uint8array'));
    }
  }

  d3.selectAll('img').attr('src', () => {
    //Some filenames may be encoded. Decode them beforehand.
    const key = decodeURI(this.src.split('/').pop());

    if (key in map) {
      return `data:image/png;base64,${map[key]}`;
    }

    return this.src;
  });
}

function converterEngine(uInt8Array) {
  const biStr = uInt8Array.map(_ => String.fromCharCode(_));
  const base64 = window.btoa(biStr.join(''));

  return base64;
}

function specialDisplayHandlers(deckNotes) {
  if (false) {
    let modifiedDeckNotes = _.map(
      _.filter(deckNotes, function(model) {
        return 0 == "Nayr's Japanese Core5000".localeCompare(model.name);
      }),
      function(model) {
        return core5000Modify(model.notes, model.fieldNames, model.name);
      }
    );
    if (modifiedDeckNotes.length > 0) {
      return 1;
    }
  }

  return 0;
}
