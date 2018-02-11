import d3 from 'd3';
import _ from 'underscore';

export const ankiSeparator = '\x1f';

export function arrayNamesToObj(fields, values) {
  let obj = {};

  for (const i in values) {
    obj[fields[i]] = values[i];
  }

  return obj;
}

export function arrToCSV(dataArray, fieldsArray, linkText, d3SelectionToAppend) {
  let csv = convert(dataArray, fieldsArray);
  let blob = new Blob([csv], { type: 'data:text/csv;charset=utf-8' });
  let url = URL.createObjectURL(blob);

  return d3SelectionToAppend
    .append('a')
    .attr('href', url)
    .text(linkText);
}

// Huge props to http://stackoverflow.com/a/9507713/500207
export function tabulate(datatable, columns, containerString) {
  const table = d3.select(containerString).append('table');
  const thead = table.append('thead');
  const tbody = table.append('tbody');

  // append the header row
  thead
    .append('tr')
    .selectAll('th')
    .data(columns)
    .enter()
    .append('th')
    .text(column => column)
    .attr('class', d => `field-${d.replace(' ', '-')}`);

  // create a row for each object in the data
  const rows = tbody
    .selectAll('tr')
    .data(datatable)
    .enter()
    .append('tr');

  // create a cell in each row for each column
  /*cells = */ rows
    .selectAll('td')
    .data(row => columns.map(column => ({ column: column, value: row[column] })))
    .enter()
    .append('td')
    .html(d => d.value)
    .attr('class', d => `field-${d.column.replace(' ', '-')}`);

  return table;
}

function convert(data, headers, suppressHeader) {
  if (!_.isBoolean(suppressHeader)) suppressHeader = false;

  data = fixInput(data);

  if (data == null || data.length == 0) {
    return '';
  }

  let columns = headers ? (typeof headers == 'string' ? [headers] : headers) : getColumns(data);

  let rows = [];

  if (!suppressHeader) {
    rows.push(columns);
  }

  for (let i = 0; i < data.length; i++) {
    const row = [];

    _.forEach(columns, function(column) {
      let value =
        (typeof data[i][column] == 'object' && data[i][column] && '[Object]') ||
        (typeof data[i][column] == 'number' && String(data[i][column])) ||
        data[i][column] ||
        '';
      row.push(value);
    });

    rows.push(row);
  }

  return convertToCsv(rows);
}

// Lifted from
// https://github.com/matteofigus/nice-json2csv/blob/master/lib/nice-json2csv.js
// (MIT License)
function fixInput(parameter) {
  if (parameter && parameter.length == undefined && _.keys(parameter).length > 0)
    parameter = [parameter]; // data is a json object instead of an array
  // of json objects

  return parameter;
}

function getColumns(data) {
  let columns = [];

  for (let i = 0; i < data.length; i++) columns = _.union(columns, _.keys(data[i]));

  return columns;
}

function convertToCsv(data) {
  return JSON.stringify(data)
    .replace(/],\[/g, '\n')
    .replace(/]]/g, '')
    .replace(/\[\[/g, '')
    .replace(/\\"/g, '""');
}
