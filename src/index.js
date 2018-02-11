import $ from 'jquery';
import { ankiBinaryToTable, ankiURLToTable } from './parsers';
import { ankiSQLToRevlogTable } from './rev-log';

import './apkg.css';
import 'c3/c3.min.css';

$(document).ready(function() {
  let options = {};
  let setOptionsImageLoad = function() {
    options.loadImage = $('input#showImage').is(':checked');
    return options;
  };
  let eventHandleToTable = function(event) {
    event.stopPropagation();
    event.preventDefault();
    let f = event.target.files[0];
    if (!f) {
      f = event.dataTransfer.files[0];
    }
    // console.log(f.name);

    let reader = new FileReader();
    if ('function' in event.data) {
      reader.onload = function(e) {
        event.data.function(e.target.result);
      };
    } else {
      reader.onload = function(e) {
        ankiBinaryToTable(e.target.result, setOptionsImageLoad());
      };
    }
    /* // If the callback doesn't need the File object, just use the above.
        reader.onload = (function(theFile) {
            return function(e) {
                console.log(theFile.name);
                ankiBinaryToTable(e.target.result);
            };
        })(f);
        */
    reader.readAsArrayBuffer(f);
  };

  // Deck browser
  $('#ankiFile').change(
    {
      function: function(data) {
        ankiBinaryToTable(data, setOptionsImageLoad());
      }
    },
    eventHandleToTable
  );
  $('#ankiURLSubmit').click(function() {
    ankiURLToTable($('#ankiURL').val(), setOptionsImageLoad(), true);
    $('#ankiURL').val('');
  });

  // Review browser
  $('#sqliteFile').change(
    {
      function: function(data) {
        ankiSQLToRevlogTable(data, {
          limit: parseInt($('input#sqliteLimit').val()),
          recent: $('input#sqliteRecent').is(':checked')
        });
      }
    },
    eventHandleToTable
  );

  // Only for local development
  // ankiURLToTable('/n.apkg');
});
