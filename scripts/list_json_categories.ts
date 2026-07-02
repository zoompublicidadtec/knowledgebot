import * as fs from 'fs';

const allProdsPath = "d:\\KNOWLEDGE ZOOM PUBLICIDAD\\Motor de Conocimiento\\data\\products\\all_products.json";
try {
  const allProds = JSON.parse(fs.readFileSync(allProdsPath, 'utf-8'));
  const categories = new Map<string, number>();
  for (const p of allProds) {
    const cat = p.category || 'N/A';
    categories.set(cat, (categories.get(cat) || 0) + 1);
  }
  console.log("Categories count:");
  for (const [cat, count] of categories.entries()) {
    console.log(`- ${cat}: ${count}`);
  }
} catch (err: any) {
  console.error("Error:", err.message);
}
