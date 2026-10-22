import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, tokenize, highlightLines } from '../js/core/syntax.js';
import { quoteArg, serialize, dir, block, comment, raw, aligned } from '../js/core/ast.js';

test('parser reads directives, blocks, quotes and variables', () => {
  const { statements, errors } = parseConfig(`
# comment
proxy_set_header X-Test "a b;c";
location ~ "^/api/v[0-9]{1,2}/" {
    return 200 '\\'ok\\'';
}
set $x \${host}suffix;
`);
  assert.deepEqual(errors, []);
  assert.equal(statements.length, 3);
  assert.deepEqual(statements[0].args, ['X-Test', 'a b;c']);
  assert.equal(statements[1].name, 'location');
  assert.deepEqual(statements[1].args, ['~', '^/api/v[0-9]{1,2}/']);
  assert.deepEqual(statements[1].block[0].args, ['200', "'ok'"]);
  assert.deepEqual(statements[2].args, ['$x', '${host}suffix']);
});

test('parser reports the mistakes nginx -t would', () => {
  const missingSemi = parseConfig('proxy_read_timeout 60s\n');
  assert.match(missingSemi.errors[0].message, /missing a terminating ";"/);
  const extraBrace = parseConfig('add_header X y;\n}\n');
  assert.match(extraBrace.errors[0].message, /unexpected "}"/);
  assert.equal(extraBrace.errors[0].line, 2);
  const unclosed = parseConfig('location /a {\n  return 200;\n');
  assert.match(unclosed.errors[0].message, /never closed/);
  const quote = parseConfig('add_header X "unterminated;\n');
  assert.ok(quote.errors.some((e) => /never closed/.test(e.message)));
  const beforeBrace = parseConfig('location /a { return 200 }');
  assert.ok(beforeBrace.errors.some((e) => /missing a ";" before "}"/.test(e.message)));
});

test('quoting round-trips through the parser', () => {
  const values = ['plain', 'with space', 'semi;colon', 'brace{', 'quote"inside', "single'quote", 'back\\slash"', '', '#hash', 'tab\there', 'line\nbreak', '\\.php$', '${host}'];
  for (const v of values) {
    const text = `x ${quoteArg(v)};`;
    const { statements, errors } = parseConfig(text);
    assert.deepEqual(errors, [], text);
    assert.equal(statements[0].args[0], v, `${JSON.stringify(v)} -> ${text}`);
  }
  assert.equal(quoteArg('$host'), '$host');
  assert.equal(quoteArg('SAMEORIGIN', true), '"SAMEORIGIN"');
});

test('serializer aligns groups, indents blocks and maps lines to model paths', () => {
  const nodes = [
    comment('Header'),
    block('server', [], [
      ...aligned([dir('listen', ['80'], { src: 'a.listen' }), dir('server_name', ['_'], { src: 'a.names' })]),
      ...aligned([
        dir('proxy_set_header', ['Host', '$host']),
        dir('proxy_set_header', ['X-Forwarded-For', '$proxy_add_x_forwarded_for']),
      ], { col: true }),
      raw('  # custom\n  add_header X 1;\n', { src: 'a.custom' }),
    ], { src: 'a' }),
  ];
  const { text, lineMap } = serialize(nodes, { indent: 4, align: true });
  assert.equal(text, [
    '# Header',
    'server {',
    '    listen      80;',
    '    server_name _;',
    '    proxy_set_header Host            $host;',
    '    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '    # custom',
    '    add_header X 1;',
    '}',
    '',
  ].join('\n'));
  assert.deepEqual(lineMap.find((e) => e.src === 'a.names'), { line: 4, src: 'a.names' });
  assert.deepEqual(lineMap.filter((e) => e.src === 'a.custom').map((e) => [e.line, e.rawLine]), [[7, 1], [8, 2]]);
  const plain = serialize(nodes, { indent: 2, align: false }).text;
  assert.ok(plain.includes('\n  listen 80;\n  server_name _;'));
});

test('tokenizer and highlighter keep every character', () => {
  const src = 'server {\n    listen 443 ssl; # tls\n    return 301 "https://$host$request_uri";\n}\n';
  assert.equal(tokenize(src).map((t) => t.text).join(''), src);
  const lines = highlightLines(src);
  assert.equal(lines.map((l) => l.map((s) => s.text).join('')).join('\n'), src);
  assert.ok(lines[1].some((s) => s.cls === 'd' && s.text === 'listen'));
  assert.ok(lines[1].some((s) => s.cls === 'c'));
  assert.ok(lines[2].some((s) => s.cls === 'v' && s.text === '$host'));
});
