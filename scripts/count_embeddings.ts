import * as fs from 'fs';
import * as path from 'path';

const p = "d:\\KNOWLEDGE ZOOM PUBLICIDAD\\Motor de Conocimiento\\data\\embeddings\\product_embeddings.json";
try {
  const content = fs.readFileSync(p, 'utf-8');
  const data = JSON.parse(content);
  console.log("Total embeddings in JSON:", data.length);
  const ids = data.map((d: any) => d.id);
  console.log("First 20 IDs:", ids.slice(0, 20));
  console.log("Are VINNIE or STANLEY in embeddings?");
  console.log("VINNIE:", ids.includes("VINNIE"));
  console.log("VINNIE-S-A:", ids.includes("VINNIE-S-A"));
  console.log("VINNIE-AN:", ids.includes("VINNIE-AN"));
  console.log("SET-STANLEY:", ids.includes("SET-STANLEY"));
  console.log("Is there any 'boligrafo' in all_products.json?");
  const allProdsPath = "d:\\KNOWLEDGE ZOOM PUBLICIDAD\\Motor de Conocimiento\\data\\products\\all_products.json";
  const allProds = JSON.parse(fs.readFileSync(allProdsPath, 'utf-8'));
  console.log("Total products in JSON:", allProds.length);
} catch (err: any) {
  console.error("Error:", err.message);
}
