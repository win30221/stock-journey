// Small RFC 4180-style parser for the app's import format. It supports quoted
// commas, escaped quotes, and embedded newlines without adding a runtime dependency.
export function parseCsvRows(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const records = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowStart = 1;

  const pushRecord = () => {
    row.push(field);
    if (row.some(value => value.trim() !== '')) records.push({ values:row, line:rowStart });
    row = [];
    field = '';
    rowStart = line;
  };

  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (inQuotes) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index++; }
      else if (character === '"') inQuotes = false;
      else { field += character; if (character === '\n') line++; }
      continue;
    }
    if (character === '"' && field === '') inQuotes = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { line++; pushRecord(); }
    else if (character === '\r') {
      if (source[index + 1] === '\n') index++;
      line++;
      pushRecord();
    } else field += character;
  }

  if (inQuotes) throw Error(`第 ${rowStart} 列有未結束的引號欄位`);
  if (field !== '' || row.length) pushRecord();
  if (!records.length) throw Error('CSV 內容是空的');

  const headers = records.shift().values.map(value => value.trim());
  if (headers.some(header => !header)) throw Error('CSV 標題列包含空白欄位名稱');
  if (new Set(headers).size !== headers.length) throw Error('CSV 標題列包含重複欄位名稱');

  return records.map(record => Object.fromEntries([
    ...headers.map((header, index) => [header, record.values[index]?.trim() ?? '']),
    ['_row', record.line],
  ]));
}
