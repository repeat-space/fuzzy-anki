import XRegExp from 'xregexp';
import d3 from 'd3';
import { tabulate, arrToCSV } from './utils/utils';

/**
 * Hook that modifies Nayr's Japanese Core5000 Anki deck
 * (see https://ankiweb.net/shared/info/631662071)
 *
 * @param {Array} deckNotes - array of Anki Notes from the above deck
 * @param {String[]} deckFields - names of the fields of the Notes
 * @return {Array} an updated version of deckNotes
 *
 * Each Note object containing properties Expression, Meaning, Reading, English
 * Translation, Word, Frequency Order, and Sound.
 *
 * Kana in the "Reading" field will be changed from "[kana]" to being wrapped in
 *<span> tags. And each of the items in the "Word" field, which contains the
 *Japanese word, its reading in roumaji (Latin characters), one or more
 *parts-of-speech, and English translations, will be encased in <span> tags
 *(ideally these would be their own independent fields, but some rows have more
 *than one part-of-speech).
 */
export function core5000Modify(deckNotes, deckFields, deckName) {
  d3
    .select('body')
    .append('div')
    .attr('id', 'core5000');
  d3
    .select('#core5000')
    .append('h2')
    .text(deckName);

  const divForLink = d3.select('#core5000').append('p');

  //------------------------------------------------------------
  // Variables and functions to help deal with the "Word" column
  //------------------------------------------------------------
  // Parts of speech abbreviations
  const abbreviations = 'adn.,adv.,aux.,conj.,cp.,i-adj.,interj.,n.,na-adj.,num.,p.,p. \
case,p. conj.,p. disc.,pron.,v.,suffix,prefix'.split(
    ','
  );

  const abbreviationsOr = abbreviations.join('|').replace(/\./g, '\\.');

  // The basic structure of the "Word" column is:
  //
  // 1. some kanji or kana, plus other random things like commas, parentheses,
  // both ascii and full-width.
  // 2. Some roumaji
  // 3. One or more parts of speech, using the above abbreviations
  // 4. English translations.
  //
  // The following three strings will be the regexps that match #1--#3.
  // They've been carefully chosen to work with wrinkles in the database,
  // e.g., more than one of the above four-step sequences in a single row,
  // multiple adjacent parts-of-speech, or multiple
  // part-of-speech-and-translation pairs. All these strings intended to
  // become regexps will go through XRegExp, which expands out the
  // Han/Katakana/Hiragana groups.
  const kanaKanjiWordRegexp = '([^a-z]+)';
  const romajiRegexp = '([a-z\\s,\\-()’]+)';
  const partOfSpeechRegexp = '((?: |,|' + abbreviationsOr + ')+)';

  // Break up a string containing one {kanji/kana + roumaji + part-of-speech +
  // translations} sequence. The critical idea in this function is to split
  // the input string between part-of-speech-abbreviations, and do some
  // processing on that to handle two edge cases:
  //
  // 1. "いろいろ iroiro adv., na-adj. various" <-- more than one adjacent
  //     part-of-speech abbreviation separated by a comma
  // 2. "余り amari adv. the rest n. (not) much" <-- more than one
  //     part-of-speech/translation pairs.
  //
  // It handles both these cases by splitting the string into an array along
  // (and including) part-of-speech-abbreviation boundaries. To handle edge
  // case 1 above, it finds elements of the resulting array that are
  // between part-of-speech abbreviations but which are
  // whitespace/punctuation, and merges those elements into a single
  // "part-of-speech" element.
  //
  // Then it builds an array of parts-of-speech and a matching array of
  // translations. This handles case 2 above. These two arrays, as well as the
  // kanji/kana and roumaji, are returned as an object.
  function bar(seqString) {
    // How much hackier can we get :)
    if (0 == seqString.localeCompare('（お）姉さん(o)-nee-san n. elder sister')) {
      // Add space between Japanese and reading
      seqString = '（お）姉さん (o)-nee-san n. elder sister';
    } else if (
      0 ==
      seqString.localeCompare(
        '相変わらず ai-kawara zu adv as ever, as usual, the \
same, as before [always]'
      )
    ) {
      // Add dot to "adv", completing the abbreviation instead of adding
      // another abbreviation which might trigger elsewhere
      seqString = '相変わらず ai-kawara zu adv. as ever, as usual, the same, as \
before [always]';
    } else if (0 == seqString.localeCompare('ごと-goto suffix every')) {
      seqString = 'ごと goto suffix every';
    } else if (0 == seqString.localeCompare('家 uchi n house, home')) {
      seqString = '家 uchi n. house, home';
    }

    let arr = seqString.split(XRegExp('(' + abbreviationsOr + ')'));

    let isAbbreviation = arr.map(function(x) {
      return abbreviations.indexOf(x) >= 0 ? 1 : 0;
    });
    let isWhitePunctuation = arr.map(function(x) {
      return x.match(/^[\s,]*$/) ? 1 : 0;
    });
    let isAbbrOrWhitePunct = isAbbreviation.map(function(x, i) {
      return x + isWhitePunctuation[i];
    });

    // combineJunk will find [..., "adv.", ",", "na-adj.", ...] and splice
    // it into [..., "adv., na-adj.", ...].
    let tmp = combineJunk(isAbbrOrWhitePunct, arr);
    arr = tmp.data_array;
    isAbbrOrWhitePunct = tmp.indicator_array;
    // Updated arr and isAbbrOrWhitePunct. We need the latter to build the
    // return object.

    // Part-of-speech array and translation array, which will go itno the
    // return object. We rely on each part-of-speech element in arr to be
    // followed by a translation. So far, this happens.
    let pos = [];
    let translation = [];
    arr.map(function(x, i) {
      if (isAbbrOrWhitePunct[i]) {
        pos.push(x);
        translation.push(arr[i + 1]);
      }
    });

    // Grab the initial kanji/kana as well as the roumaji. String.match()
    // will return a three-element array here: the total match, and the two
    // groups corresponding to the two regexps.
    let kanaKanjiMatch = seqString.match(
      XRegExp(kanaKanjiWordRegexp + ' ' + romajiRegexp + ' ' + partOfSpeechRegexp)
    );

    if (0 == seqString.localeCompare('Oa oobii n. OB (old boy), alumnus')) {
      return {
        pos: pos,
        translation: translation,
        word: 'OB',
        romaji: 'oobii'
      };
    }

    return {
      pos: pos,
      translation: translation,
      word: kanaKanjiMatch[1],
      romaji: kanaKanjiMatch[2]
    };
  }

  function combineJunk(indicator_array, data_array) {
    let i = 1;

    while (i < indicator_array.length) {
      if (indicator_array[i] == indicator_array[i - 1] && indicator_array[i] > 0) {
        indicator_array.splice(i - 1, 2, 1);
        data_array.splice(i - 1, 2, data_array[i - 1] + data_array[i]);
      } else {
        i++;
      }
    }

    return { data_array: data_array, indicator_array: indicator_array };
  }

  // Get rid of &nbsp; and such. It'll mess up my regexping.
  function decodeHtml(html) {
    let txt = document.createElement('textarea');
    txt.innerHTML = html;

    return txt.value;
  }

  function wordColumnReplace(s) {
    if (s.search('&') >= 0) {
      s = decodeHtml(s);
    }

    let arr = s.split('<div>');

    return arr
      .map(s => {
        let decomp = bar(s);
        let posTrans = decomp.pos
          .map(function(pos, i) {
            return (
              '<span class="part-of-speech">' +
              pos +
              '</span> <span class="target-words-meaning">' +
              decomp.translation[i] +
              '</span>'
            );
          })
          .join(' ');
        return (
          '<span class="target-words">' +
          decomp.word +
          '</span> <span class="target-words-romaji">' +
          decomp.romaji +
          '</span> ' +
          posTrans
        );
      })
      .join('<div>');
  }

  //--------------------------------------------
  // Variable for Reading column cleanup of kana
  //--------------------------------------------
  const kanaRegexp = XRegExp('\\[([\\p{Hiragana}\\p{Katakana}]+)\\]', 'g');

  //-----------------
  // Complete cleanup
  //-----------------
  deckNotes.map(function(note) {
    // Again, how much hackier can you get :)
    if (0 == note.Reading.localeCompare('この 単語[たんご]はどういう 意味[いみ]ですか。')) {
      note.Word = '語 go n. word; language';
    }

    // Break up Word column into its four separate components
    note.Word = wordColumnReplace(note.Word);

    // Replace [kana] with spans
    note.Reading = note.Reading.replace(kanaRegexp, function(match, kana) {
      return '<span class="reading kana">' + kana + '</span>';
    });

    return note;
  });

  //-------------------------
  // Visualization and return
  //-------------------------
  arrToCSV(deckNotes, deckFields, "Download Nyar's Core5k CSV", divForLink);

  tabulate(deckNotes, deckFields, '#core5000');

  // Instead of setting the styles of thousands of <td> tags individually,
  // just slash on a CSS tag to the DOM.
  d3
    .select('head')
    .insert('style', ':first-child')
    .text(
      '#core5000 th.field-Meaning, #core5000 th.field-Sound {font-size: 10%}\
#core5000 th.field-Frequency-Order {font-size:50%}\
#core5000 td.field-Expression, #core5000 td.field-Reading {font-size: 150%}\
#core5000 td.field-English-Translation, #core5000  td.field-Word {font-size: 75%}'
    );

  return deckNotes;
}

// function summer(arr) {
//   return _.reduce(
//     arr,
//     function(memo, num) {
//       return memo + num;
//     },
//     0
//   );
// }

// function mean(arr) {
//   return summer(arr) / arr.length;
// }
