const tests = [
  "4GB $11.9908GB $13.20016GB $14.900Precios netos",
  "6 Paneles $17.500",
  "Precio de 10 a 99 unidades: $33.390 | Precio de 100 a 300 unidades: $31.790",
  "$18.900",
  "$ 990",
  "$ 1.200",
  "$2.120.300",
  "8GB $13.200"
];

function testRegex(regex: RegExp) {
  console.log(`\nTesting regex: ${regex.source}`);
  for (const t of tests) {
    const match = t.match(regex);
    console.log(`  Input: "${t}"`);
    console.log(`  Match: ${match ? JSON.stringify(match[0]) + ' -> group 1: ' + JSON.stringify(match[1]) : 'null'}`);
  }
}

// 1. Current simple regex in import_missing_prices_local.ts
testRegex(/\$\s*([\d.]+)/);

// 2. Regex matching dot-separated thousands groups
testRegex(/\$\s*(\d{1,3}(?:\.\d{3})*)/);

// 3. Regex with word boundary or lookahead
testRegex(/\$\s*(\d+(?:\.\d{3})*)(?!\d)/);
