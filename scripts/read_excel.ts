import * as xlsx from 'xlsx';

const filePath = 'D:\\AUTOMATIZACIONES WHATSAPP\\PRECIOS Y PRODUCTOS JUNIO 11 2026.xlsx';
const workbook = xlsx.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const data = xlsx.utils.sheet_to_json(worksheet);

console.log('Productos cargados:');
data.forEach((row: any) => console.log(JSON.stringify(row)));
