import $ from 'jquery';
import c3 from 'c3';
import d3 from 'd3';
import _ from 'underscore';

import { SQL } from './utils/sql';
import { ankiSeparator, tabulate, arrToCSV, arrayNamesToObj } from './utils/utils';

let decksReviewed = {};
let modelsReviewed = {};
let allDecks;
let allModels;

export function ankiSQLToRevlogTable(array, options) {
  if (typeof options === 'undefined') {
    options = { limit: 100, recent: true };
  }

  let sqliteBinary = new Uint8Array(array);
  let sqlite = new SQL.Database(sqliteBinary);

  // The deck name is in decks, and the field names are in models
  // which are JSON, and have to be handled outside SQL.
  let allModelsDecks = sqlite.exec('SELECT models,decks FROM col')[0].values[0];
  allModels = JSON.parse(allModelsDecks[0]);
  allDecks = JSON.parse(allModelsDecks[1]);

  // The reviews
  const orderDirection = options.recent ? ' DESC ' : '';
  const limit = options.limit && options.limit > 0 ? ` LIMIT ${options.limit}` : '';

  const query = `
    SELECT
      revlog.id, revlog.ease, revlog.ivl, revlog.lastIvl, revlog.time,
      notes.flds, notes.sfld,
      cards.id, cards.reps, cards.lapses, cards.did, notes.mid, cards.ord
    FROM revlog
    LEFT OUTER JOIN cards ON revlog.cid = cards.id
    LEFT OUTER JOIN notes ON cards.nid = notes.id
    ORDER BY revlog.id ${orderDirection} ${limit}
  `;

  const queryResultNames = 'revId,ease,interval,lastInterval,timeToAnswer,noteFacts,noteSortKeyFact,cardId,reps,lapses,deckId,\
modelId,templateNum'.split(
    ','
  );

  // Run the query and convert the resulting array of arrays into an array of
  // objects
  const unknownDeckString = 'unknown deck';
  const unknownNoteString = 'unknown note facts';
  const unknownModelString = 'unknown model';

  // TODO add "Date of first review" field
  const revlogTable = sqlite.exec(query)[0].values.map(rev => {
    // First, convert this review from an array to an object
    rev = arrayNamesToObj(queryResultNames, rev);

    // Add deck name
    rev.deckName = rev.deckId ? allDecks[rev.deckId].name : unknownDeckString;

    // Convert facts string to a fact object
    let fieldNames = rev.modelId
      ? allModels[rev.modelId].flds.map(function(f) {
          return f.name;
        })
      : null;
    rev.noteFacts = rev.noteFacts
      ? arrayNamesToObj(fieldNames, rev.noteFacts.split(ankiSeparator))
      : unknownNoteString;
    // Add model name
    rev.modelName = rev.modelId ? allModels[rev.modelId].name : unknownModelString;
    // delete rev.modelId;

    // Decks need to know what models are in them. decksReviewed is an
    // object of objects: what matters are the keys, at both levels, not the
    // values. TODO can this be done faster in SQL?
    updateNestedObj(decksReviewed, rev.deckId, rev.modelId, rev.modelName);
    // But let's also keep track of models in the same way, since we're lazy
    // FIXME
    updateNestedObj(modelsReviewed, rev.modelId, rev.deckId, rev.deckName);

    // Add review date
    rev.date = new Date(rev.revId);
    rev.dateString = rev.date.toString();

    // Add a JSON representation of facts
    rev.noteFactsJSON =
      typeof rev.noteFacts === 'object' ? JSON.stringify(rev.noteFacts) : unknownNoteString;

    // Switch timeToAnswer from milliseconds to seconds
    rev.timeToAnswer /= 1000;

    return rev;
  });

  /*
    // decks and models that are only associated with reviews. Will this be
    // faster in sql.js or inside plain Javascript? TODO find out.
    var modelIDsReviewed = sqlite.exec(
                                      "SELECT DISTINCT notes.mid \
FROM revlog \
LEFT OUTER JOIN cards ON revlog.cid=cards.id \
LEFT OUTER JOIN notes ON cards.nid=notes.id")[0].values;
    modelsReviewed = modelIDsReviewed.map(function(mid) {
        return mid[0] ? allModels[mid[0]].name : unknownModelString;
    });
    modelIdToName =
        arrayNamesToObj(modelIDsReviewed.map(_.first), modelsReviewed);

    var deckIDsReviewed = sqlite.exec(
                                     "SELECT DISTINCT cards.did \
FROM revlog \
LEFT OUTER JOIN cards ON revlog.cid=cards.id")[0].values;
    decksReviewed = deckIDsReviewed.map(function(did) {
        return did[0] ? allDecks[did[0]].name : unknownDeckString;
    });
    deckIdToName = arrayNamesToObj(deckIDsReviewed.map(_.first), decksReviewed);
    */

  // Create div for results
  displayRevlogOutputOptions({ revlogTable });
}

function displayRevlogOutputOptions({ revlogTable }) {
  const ul = d3
    .select('body')
    .append('div')
    .attr('id', 'reviews')
    .append('div')
    .attr('id', 'reviews-options')
    .append('ul')
    .attr('id', 'reviews-options-list');

  const tooMuch = 101;

  if (revlogTable.length > tooMuch) {
    ul
      .append('li')
      .attr('id', 'tabulate-request')
      .append('button')
      .text('Tabulate ' + revlogTable.length + ' review' + (revlogTable.length > 1 ? 's' : ''))
      .on('click', () => tabulateReviews({ revlogTable }));

    ul
      .append('li')
      .attr('id', 'export-request')
      .append('button')
      .text('Generate CSV spreadsheet')
      .on('click', () => generateReviewsCSV({ revlogTable }));
  } else {
    tabulateReviews({ revlogTable });
    generateReviewsCSV({ revlogTable });
  }

  const viz = ul.append('li').attr('id', 'viz-options');

  viz
    .append('button')
    .text('Visualize performance')
    .on('click', () => {
      const selectedFields = d3
        .selectAll('#viz-models-list > li.viz-model')
        .selectAll('input:checked');

      const config = selectedFields.map(function(mod) {
        const mid = /[0-9]+/.exec(mod.parentNode.id)[0];
        const fs = mod.map(function(sub) {
          let fnum = /field-([0-9]+)/.exec(sub.id)[1];
          return allModels[mid].flds[fnum].name;
        });

        return { modelID: mid, fieldNames: fs };
      });

      config = arrayNamesToObj(_.pluck(config, 'modelID'), _.pluck(config, 'fieldNames'));
      revlogVisualizeProgress(config, getSelectedDeckIDs(), revlogTable);
    });

  const vizDecks = viz
    .append('ul')
    .append('li')
    .text('Select decks to analyze')
    .append('ul')
    .attr('id', 'viz-decks-list');

  /*let vizModels =*/ viz
    .append('ul')
    .append('li')
    .text('Select fields for each model to display in plots')
    .append('ul')
    .attr('id', 'viz-models-list');

  // Data: elements of decksReviewed (which are {deck IDs -> object})
  // TODO: enable visualization of unknown decks: .data(Object.keys(decksReviewed))
  const decksReviewedKeysAlphabetized = _.sortBy(Object.keys(_.omit(decksReviewed, null)), did => {
    return allDecks[did] ? allDecks[did].name : 'zzzUnknown';
  });

  /*let vizDecksList =*/ vizDecks
    .selectAll('li')
    .data(decksReviewedKeysAlphabetized)
    .enter()
    .append('li')
    .append('label')
    .attr('for', d => `viz-deck-${d}`)
    .html(d => {
      const thisModels = _.filter(
        Object.keys(decksReviewed[d]).map(function(mid) {
          return d !== 'null' ? allModels[mid].name : null;
        }),
        null
      );

      const name = d !== 'null' ? allDecks[d].name : 'Unknown deck';
      const description =
        thisModels.length > 0
          ? `(contains model${thisModels.length > 1 ? 's' : ''} ${thisModels.join(', ')})`
          : '';

      return `<input type="checkbox" checked id="viz-deck-${d}"> ${name} ${description}`;
    });

  $('#viz-deck-null').attr('checked', false);
  $('#viz-decks-list input:checkbox').click(() => updateModelChoices());

  updateModelChoices();
}

function updateModelChoices() {
  const selectedDeckIDs = getSelectedDeckIDs();

  const modelIDs = _.union(
    _.flatten(_.map(selectedDeckIDs.map(did => decksReviewed[did]), val => Object.keys(val)))
  );

  const vizModels = d3.select('#viz-models-list');
  const modelsData = vizModels.selectAll('li.viz-model').data(modelIDs, mid => mid);

  // For an explanation of the CSS class 'viz-model' see
  // http://stackoverflow.com/a/25599142/500207

  modelsData.exit().remove();

  const vizModelsList = modelsData
    .enter()
    .append('li')
    .attr('id', function(mid) {
      return 'viz-model-' + mid;
    })
    .text(function(mid) {
      return mid !== 'null' ? allModels[mid].name : 'Unknown model';
    })
    /*.on("click", function(mid) {
                $('#viz-model-' + mid + '-list').slideToggle();
            })*/
    .classed('viz-model', true)
    .append('ul')
    .append('li');

  /*let vizFields =*/ vizModelsList
    .selectAll('span')
    .data(function(d) {
      return d !== 'null'
        ? _.pluck(allModels[d].flds, 'name').map(function(name) {
            return {
              name: name,
              modelId: d,
              total: allModels[d].flds.length
            };
          })
        : [];
    })
    .enter()
    .append('span')
    .classed('viz-field-span', true)
    .append('label')
    .attr('for', (d, i) => `viz-model-${d.modelId}-field-${i}`)
    .html(
      (d, i) =>
        `<input type="checkbox" id="viz-model-${d.modelId}-field${i}">${d.name}${
          i + 1 < d.total ? ', ' : ''
        }`
    );
}

function getSelectedDeckIDs() {
  const selectedDecks = _.pluck($('#viz-decks-list input:checked'), 'id');
  // In case the above is too fancy across browsers, this is equivalent:
  // `$.map($('#viz-decks-list input:checked'), function(x){return x.id;})`

  const selectedDeckIDs = selectedDecks.map(id => {
    return id !== 'viz-deck-null' ? /[0-9]+/.exec(id)[0] : null;
  });

  return selectedDeckIDs;
}

function generateReviewsCSV({ revlogTable }) {
  const d3Selection = arrToCSV(
    revlogTable,
    'dateString,ease,interval,lastInterval,timeToAnswer,noteSortKeyFact,deckName,modelName,lapses,\
reps,cardId,noteFactsJSON'.split(
      ','
    ),
    'Download CSV',
    d3
      .select('#export-request')
      .append('li')
      .attr('id', 'export-completed')
  );

  d3Selection.classed('csv-download', true);
}

function tabulateReviews({ revlogTable }) {
  tabulate(
    revlogTable,
    'date,ease,interval,lastInterval,timeToAnswer,noteSortKeyFact,deckName,modelName,lapses,\
reps,cardId,noteFactsJSON'.split(
      ','
    ),
    'div#reviews'
  );
}

// Note, this changes obj's parameters ("call by sharing") so the return value
// is purely a nicety: the object WILL be changed in the caller's scope.
export function updateNestedObj(obj, outerKey, innerKey, innerVal) {
  if (!(outerKey in obj)) {
    obj[outerKey] = {}; // don't do {innerKey: innerKey} '_'
    obj[outerKey][innerKey] = innerVal;
  } else {
    if (!(innerKey in obj[outerKey])) {
      obj[outerKey][innerKey] = innerVal;
    }
  }

  return obj;
}

function revlogVisualizeProgress(configModelsFacts, deckIDsWanted, revlogTable) {
  // This function needs to take, as logical inputs, the decks and models to
  // limit the visualization to, plus a boolean operation AND or OR to combine
  // the two, and finally a way to display the pertinent facts about a card so
  // that cards are better-distinguished than card IDs (a long nunmber).
  if (typeof deckIDsWanted === 'undefined') {
    deckIDsWanted = [];
  }

  let revDb = reduceRevlogTable(deckIDsWanted, revlogTable);
  let temporalIndexToCardArray = revDb.temporalIndexToCardArray;
  revDb = revDb.revDb;

  // So now we've generated an object indexed by whatever keyFactId was chosen
  // (and potentially restricted to a deck/model) that tells us performance
  // details about each card. Sibling cards are currently treated as different
  // cards: TODO: allow user to select treating them as the same card.

  function appendC3Div(heading, text, id) {
    let newdiv = d3.select('#reviews').append('div');
    newdiv.append('h4').text(heading);
    newdiv.append('p').text(text);
    newdiv.append('div').attr('id', id);
    // d3.select("#reviews").append('div').attr("id", id);
  }

  appendC3Div(
    'Performance since acquisition',
    'Number of lapses since \
card learned. Drag to pan, and mouse-weel to zoom.',
    'scatter-norm-rep-lapse'
  );

  appendC3Div(
    'Performance histogram',
    'Histogram of per-card performance, where ease of 1 is \
failure and all other eases are success.',
    'histogram'
  );

  appendC3Div(
    'Calendar view of acquisition',
    'Time series showing when cards were learned. \
Large circles indicate perfect performance, smaller circles indicate poorer \
performance. Zoomable and pannable.',
    'chart'
  );

  appendC3Div(
    'Scatter plot of lapses versus reps',
    'Lapses and reps are correlated with poor \
performance, so this scatter plot cannot be easily used for analysis.',
    'scatter-rep-lapse'
  );

  //------------------------------------------------------------------------
  // Pass rate per unique card
  //------------------------------------------------------------------------
  // Generate the column-wise array of arrays that c3js wants
  let chartArr = _.map(revDb, function(val) {
    return [val.dateLearned, 1 + val.temporalIndex];
  });
  chartArr.unshift(['date', 'card index']);

  // Invoke the c3js method
  /*let chart =*/ c3.generate({
    bindto: '#chart',
    data: {
      x: 'date',
      rows: chartArr,
      onmouseover: d => {
        $('.c3-circle-' + d.index).css({
          'stroke-width': 5
        });
      },
      onmouseout: d => {
        $('.c3-circle-' + d.index).css({
          'stroke-width': 1
        });
      }
    },
    axis: {
      y: { label: { text: 'Card index' } },
      x: {
        type: 'timeseries',
        label: { text: 'Date' },
        tick: { rotate: 15, count: 50, format: '%Y-%m-%d %I:%M' },
        height: 40
      }
    },
    tooltip: {
      format: {
        value: value => {
          // value: 1-index!
          let key = temporalIndexToCardArray[value - 1];
          let str = cardAndConfigToString(revDb[key], configModelsFacts);
          let reps = revDb[key].reps;
          let lapses = revDb[key].lapses;
          return (
            str + ' (#' + (value - 1 + 1) + ', ' + (reps - lapses) + '/' + reps + ' reps passed)'
          );
        }
      }
    },
    legend: { show: false },
    zoom: {
      enabled: true,
      extent: [1, 2]
    }, // default is [1,10] doesn't provide enough zoooooom
    point: {
      focus: { expand: { enabled: false } }
    } // don't expand a point on focus
  });

  // Make the radius and opacity of each data circle depend on the pass rate
  const grader = dbentry => 1 - dbentry.lapses / dbentry.reps;
  const worstRate = grader(_.min(revDb, grader));

  const scaleRadius = d3.scale
    .linear()
    .domain([worstRate - 0.005, 1])
    .range([2, 45]);
  const scaleOpacity = d3.scale
    .pow()
    .exponent(-17)
    .domain([worstRate, 1])
    .range([1, 0.05]);

  // The following helps smooth out the diversity of radii and opacities by
  // putting more slope in the linear scale where there's more mass in the
  // histogram, so when there's lots of things with about the same value,
  // they'll have more different radii/opacities than they would otherwise. It
  // looks good, but it depends on the user's data, and requires some
  // automatic histogram analysis: TODO.
  if (false) {
    let lin = d3.scale
      .linear()
      .domain([0, 1])
      .range(scaleRadius.range());
    scaleRadius = d3.scale
      .linear()
      .domain([worstRate, 0.85, 0.93, 0.96, 1])
      .range([lin(0), lin(0.2), lin(0.8), lin(0.99), lin(1)]);
    lin = d3.scale
      .linear()
      .domain([0, 1])
      .range(scaleOpacity.range());
    scaleOpacity = d3.scale
      .linear()
      .domain([worstRate, 0.85, 0.93, 0.96, 1])
      .range([lin(0), lin(0.2), lin(0.8), lin(0.99), lin(1)]);
  }

  temporalIndexToCardArray.forEach((value, idx) => {
    const dbentry = revDb[temporalIndexToCardArray[idx]];
    const rate = grader(dbentry);
    // if (idx>=557) {debugger;}
    d3.select('.c3-circle-' + idx).attr({
      r: scaleRadius(rate),
      //'fill-opacity' : 0,
      //'fill' : 'none',
      'stroke-opacity': scaleOpacity(rate)
    });
  });

  $('.c3-circle').css({ stroke: 'rgb(31,119,180)', fill: 'none', 'fill-opacity': 0 });

  //------------------------------------------------------------------------
  // Histogram of pass rates
  //------------------------------------------------------------------------
  // High to low, then reverse, to make sure 1.01 and 1 have no roundoff.
  // Include 1.01 to capture 1 in its own bin
  let binDistance = 0.01;
  let histEdges = _.range(1.01, Math.floor(worstRate * 100) / 100, -binDistance).reverse();

  let histData = d3.layout.histogram().bins(histEdges)(_.map(revDb, grader));
  let normalizeHistToPercent = 1 / temporalIndexToCardArray.length;
  let chartHistData = _.map(histData, function(bar) {
    return [bar.x, bar.y];
  });

  chartHistData.unshift(['x', 'frequency']);
  /*let hist =*/ c3.generate({
    bindto: '#histogram',
    data: { x: 'x', rows: chartHistData, type: 'bar' },
    bar: { width: { ratio: 0.95 } },
    axis: {
      y: { label: { text: 'Number of cards' } },
      x: {
        label: { text: 'Pass rate' },
        tick: { format: d3.format('.2p') }
      }
    },
    tooltip: {
      format: {
        value: function(value) {
          return (
            value + ' cards (' + d3.format('.3p')(value * normalizeHistToPercent) + ' of cards)'
          );
        }
      }
    },
    legend: { show: false }
  });

  //-----------------
  // Time to failure plots
  //--------------------
  const unitRandom = () => (Math.random() - 0.5) * 0.5;
  const lapsesReps = temporalIndexToCardArray.map(key => [
    revDb[key].lapses + unitRandom(),
    revDb[key].reps + unitRandom()
  ]);

  lapsesReps.unshift(['lapses', 'reps']);

  /*let lapsesRepsChart =*/ c3.generate({
    bindto: '#scatter-rep-lapse',
    data: { x: 'reps', rows: lapsesReps, type: 'scatter' },
    axis: {
      x: { label: { text: '# reps, integer with jitter' }, tick: { fit: false } },
      y: { label: { text: '# lapses, integer with jitter' } }
    },
    legend: { show: false }
  });

  //-----------
  // Normalized
  //-----------
  const current = new Date().getTime();
  let dayDiff = initial => (current - initial.getTime()) / (1000 * 3600 * 24);

  let jitteredTimeToCard = {};
  let lapsesTime = temporalIndexToCardArray.map(key => {
    let jitteredTime = dayDiff(revDb[key].dateLearned) + unitRandom();
    jitteredTimeToCard[jitteredTime] = key;
    return [revDb[key].lapses + unitRandom(), jitteredTime];
  });

  lapsesTime.unshift(['lapses', 'daysKnown']); /*data --> columns : lapsesTimesTranspose*/

  /*
    var lapsesTimesTranspose = [];
    for (var inputCol = 0;inputCol < lapsesTime[0].length; inputCol++) {
        lapsesTimesTranspose[inputCol] = [];
        for (var inputRow = 0; inputRow < lapsesTime.length; inputRow++) {
            lapsesTimesTranspose[inputCol][inputRow] = lapsesTime[inputRow][inputCol];
        }
    }
  */

  // lapsesDaysChart
  c3.generate({
    bindto: '#scatter-norm-rep-lapse',
    data: { x: 'daysKnown', rows: lapsesTime, type: 'scatter' },
    axis: {
      x: {
        label: { text: 'days known, with jitter' },
        tick: { fit: false }
      },
      y: { label: { text: '# lapses, with jitter' } }
    },
    legend: { show: false },
    tooltip: {
      contents: (d, defaultTitleFormat, defaultValueFormat, color) => {
        let key = jitteredTimeToCard[d[0].x];
        let str = cardAndConfigToString(revDb[key], configModelsFacts);

        this.config.tooltip_format_title = function(d) {
          return 'Known for ' + d3.round(d) + ' days (' + str + ')';
        };

        this.config.tooltip_format_value = function(value) {
          return d3.round(value) + ' (' + str + ')';
        };

        const retval = this.getTooltipContent ? this.getTooltipContent(d, [], [], color) : '';
        return retval;
      },
      format: {
        title: d => `Known for ${d3.round(d)} days`,
        name: id => {
          if (id === 'lapses') {
            return 'Lapses';
          }

          return 'Card key';
        },
        value: (value, ratio, id) => {
          if (id === 'lapses') {
            return d3.round(value);
          }

          return temporalIndexToCardArray[value];
        }
      }
    },
    zoom: { enabled: true, extent: [1, 2] }
  });
}

function cardAndConfigToString(cardObj, config) {
  return config[cardObj.modelId].length > 0
    ? config[cardObj.modelId].map(factName => cardObj.noteFacts[factName]).join(', ')
    : 'card ID: ' + cardObj.cardId;
}

function reduceRevlogTable(deckIDsWanted, revlogTable) {
  deckIDsWanted = deckIDsWanted.map(i => parseInt(i));

  // See if revlogTable is sorted ascending or descending by examining the
  // first two elements.
  // NB. This will fail if the SQL query isn't sorted by time!
  const oldestFirst = revlogTable[0].date < revlogTable[1].date;

  // We wanted to know whether the oldest came first or last because a key
  // element of this visualization is the date each note was learned.

  // Build the cardId-indexed array using reduce since it can reduce (left)
  // or reduceRight. Just accumulate the individual reviews. We don't need to
  // keep track of dates, or lapses, or total reps since the database gave us
  // that.
  let uniqueKeysSeenSoFar = 0;
  let temporalIndexToCardArray = [];

  return {
    revDb: oldestFirst
      ? revlogTable.reduce(reductionFunction, {})
      : revlogTable.reduceRight(reductionFunction, {}),
    temporalIndexToCardArray
  };

  function reductionFunction(dbSoFar, rev) {
    const key = rev.cardId;

    if (deckIDsWanted && deckIDsWanted.indexOf(rev.deckId) < 0) {
      return dbSoFar;
    }

    if (key in dbSoFar) {
      // Already seen this card ID
      dbSoFar[key].allRevlogs.push(rev);
    } else {
      // Fist time seeing this card ID
      dbSoFar[key] = {
        allRevlogs: [rev],
        reps: rev.reps,
        lapses: rev.lapses,
        cardId: rev.cardId,
        modelId: rev.modelId,
        dateLearned: rev.date,
        noteFacts: rev.noteFacts,
        temporalIndex: uniqueKeysSeenSoFar
      };

      temporalIndexToCardArray[uniqueKeysSeenSoFar] = key;
      uniqueKeysSeenSoFar++;
    }

    return dbSoFar;
  }
}
