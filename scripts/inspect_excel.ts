import * as xlsx from 'xlsx';

const filePath = 'D:\\AUTOMATIZACIONES WHATSAPP\\PRECIOS Y PRODUCTOS JUNIO 11 2026.xlsx';
const workbook = xlsx.readFile(filePath);

console.log('Sheets found:', workbook.SheetNames);

workbook.SheetNames.forEach(sheetName => {
  const worksheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
  console.log(`\nSheet: ${sheetName}`);
  console.log(`Total rows: ${data.length}`);
  if (data.length > 0) {
    console.log('First 5 rows:');
    for (let i = 0; i < Math.min(5, data.length); i++) {
      console.log(JSON.stringify(data[i]));
    }
  }
});
